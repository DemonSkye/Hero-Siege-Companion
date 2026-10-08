import { activeItemCatalog } from "../../../shared/item-catalog";
import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { resolveMarketItemMask, type MarketItemIdentity, type MarketFilterCriteria, type MarketSearchRequest, type MarketSearchTarget } from "../../../shared/market-search";
import { RUNEWORD_MARKET_DEFINITIONS, runewordMarketById, runewordMarketByLegacyKey } from "../../../shared/runeword-market-catalog";
import { normalizeLookupText } from "./text";

export interface MarketItemOption {
  key: string;
  name: string;
  typeLabel: string;
  itemMask: number | null;
  runewordId?: number;
  searchUnavailable?: string;
  experimental?: true;
  availabilityNotice?: string;
  legacyNames?: readonly string[];
  repository: "normal" | "unique" | "runeword";
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
      repository: definition.repository,
      itemMask: mask.itemMask,
    }];
  }).concat(activeItemCatalog.artifact.missing.flatMap((definition): MarketItemOption[] => {
    const mask = resolveMarketItemMask({ ...definition, id: definition.gameId });
    if (!mask.ok) return [];
    // Frozen labels-v5: 23 explicit deprecated constructor placeholders and
    // one defined weapon with no retained English translation. Preserve keys.
    const key = `${definition.repository}:${definition.type}:${definition.weaponType}:${definition.gameId}`;
    const deprecated = definition.repository === "unique" && definition.type === 11 && definition.weaponType === 0
      && definition.gameId >= 0 && definition.gameId <= 22;
    const name = deprecated ? `deprecated · definition ${definition.gameId} (experimental)`
      : key === "unique:3:16:13" ? "w_throwing_darkmoon_deck (experimental)"
      : `${definition.localizationId ?? 'Untranslated item'} (experimental)`;
    return [{ key, name,
      legacyNames: [`${definition.localizationId ?? 'Untranslated item'} (experimental)`],
      availabilityNotice: deprecated ? "Deprecated definition; current availability is unverified."
        : "English name and current availability are unverified.",
      typeLabel: ITEM_TYPE_NAMES[definition.type] ?? "Item", repository: definition.repository,
      itemMask: mask.itemMask, experimental: true }];
  })).concat(RUNEWORD_MARKET_DEFINITIONS.map((item): MarketItemOption => ({
    key:item.itemKey,name:item.name,typeLabel:item.itemType===11 && item.name.startsWith("Codex of ")
      ? "Codex · Runeword" : item.itemType===null ? "Runeword" : `${ITEM_TYPE_NAMES[item.itemType] ?? "Item"} · Runeword`,
    repository:"runeword",itemMask:null,runewordId:item.repositoryId,
  }))).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

const byKey = new Map(MARKET_ITEM_OPTIONS.map((item) => [item.key, item]));
const byMask = new Map(MARKET_ITEM_OPTIONS.flatMap(item => item.itemMask === null ? [] : [[item.itemMask, item] as const]));
export function marketItemByKey(key: string | null): MarketItemOption | null {
  return key === null ? null : byKey.get(runewordMarketByLegacyKey(key)?.itemKey ?? key) ?? null;
}

export function marketTargetForItem(item: Pick<MarketItemOption,"itemMask"|"runewordId">): MarketSearchTarget | null {
  return item.runewordId !== undefined ? {runewordId:item.runewordId}
    : item.itemMask !== null ? {itemMask:item.itemMask} : null;
}

/** Timeline IDs are native repository IDs; legacy-case aliases are storage-only. */
export function marketItemForTimelineItem(identity: MarketItemIdentity): MarketItemOption | null {
  if (identity.repository === "runeword") {
    const definition = runewordMarketById(identity.id);
    return definition ? marketItemByKey(definition.itemKey) : null;
  }
  const mask = resolveMarketItemMask(identity);
  return mask.ok ? byMask.get(mask.itemMask) ?? null : null;
}

export function marketItemsForName(name: string): MarketItemOption[] {
  const query = normalizeLookupText(name);
  return MARKET_ITEM_OPTIONS.filter((item) => normalizeLookupText(item.name) === query
    || item.legacyNames?.some(name => normalizeLookupText(name) === query));
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
  /** Durable filters independent of request encoding; optional for old entries. */
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
      request: item && marketTargetForItem(item) ? { ...marketTargetForItem(item)!, statFilters: [] } : null,
      ...(item ? { criteria: { statFilters: [] } } : {}),
    };
  });
}
