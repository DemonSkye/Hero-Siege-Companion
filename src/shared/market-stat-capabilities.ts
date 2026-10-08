import { MARKET_UNRESOLVED_STAT_MEANINGS, MARKET_ENCODED_FIELD_CONTEXTS } from "./data/market-stat-meaning-gaps-build-24868792";
import { runewordMarketByLegacyKey } from "./runeword-market-catalog";
import { MARKET_STAT_ROLES_V8, type MarketStatRoleDefinition } from "./data/market-stat-roles-build-24868792";

const unresolved = new Map<number, string>(MARKET_UNRESOLVED_STAT_MEANINGS);
const encoded = new Set(MARKET_ENCODED_FIELD_CONTEXTS.map(([key,id])=>`${key}:${id}`));
const roles = new Map(MARKET_STAT_ROLES_V8.map(role=>[role.statId,role]));
export function unresolvedMarketStatMeaning(statId: number): string | null {
  if (roles.has(statId)) return null;
  return unresolved.get(statId) ?? null;
}
export function marketStatRole(statId: number): Readonly<MarketStatRoleDefinition> | null {
  return roles.get(statId) ?? null;
}
export function marketStatFieldName(statId: number, fallback: string): string {
  return roles.get(statId)?.caption ?? fallback;
}
export function marketStatRoleMinimumIssue(statId: number): string | null {
  switch (roles.get(statId)?.kind) {
    case "class-identifier": return "Class identity needs an exact selector, not a greater-than minimum. Its wire control is not established.";
    case "talent-identifier": return "Talent identity needs an exact selector, not a greater-than minimum. Its wire control is not established.";
    case "effect": return "This is an effect-presence field, not a numeric roll. Its presence-filter control is not established.";
    case "marker": return "This is a conditional marker with scalar/array paths, not a displayed numeric amount.";
    case "categorical": return "This is a categorical dispatch field, not a numeric roll. Its selector control is not established.";
    case "collection": return "Zone collections cannot be searched as numeric minimums.";
    default: return null;
  }
}
export function marketDefinitionHasEncodedField(itemKey: string | null, statId: number): boolean {
  if (itemKey === null) return false;
  const key = runewordMarketByLegacyKey(itemKey)?.itemKey ?? itemKey;
  return encoded.has(`${key}:${statId}`);
}
