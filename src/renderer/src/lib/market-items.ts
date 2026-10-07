import { activeItemCatalog } from "../../../shared/item-catalog";
import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { resolveMarketItemMask, type MarketSearchRequest } from "../../../shared/market-search";
import { normalizeLookupText } from "./text";

export interface MarketItemOption {
  key: string;
  name: string;
  typeLabel: string;
  itemMask: number;
}

// Use proven definition identities, never icon/name inference or seeded rolls.
export const MARKET_ITEM_OPTIONS: readonly MarketItemOption[] = activeItemCatalog.allDefinitions()
  .flatMap((definition): MarketItemOption[] => {
    if (definition.repository === "runeword") return [];
    const mask = resolveMarketItemMask({ ...definition, id: definition.gameId });
    if (!mask.ok) return [];
    return [{
      key: `${definition.repository}:${definition.type}:${definition.weaponType}:${definition.gameId}`,
      name: definition.identityMode === "seeded" ? definition.baseName : definition.name,
      typeLabel: `${definition.identityMode === "seeded" ? "Base " : ""}${ITEM_TYPE_NAMES[definition.type] ?? "Item"}`,
      itemMask: mask.itemMask,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

const byKey = new Map(MARKET_ITEM_OPTIONS.map((item) => [item.key, item]));
export function marketItemByKey(key: string | null): MarketItemOption | null {
  return key === null ? null : byKey.get(key) ?? null;
}

export function marketItemsForName(name: string): MarketItemOption[] {
  const query = normalizeLookupText(name);
  return MARKET_ITEM_OPTIONS.filter((item) => normalizeLookupText(item.name) === query);
}

export function marketItemSuggestions(query: string): MarketItemOption[] {
  const normalized = normalizeLookupText(query);
  return MARKET_ITEM_OPTIONS.filter((item) => !normalized || normalizeLookupText(item.name).includes(normalized)).slice(0, 12);
}

export interface SavedMarketItem {
  id: string;
  name: string;
  itemKey: string | null;
  request: MarketSearchRequest | null;
}

/** Every legacy name survives, including unresolved and ambiguous identities. */
export function migrateShoppingList(names: readonly string[]): SavedMarketItem[] {
  return names.map((name, index) => {
    const matches = marketItemsForName(name);
    const item = matches.length === 1 ? matches[0] : null;
    return {
      id: `legacy-${index}`,
      name,
      itemKey: item?.key ?? null,
      request: item ? { itemMask: item.itemMask, statFilters: [] } : null,
    };
  });
}
