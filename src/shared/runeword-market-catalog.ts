import { RUNEWORD_MARKET_CATALOG_DATA } from "./data/runeword-market-catalog-build-24868792";

export interface RunewordMarketDefinition {
  repositoryId: number;
  itemKey: string;
  legacyItemKey: string;
  name: string;
  itemType: number | null;
}

/** External IDs are permuted dispatch keys, not legacy constructor case IDs. */
export const RUNEWORD_MARKET_DEFINITIONS: readonly RunewordMarketDefinition[] = RUNEWORD_MARKET_CATALOG_DATA.map(
  ([repositoryId,legacyItemKey,name,itemType]) => ({repositoryId,legacyItemKey,name,itemType,
    itemKey:`runeword-repository:${repositoryId}`}),
);
const byId = new Map(RUNEWORD_MARKET_DEFINITIONS.map(item=>[item.repositoryId,item]));
const byLegacyKey = new Map(RUNEWORD_MARKET_DEFINITIONS.map(item=>[item.legacyItemKey,item]));
export function runewordMarketById(id: number) { return byId.get(id) ?? null; }
export function runewordMarketByLegacyKey(key: string) { return byLegacyKey.get(key) ?? null; }
