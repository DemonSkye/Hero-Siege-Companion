import { ref, type Ref } from "vue";
import { normalizeMarketFilterCriteria, normalizeMarketSearchRequest } from "../../../shared/market-search";
import { marketItemByKey, type MarketItemOption, type SavedMarketItem } from "./market-items";
import type { useMarketSearchRuntime } from "./market-search-runtime";

/** Storage recognizes an identity independently of its current wire encoding. */
type SavedMarketCatalogIdentity = { key: string; itemMask?: number | null; runewordId?: number };

export function normalizeSavedMarketItems(value: unknown,
  itemForKey: (key: string | null) => SavedMarketCatalogIdentity | null = marketItemByKey): SavedMarketItem[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.flatMap((raw, index): SavedMarketItem[] => {
    if (!raw || typeof raw !== "object" || typeof raw.name !== "string") return [];
    let id = typeof raw.id === "string" && raw.id ? raw.id : `saved-${index}`;
    while (usedIds.has(id)) id += `-${index}`;
    usedIds.add(id);
    const item = itemForKey(typeof raw.itemKey === "string" ? raw.itemKey : null);
    // Preserve old request-only criteria even when a newly proved semantic gap
    // prevents that criterion from being sent. Validate the target separately.
    const rawRequest = raw.request && typeof raw.request === "object" ? raw.request : {};
    const oldCriteria = normalizeMarketFilterCriteria(rawRequest);
    const normalized = normalizeMarketSearchRequest({ ...rawRequest, statFilters: [] });
    const priorRequest = item && normalized.ok && (item.runewordId !== undefined
      ? normalized.request.runewordId === item.runewordId
      : normalized.request.itemMask === item.itemMask)
      && oldCriteria.ok ? { ...normalized.request, ...oldCriteria.criteria } : null;
    const savedCriteria = normalizeMarketFilterCriteria(raw.criteria);
    const criteria = item && savedCriteria.ok ? savedCriteria.criteria : priorRequest
      ? { ...(priorRequest.minSockets === undefined ? {} : { minSockets: priorRequest.minSockets }), statFilters: priorRequest.statFilters } : null;
    const prepared = item && criteria ? normalizeMarketSearchRequest({
      ...(item.runewordId === undefined ? {itemMask:item.itemMask} : {runewordId:item.runewordId}),...criteria,
    }) : null;
    const request = prepared?.ok ? prepared.request : null;
    return [{ id, name: raw.name, itemKey: request || criteria ? item!.key : null, request,
      ...(criteria ? { criteria } : {}) }];
  });
}

export function useSavedMarketItems(
  entries: Ref<SavedMarketItem[]>,
  search: ReturnType<typeof useMarketSearchRuntime>,
) {
  const editingId = ref<string | null>(null);
  const itemKey = ref<string | null>(null);
  const savedName = ref("");
  const message = ref("");
  const deleted = ref<{ item: SavedMarketItem; index: number } | null>(null);

  function selectItem(item: MarketItemOption): void {
    itemKey.value = item.key;
    if (!editingId.value) savedName.value = item.name;
    search.openMarketCatalogDraft({ label: item.name, rarity: item.typeLabel }, item.itemMask, { statFilters: [] }, item.runewordId ?? null);
    message.value = item.availabilityNotice ?? item.searchUnavailable ?? "";
  }

  function newSearch(): void {
    editingId.value = null;
    itemKey.value = null;
    savedName.value = "";
    message.value = "";
    search.closeMarketSearch();
  }

  function loadSaved(id: string): void {
    const entry = entries.value.find((candidate) => candidate.id === id);
    if (!entry) return;
    editingId.value = entry.id;
    savedName.value = entry.name;
    const item = marketItemByKey(entry.itemKey);
    itemKey.value = item?.key ?? entry.itemKey;
    if (item && (entry.request || entry.criteria)) {
      search.openMarketCatalogDraft({ label: item.name, rarity: item.typeLabel }, item.itemMask, entry.criteria ?? entry.request!, item.runewordId ?? null);
      message.value = item.availabilityNotice ?? item.searchUnavailable ?? "Filters loaded. Press Search when you are ready.";
    } else {
      search.closeMarketSearch();
      message.value = "This saved name needs a catalog item. Choose an item, then save the repaired entry.";
    }
  }

  function saveDraft(asNew = false): boolean {
    const request = search.draftRequest.value;
    const target = search.draftTarget.value;
    const criteria = search.draftCriteria.value;
    const item = marketItemByKey(itemKey.value);
    if (!criteria || !item || (item.runewordId !== undefined ? target?.runewordId !== item.runewordId
      : item.itemMask !== null && target?.itemMask !== item.itemMask)) return false;
    const id = !asNew && editingId.value ? editingId.value : crypto.randomUUID();
    const entry: SavedMarketItem = {
      id, name: savedName.value.trim() || search.selectedItem.value!.label,
      itemKey: item.key, request, criteria,
    };
    const index = entries.value.findIndex((candidate) => candidate.id === id);
    entries.value = index < 0 ? [...entries.value, entry]
      : entries.value.map((candidate) => candidate.id === id ? entry : candidate);
    editingId.value = id;
    savedName.value = entry.name;
    message.value = `Saved entry updated. ${item.searchUnavailable ?? "Searches run only when you press Search."}`;
    return true;
  }

  function deleteSaved(id: string): void {
    const index = entries.value.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    deleted.value = { item: entries.value[index], index };
    entries.value = entries.value.filter((entry) => entry.id !== id);
    if (editingId.value === id) editingId.value = null;
    message.value = "Saved item deleted. You can undo this deletion.";
  }

  function undoDelete(): void {
    if (!deleted.value) return;
    const { item, index } = deleted.value;
    const next = [...entries.value];
    next.splice(Math.min(index, next.length), 0, item);
    entries.value = next;
    deleted.value = null;
    message.value = "Saved item restored.";
  }

  return { editingId, itemKey, savedName, message, deleted, selectItem, newSearch, loadSaved, saveDraft, deleteSaved, undoDelete };
}
