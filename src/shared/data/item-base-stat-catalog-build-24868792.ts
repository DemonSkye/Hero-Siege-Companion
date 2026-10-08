// Compatibility adapter. Edit the canonical JSON; see docs/item-data.md.
import data from "./items/build-24868792/constructor-stats.json";
import { ITEM_STAT_METADATA } from "../item-stats";
import type { ItemBaseStatCatalogData } from "../item-base-stat-catalog-types";
export const ITEM_BASE_STAT_CATALOG_BUILD_24868792_DATA: ItemBaseStatCatalogData = {
  ...data as Omit<ItemBaseStatCatalogData, "stats">, stats: ITEM_STAT_METADATA,
};
