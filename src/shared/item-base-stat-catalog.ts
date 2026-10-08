import { ITEM_BASE_STAT_CATALOG_BUILD_24868792_DATA } from "./data/item-base-stat-catalog-build-24868792";
import { runewordMarketByLegacyKey } from "./runeword-market-catalog";
export type { ItemBaseStat, ItemBaseNumericValue, ItemBaseStatDefinition, ItemBaseStatMetadata } from "./item-base-stat-catalog-types";

/** Static constructor facts are independent of per-listing roll verification. */
export const ITEM_BASE_STAT_CATALOG = ITEM_BASE_STAT_CATALOG_BUILD_24868792_DATA;
const byItem = new Map(ITEM_BASE_STAT_CATALOG.items.map(item => [item.itemKey, item]));
const byStat = new Map(ITEM_BASE_STAT_CATALOG.stats.map(stat => [stat.statId, stat]));
export function itemBaseStatDefinition(itemKey: string | null) {
  return itemKey === null ? null : byItem.get(runewordMarketByLegacyKey(itemKey)?.itemKey ?? itemKey) ?? null;
}
export function itemBaseStatMetadata(statId: number) { return byStat.get(statId) ?? null; }
