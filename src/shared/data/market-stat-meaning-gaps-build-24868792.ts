// Compatibility adapter. Edit the canonical JSON; see docs/item-data.md.
import data from "./items/build-24868792/item-stats.json";
import { ItemStats } from "../item-stats";
export const MARKET_UNRESOLVED_STAT_MEANINGS = ItemStats.flatMap(stat => stat.unresolvedMeaning === null ? [] : [[stat.statId, stat.unresolvedMeaning] as const]);
export const MARKET_ENCODED_FIELD_CONTEXTS = data.encodedFieldContexts.map(
  ([key, statId]) => [key as string, statId as number] as const,
);
