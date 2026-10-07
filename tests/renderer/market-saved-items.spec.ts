import { beforeEach, expect, test, vi } from "vitest";
import { ref } from "vue";
import { migrateShoppingList, marketItemsForName, type SavedMarketItem } from "../../src/renderer/src/lib/market-items";
import { normalizeSavedMarketItems, useSavedMarketItems } from "../../src/renderer/src/lib/saved-market-items";
import { useMarketSearchRuntime } from "../../src/renderer/src/lib/market-search-runtime";
import { createConfigurationExportPayload, defaultPreferences, importConfigurationPayload, loadPreferences, normalizePreferences, savePreferences } from "../../src/renderer/src/lib/preferences";
import { companionState } from "./fixtures";
import { installMemoryPreferencesStorage } from "../fixtures/market";

beforeEach(installMemoryPreferencesStorage);

test("legacy migration retains every name, preserves rollback data, and runs only once across saves and backups", () => {
  const original = ["Sharpshooter's Cloak", " Unknown original name ", "Copper Ore", "Copper Ore", ""];
  const migrated = normalizePreferences({ shoppingListItems: original, schemaVersion: 2 });
  expect(migrated.shoppingListItems).toEqual(original);
  expect(migrated.savedMarketItems.map((entry) => entry.name)).toEqual(original);
  expect(migrated.savedMarketItems[0]).toMatchObject({ itemKey: "unique:1:0:100", request: { itemMask: 1_073_746_020, statFilters: [] } });
  expect(migrated.savedMarketItems[1]).toMatchObject({ itemKey: null, request: null });
  migrated.savedMarketItems = migrated.savedMarketItems.slice(1);
  expect(savePreferences(migrated)).toBe(true);
  const reopened = loadPreferences();
  expect(reopened.savedMarketItems.map((entry) => entry.name)).toEqual(original.slice(1));
  expect(reopened.shoppingListItems).toEqual(original);
  const backup = createConfigurationExportPayload(reopened);
  expect(importConfigurationPayload(backup, defaultPreferences).uiPreferences.savedMarketItems).toEqual(reopened.savedMarketItems);
  expect(importConfigurationPayload({ app: "hero-siege-companion", kind: "backup", version: 2, uiPreferences: { shoppingListItems: original } }, reopened).uiPreferences.savedMarketItems.map((entry) => entry.name)).toEqual(original);
});

test("migration does not truncate long legacy lists or merge duplicate names", () => {
  const names = Array.from({ length: 105 }, (_, index) => `Preserved ${index}`);
  const result = normalizePreferences({ shoppingListItems: names });
  expect(result.shoppingListItems).toEqual(names);
  expect(result.savedMarketItems.map((entry) => entry.name)).toEqual(names);
});

test("saved filters validate identities and values at load, stay editable offline, and survive durable round trips", () => {
  const searchMarket = vi.fn();
  const readiness = ref(companionState().marketReadiness);
  readiness.value.canSearch = false;
  const search = useMarketSearchRuntime({ searchMarket, now: ref(1_000), readiness });
  const entries = ref<SavedMarketItem[]>([]);
  const saved = useSavedMarketItems(entries, search);
  const item = marketItemsForName("Sharpshooter's Cloak")[0];
  expect(item.itemMask).toBe(1_073_746_020);
  saved.selectItem(item);
  search.updateMinSockets(4);
  search.addStatFilter(64);
  search.updateStatFilter(search.statFilters.value[0].key, { minimum: 8 });
  saved.savedName.value = "Mana cloak";
  expect(saved.saveDraft()).toBe(true);
  const id = entries.value[0].id;
  saved.newSearch();
  saved.loadSaved(id);
  expect(search.draftRequest.value).toEqual({ itemMask: 1_073_746_020, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] });
  expect(searchMarket).not.toHaveBeenCalled();
  expect(search.canSearch.value).toBe(false);
  search.updateMinSockets(7);
  expect(saved.saveDraft()).toBe(false);
  search.updateMinSockets(3);
  search.updateStatFilter(search.statFilters.value[0].key, { minimum: 1_000_000_001 });
  expect(saved.saveDraft()).toBe(false);
  search.updateStatFilter(search.statFilters.value[0].key, { minimum: 9 });
  expect(saved.saveDraft()).toBe(true);
  expect(entries.value).toHaveLength(1);
  expect(entries.value[0].request!.minSockets).toBe(3);
  expect(saved.saveDraft(true)).toBe(true);
  expect(entries.value).toHaveLength(2);
  saved.deleteSaved(id);
  saved.undoDelete();
  expect(entries.value[0].id).toBe(id);
  const preferences = normalizePreferences({ ...defaultPreferences, savedMarketItems: entries.value });
  expect(savePreferences(preferences)).toBe(true);
  expect(loadPreferences().savedMarketItems).toEqual(entries.value);
  expect(normalizeSavedMarketItems([{ ...entries.value[0], request: { itemMask: 1, statFilters: [] } }])[0].request).toBeNull();
});

test("unresolved migrated names can be repaired in place without searching", () => {
  const searchMarket = vi.fn();
  const search = useMarketSearchRuntime({ searchMarket, now: ref(1_000), readiness: ref(companionState().marketReadiness) });
  const entries = ref(migrateShoppingList(["Owner original name"]));
  const saved = useSavedMarketItems(entries, search);
  saved.loadSaved("legacy-0");
  expect(saved.message.value).toContain("needs a catalog item");
  saved.selectItem(marketItemsForName("Sharpshooter's Cloak")[0]);
  expect(saved.saveDraft()).toBe(true);
  expect(entries.value).toHaveLength(1);
  expect(entries.value[0]).toMatchObject({ id: "legacy-0", name: "Owner original name", request: { itemMask: 1_073_746_020 } });
  expect(searchMarket).not.toHaveBeenCalled();
});
