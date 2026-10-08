import { activeItemCatalog } from "../../../shared/item-catalog";
import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { resolveMarketItemMask, type MarketFilterCriteria, type MarketSearchRequest } from "../../../shared/market-search";
import { normalizeLookupText } from "./text";

export interface MarketItemOption {
  key: string;
  name: string;
  typeLabel: string;
  itemMask: number | null;
  searchUnavailable?: string;
  experimental?: true;
  repository: "normal" | "unique" | "runeword";
}

// Use proven definition identities, never icon/name inference or seeded rolls.
export const MARKET_ITEM_OPTIONS: readonly MarketItemOption[] = activeItemCatalog.allDefinitions()
  .flatMap((definition): MarketItemOption[] => {
    const mask = resolveMarketItemMask({ ...definition, id: definition.gameId });
    if (!mask.ok && definition.repository !== "runeword") return [];
    return [{
      key: `${definition.repository}:${definition.type}:${definition.weaponType}:${definition.gameId}`,
      name: definition.identityMode === "seeded" ? definition.baseName : definition.name,
      typeLabel: definition.repository === "runeword" ? ([93,94,96,97,98,99].includes(definition.gameId) ? "Codex · Runeword" : "Runeword") : `${definition.identityMode === "seeded" ? "Base " : ""}${ITEM_TYPE_NAMES[definition.type] ?? "Item"}`,
      repository: definition.repository,
      itemMask: mask.ok ? mask.itemMask : null,
      ...(!mask.ok ? { searchUnavailable: "Runeword search encoding is not verified yet. You can save filters; searching is unavailable." } : {}),
    }];
  }).concat(activeItemCatalog.artifact.missing.flatMap((definition): MarketItemOption[] => {
    const mask = resolveMarketItemMask({ ...definition, id: definition.gameId });
    if (!mask.ok) return [];
    return [{ key: `${definition.repository}:${definition.type}:${definition.weaponType}:${definition.gameId}`,
      name: `${definition.localizationId ?? 'Untranslated item'} (experimental)`,
      typeLabel: ITEM_TYPE_NAMES[definition.type] ?? "Item", repository: definition.repository,
      itemMask: mask.itemMask, experimental: true }];
  })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

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
  const score = (item: MarketItemOption) => {
    const name = normalizeLookupText(item.name);
    return name === normalized ? 0 : name.startsWith(normalized) ? 1 : 2;
  };
  return MARKET_ITEM_OPTIONS.filter((item) => !normalized || normalizeLookupText(item.name).includes(normalized))
    .sort((a,b) => score(a)-score(b)).slice(0, 12);
}

export interface SavedMarketItem {
  id: string;
  name: string;
  itemKey: string | null;
  request: MarketSearchRequest | null;
  /** Preserve filters while a catalog identity's wire encoding is unresolved. */
  criteria?: MarketFilterCriteria;
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
      request: item && item.itemMask !== null ? { itemMask: item.itemMask, statFilters: [] } : null,
      ...(item && item.itemMask === null ? { criteria: { statFilters: [] } } : {}),
    };
  });
}
