import { itemBaseStatDefinition, type ItemBaseStat } from "./item-base-stat-catalog";
import { ITEM_LISTING_CONSTRUCTOR_GAPS, ITEM_LISTING_OPTIONAL_GENERATION_KEYS } from "./data/item-listing-coverage-build-24868792";
import { marketStatRole } from "./market-stat-capabilities";

export const NON_RANDOM_CONSTRUCTOR_STATS: ReadonlySet<number> = new Set([376, 380, 378, 382, 347, 431,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 444, 21, 432, 20]);

export function constructorFieldGap(stat: ItemBaseStat): "constructor-value" | "native-stat-case" | null {
  if (stat.statId !== 20 && (NON_RANDOM_CONSTRUCTOR_STATS.has(stat.statId) || stat.statId < 22 || stat.statId >= 476
    || stat.statId >= 221 && stat.statId <= 227)) return "native-stat-case";
  if (stat.kind !== "scalar" && stat.kind !== "range") return "constructor-value";
  if (!Number.isFinite(stat.minimum) || !Number.isFinite(stat.maximum) || stat.maximum < stat.minimum
    || stat.kind === "scalar" && stat.minimum !== stat.maximum) return "constructor-value";
  return null;
}

/** Constructor facts, not specimen-specific expected rolls or an authentication gate. */
export function itemListingDefinition(itemKey: string) {
  const definition = itemBaseStatDefinition(itemKey);
  if (!definition?.stats.length) return null;
  const family = itemKey.split(":").slice(0, 3).join(":");
  return { ...definition, helperGap: ITEM_LISTING_CONSTRUCTOR_GAPS[family] ?? null,
    optionalGeneration: ITEM_LISTING_OPTIONAL_GENERATION_KEYS.includes(itemKey) };
}

/** The IPC gate can reject impossible claims without receiving a listing seed. */
export function constructorProjectionGaps(fields: readonly ItemBaseStat[], complete: boolean) {
  const gaps = new Map<number, "constructor-value" | "native-stat-case" | "prior-draw">();
  let positionKnown = complete;
  const ordered = [...fields].sort((a, b) => String(a.statId) < String(b.statId) ? -1 : String(a.statId) > String(b.statId) ? 1 : 0);
  for (const field of ordered) {
    if (field.statId === 20) continue;
    const gap = constructorFieldGap(field);
    if (gap) {
      gaps.set(field.statId, gap);
      // DontRandomStats and fields outside the numeric branch consume no draw.
      // The untranslated coupled damage cases can affect subsequent draws.
      if (gap === "constructor-value" || field.statId >= 221 && field.statId <= 227) positionKnown = false;
    } else if (field.kind === "range" && !positionKnown) gaps.set(field.statId, "prior-draw");
  }
  const sockets = ordered.find(field => field.statId === 20);
  if (sockets) {
    const gap = constructorFieldGap(sockets);
    if (gap) gaps.set(20, gap);
    else if (!positionKnown || fields.some(field => ["talent-identifier", "class-identifier"].includes(marketStatRole(field.statId)?.kind ?? ""))) gaps.set(20, "prior-draw");
  }
  return gaps;
}

export function validConstructorStatValue(stat: ItemBaseStat, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (stat.kind === "scalar") return value === stat.minimum;
  return stat.kind === "range" && value >= stat.minimum && value <= stat.maximum
    && Number.isInteger(value - stat.minimum);
}
