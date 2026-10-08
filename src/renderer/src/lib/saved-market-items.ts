import { ref, type Ref } from "vue";
import { normalizeMarketFilterCriteria, normalizeMarketSearchRequest } from "../../../shared/market-search";
import { marketItemByKey, type MarketItemOption, type SavedMarketItem } from "./market-items";
import type { useMarketSearchRuntime } from "./market-search-runtime";

export function normalizeSavedMarketItems(value: unknown): SavedMarketItem[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.flatMap((raw, index): SavedMarketItem[] => {
    if (!raw || typeof raw !== "object" || typeof raw.name !== "string") return [];
    let id = typeof raw.id === "string" && raw.id ? raw.id : `saved-${index}`;
    while (usedIds.has(id)) id += `-${index}`;
    usedIds.add(id);
    const item = marketItemByKey(typeof raw.itemKey === "string" ? raw.itemKey : null);
    const normalized = normalizeMarketSearchRequest(raw.request);
    const request = item && normalized.ok && normalized.request.itemMask === item.itemMask
      ? normalized.request : null;
    const pending = normalizeMarketFilterCriteria(raw.criteria);
    const criteria = item?.itemMask === null && pending.ok ? pending.criteria : null;
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
    search.openMarketCatalogDraft({ label: item.name, rarity: item.typeLabel }, item.itemMask, { statFilters: [] });
    message.value = item.searchUnavailable ?? "";
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
    itemKey.value = entry.itemKey;
    const item = marketItemByKey(entry.itemKey);
    if (item && (entry.request || entry.criteria)) {
      search.openMarketCatalogDraft({ label: item.name, rarity: item.typeLabel }, item.itemMask, entry.request ?? entry.criteria!);
      message.value = item.searchUnavailable ?? "Filters loaded. Press Search when you are ready.";
    } else {
      search.closeMarketSearch();
      message.value = "This saved name needs a catalog item. Choose an item, then save the repaired entry.";
    }
  }

  function saveDraft(asNew = false): boolean {
    const request = search.draftRequest.value;
    const criteria = search.draftCriteria.value;
    const item = marketItemByKey(itemKey.value);
    if (!criteria || !item || (item.itemMask !== null && request?.itemMask !== item.itemMask)) return false;
    const id = !asNew && editingId.value ? editingId.value : crypto.randomUUID();
    const entry: SavedMarketItem = {
      id, name: savedName.value.trim() || search.selectedItem.value!.label,
      itemKey: itemKey.value, request,
      ...(item.itemMask === null ? { criteria } : {}),
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
