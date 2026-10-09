import { resolveItemDefinition } from "./item-catalog";
import { itemStatDefinition } from "./item-stat-ranges";
import { constructorProjectionGaps, itemListingDefinition, validConstructorStatValue } from "./item-listing-definition";

export type MarketListingStatsReason = "unsupported-definition" | "unverified-definition" | "unsupported-variant" | "unidentified" | "constructor-helper";
export type MarketListingStatReason = "constructor-value" | "prior-draw" | "native-stat-case" | "modifier"
  | "constructor-helper" | "invalid-seed" | "invalid-projection" | "not-reconstructed";
export interface MarketListingItem {
  itemKey: string;
  identified: boolean;
  /** Safe constructor expansion; compact seeds, hashes and flags stay in main. */
  stats?: { statId: number; value: number }[];
  unknownStats?: { statId: number; reason: MarketListingStatReason }[];
  statsExperimental?: boolean;
  statsReason?: MarketListingStatsReason;
}
const reasons = new Set<MarketListingStatReason>(["constructor-value", "prior-draw", "native-stat-case", "modifier",
  "constructor-helper", "invalid-seed", "invalid-projection", "not-reconstructed"]);

export function sanitizeMarketListingItem(value: unknown): MarketListingItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.itemKey !== "string" || typeof raw.identified !== "boolean") return null;
  const match = /^(normal|unique):(\d{1,3}):(\d{1,3}):(\d{1,4})$/.exec(raw.itemKey);
  if (!match) return null;
  const [, repository, type, weaponType, gameId] = match;
  if (resolveItemDefinition({ repository: repository as "normal" | "unique",
    type: Number(type), weaponType: Number(weaponType), gameId: Number(gameId) }).status !== "resolved") return null;
  const result: MarketListingItem = { itemKey: raw.itemKey, identified: raw.identified };
  // Identification remains presentation policy, never a PRNG input.
  if (!raw.identified) return { ...result, statsReason: "unidentified" };
  const definition = itemListingDefinition(raw.itemKey);
  if (!definition) return { ...result, statsReason: "unsupported-definition" };
  const stats: NonNullable<MarketListingItem["stats"]> = [];
  const unknown: NonNullable<MarketListingItem["unknownStats"]> = [];
  const candidates = Array.isArray(raw.stats) ? raw.stats.slice(0, 1024) : [];
  const unavailable = Array.isArray(raw.unknownStats) ? raw.unknownStats.slice(0, 1024) : [];
  const constructorGaps = constructorProjectionGaps(definition.stats, definition.complete);
  for (const field of definition.stats) {
    const matches = candidates.filter(candidate => candidate && typeof candidate === "object" && candidate.statId === field.statId);
    const gaps = unavailable.filter(candidate => candidate && typeof candidate === "object" && candidate.statId === field.statId);
    let reason: MarketListingStatReason | null = definition.helperGap
      ?? (raw.itemKey.startsWith("normal:") || definition.optionalGeneration ? "modifier" : constructorGaps.get(field.statId) ?? null);
    if (!reason && gaps.length === 1 && reasons.has(gaps[0].reason)) reason = gaps[0].reason;
    if (!reason && matches.length === 1 && gaps.length === 0 && validConstructorStatValue(field, matches[0].value)) {
      stats.push({ statId: field.statId, value: matches[0].value });
      continue;
    }
    unknown.push({ statId: field.statId, reason: reason ?? (matches.length || gaps.length ? "invalid-projection" : "not-reconstructed") });
  }
  if (stats.length) {
    result.stats = stats;
    if (!itemStatDefinition(raw.itemKey)?.verifiedListingRolls) result.statsExperimental = true;
  }
  if (unknown.length) result.unknownStats = unknown;
  if (!stats.length) result.statsReason = definition.helperGap ? "constructor-helper"
    : unknown.some(stat => ["modifier", "invalid-seed", "invalid-projection"].includes(stat.reason)) ? "unsupported-variant" : "unsupported-definition";
  return result;
}
