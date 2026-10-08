import type { ItemStatDefinition } from "../../../shared/item-stat-ranges";
import { itemBaseStatMetadata, type ItemBaseNumericValue, type ItemBaseStat } from "../../../shared/item-base-stat-catalog";
import { marketDefinitionHasEncodedField, marketStatFieldName, marketStatRole } from "../../../shared/market-stat-capabilities";

export interface MarketCatalogStatRow {
  key: number;
  label: string;
  value?: string;
  detail?: string;
}

// Exact v8 item-stat bindings, not character-attribute identifiers. Unresolved
// talent names and proc chance scales stay explicit rather than becoming IDs.
const talentModifiers = [[202,203],[205,206],[208,209],[211,212],[214,215],[217,218],[462,463],[444,445]] as const;
const procFamilies = [
  [113,114,115,"when attacking"], [116,117,118,"when striking"], [119,120,121,"on spell hit"],
  [122,123,124,"when killing"], [125,126,127,"when casting"], [185,186,187,"when struck"],
  [188,189,190,"when blocking"],
] as const;

/** Presentation only: never changes numeric search identities or seed inputs. */
export function marketCatalogStatRows(stats: readonly ItemBaseStat[], itemKey: string | null): MarketCatalogStatRow[] {
  const consumed = new Set<number>();
  const rows: MarketCatalogStatRow[] = [];
  const byId = new Map(stats.map(stat => [stat.statId, stat]));
  const plainValue = (stat: ItemBaseStat) => marketBaseStatValue(stat, itemKey);
  for (const [talentId, modifierId] of talentModifiers) {
    const talent = byId.get(talentId), modifier = byId.get(modifierId);
    if (!talent || !modifier) continue;
    consumed.add(talentId); consumed.add(modifierId);
    // The supplied Gryphon tooltip names Execute for this exact constructor's
    // 202=184 / 203 bonus pair. It is not a global talent-ID lookup.
    const gryphonExecute = itemKey === "unique:5:0:65" && talentId === 202
      && talent.kind === "scalar" && talent.minimum === 184 && talent.maximum === 184
      && modifier.kind === "range" && modifier.minimum === 12 && modifier.maximum === 18;
    rows.push(gryphonExecute ? { key: talentId, label: "+[12\u201318] to [Execute]" }
      : { key: talentId, label: "Selected talent bonus", value: `[${plainValue(modifier)}] \u00b7 Talent name unavailable` });
  }
  for (const [talentId, levelId, chanceId, event] of procFamilies) {
    const talent = byId.get(talentId), level = byId.get(levelId), chance = byId.get(chanceId);
    if (!talent || !level || !chance) continue;
    for (const id of [talentId, levelId, chanceId]) consumed.add(id);
    rows.push({ key: talentId, label: `Triggered talent ${event}`,
      value: `Chance [${plainValue(chance)}]; level [${plainValue(level)}] \u00b7 Talent name unavailable` });
  }
  for (const stat of stats) {
    if (consumed.has(stat.statId)) continue;
    // Exact retained English key stat_open_wounds, paired owner tooltip: percent
    // is a display unit here. Other proc families retain their unproved scales.
    if (stat.statId === 99 && (stat.kind === "scalar" || stat.kind === "range")) {
      const value = stat.minimum === stat.maximum ? String(stat.minimum) : `${stat.minimum}\u2013${stat.maximum}`;
      rows.push({ key: stat.statId, label: `+[${value}]% Chance to Open Wounds` });
      continue;
    }
    const role = marketStatRole(stat.statId);
    if (role?.kind === "class-identifier") {
      rows.push({ key: stat.statId, label: "Class selection", value: "Class name unavailable", detail: role.detail });
      continue;
    }
    rows.push({ key: stat.statId,
      label: role?.kind === "talent-identifier" ? "Selected talent" : marketStatFieldName(stat.statId, itemBaseStatMetadata(stat.statId)?.name ?? `Stat ${stat.statId}`),
      value: role?.kind === "talent-identifier" ? "Talent name unavailable" : `[${plainValue(stat)}]`, detail: role?.detail });
  }
  return rows.sort((left, right) => stats.findIndex(stat => stat.statId === left.key) - stats.findIndex(stat => stat.statId === right.key));
}

export function marketBaseStatValue(stat: ItemBaseStat, itemKey: string | null = null): string {
  const role = marketStatRole(stat.statId);
  if (marketDefinitionHasEncodedField(itemKey, stat.statId)) return role?.kind === "effect" ? "Conditional effect (encoded)" : "Encoded field; meaning unverified";
  if (stat.kind === "dynamic") return stat.description;
  if (stat.kind !== "series" && role?.kind === "effect") return "Conditional effect";
  if (stat.kind !== "series" && role?.kind === "marker") return "Conditional marker";
  const metadataUnit = itemBaseStatMetadata(stat.statId)?.unit;
  const unit = metadataUnit === "percent" ? "%" : metadataUnit === "seconds" ? " s" : "";
  const format = (value: ItemBaseNumericValue) => value.kind === "series"
    ? `Table: ${(value.values ?? []).join(", ")}`
    : value.minimum === value.maximum ? `${value.minimum}${unit}` : `${value.minimum}${unit}–${value.maximum}${unit}`;
  const value = format(stat);
  return ["class-identifier","talent-identifier","categorical"].includes(role?.kind ?? "") ? `Identifier: ${value}` : value;
}

/** Proc mappings are scoped to a definition with a paired tooltip oracle. */
export function marketTriggeredSkillDescription(definition: ItemStatDefinition | null,
  stats: readonly { statId: number; value: number }[]): string | null {
  const skill = definition?.triggeredSkill;
  if (!definition || !skill) return null;
  const value = (id: number) => stats.find(stat => stat.statId === id)?.value;
  const chance = value(skill.chanceStatId);
  const level = value(skill.levelStatId);
  const skillId = value(skill.skillStatId);
  const expectedId = definition.stats.find(stat => stat.statId === skill.skillStatId)?.minimum;
  if (chance === undefined || level === undefined || skillId !== expectedId) return null;
  return `${chance}% Chance ${skill.trigger}: ${skill.name} (Level ${level})`;
}

export function marketTriggeredSkillStatIds(definition: ItemStatDefinition | null): number[] {
  const skill = definition?.triggeredSkill;
  return skill ? [skill.skillStatId, skill.chanceStatId, skill.levelStatId] : [];
}
