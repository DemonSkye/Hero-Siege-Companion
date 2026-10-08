// Compatibility adapter. Edit the canonical JSON; see docs/item-data.md.
import data from "./items/build-24868792/item-stats.json";
import { itemStat } from "../item-stats";
export const MARKET_STAT_CATALOG_BUILD_24868792_DATA = {
  ...data.nativeMarketCatalog,
  stats: data.nativeMenuStatIds.map(id => {
    const stat = itemStat(id)!;
    return [stat.statId, stat.localizationKey, stat.name] as const;
  }),
};
