import { resolveItemDefinition } from "./item-catalog";
import { itemStatDefinition } from "./item-stat-ranges";

export type MarketListingStatsReason = "unsupported-definition" | "unverified-definition" | "unsupported-variant" | "unidentified";
export interface MarketListingItem {
  itemKey: string;
  identified: boolean;
  /** Only verified unmodified constructors; never the compact seed or hash. */
  stats?: { statId: number; value: number }[];
  statsReason?: MarketListingStatsReason;
}

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
  const definition = itemStatDefinition(raw.itemKey);
  // Treat unknown/malformed stat projections as unavailable. Never silently
  // drop one bad roll and label the remaining subset a reconstructed item.
  if (raw.identified && definition?.verifiedListingRolls && Array.isArray(raw.stats) && raw.stats.length === definition.stats.length) {
    const seen = new Set<number>();
    const stats: NonNullable<MarketListingItem["stats"]> = [];
    for (const candidate of raw.stats) {
      if (!candidate || typeof candidate !== "object") break;
      const range = definition.stats.find(stat => stat.statId === candidate.statId);
      if (!range || seen.has(candidate.statId) || typeof candidate.value !== "number"
        || !Number.isSafeInteger(candidate.value) || candidate.value < range.minimum || candidate.value > range.maximum) break;
      seen.add(candidate.statId);
      stats.push({ statId: candidate.statId, value: candidate.value });
    }
    if (stats.length === definition.stats.length) { result.stats = stats; return result; }
  }
  result.statsReason = !raw.identified ? "unidentified" : !definition ? "unsupported-definition"
    : !definition.verifiedListingRolls ? "unverified-definition" : "unsupported-variant";
  return result;
}
