import { MARKET_UNRESOLVED_STAT_MEANINGS, MARKET_ENCODED_FIELD_CONTEXTS } from "./data/market-stat-meaning-gaps-build-24868792";
import { runewordMarketByLegacyKey } from "./runeword-market-catalog";

const unresolved = new Map<number, string>(MARKET_UNRESOLVED_STAT_MEANINGS);
const encoded = new Set(MARKET_ENCODED_FIELD_CONTEXTS.map(([key,id])=>`${key}:${id}`));
export function unresolvedMarketStatMeaning(statId: number): string | null {
  return unresolved.get(statId) ?? null;
}
export function marketDefinitionHasEncodedField(itemKey: string | null, statId: number): boolean {
  if (itemKey === null) return false;
  const key = runewordMarketByLegacyKey(itemKey)?.itemKey ?? itemKey;
  return encoded.has(`${key}:${statId}`);
}
