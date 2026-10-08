import data from "./data/items/build-24868792/item-stats.json";
import type { ItemBaseStatMetadata } from "./item-base-stat-catalog-types";
import type { MarketStatRoleDefinition } from "./data/market-stat-roles-build-24868792";

export interface ItemStatMetadata extends ItemBaseStatMetadata {
  /** Qualified field role, when proved; null does not imply a numeric quantity. */
  role: Readonly<MarketStatRoleDefinition> | null;
  /** Historical meaning gap; a proved role takes precedence, as in Market. */
  unresolvedMeaning: string | null;
}

/** One stable numeric-ID catalog. Labels are never used as identity. */
export const ItemStats: readonly ItemStatMetadata[] = data.stats as readonly ItemStatMetadata[];
const byId = new Map(ItemStats.map(stat => [stat.statId, stat]));
export function itemStat(statId: number): ItemStatMetadata | null {
  return byId.get(statId) ?? null;
}

/** Preserve the existing constructor metadata shape for production consumers. */
export const ITEM_STAT_METADATA: readonly ItemBaseStatMetadata[] = ItemStats.map(
  ({ statId, name, localizationKey, nativeMarketMenu, unit }) =>
    ({ statId, name, localizationKey, nativeMarketMenu, unit }),
);
