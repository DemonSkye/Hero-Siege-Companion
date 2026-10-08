import type { ItemStatDefinition } from "../../../shared/item-stat-ranges";
import { itemBaseStatMetadata, type ItemBaseNumericValue, type ItemBaseStat } from "../../../shared/item-base-stat-catalog";
import { marketDefinitionHasEncodedField, marketStatRole } from "../../../shared/market-stat-capabilities";

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
