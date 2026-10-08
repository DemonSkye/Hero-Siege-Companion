import { beforeEach, expect, test, vi } from "vitest";
import { ref } from "vue";
import { MARKET_ITEM_OPTIONS, migrateShoppingList, marketItemsForName, marketItemSuggestions, type SavedMarketItem } from "../../src/renderer/src/lib/market-items";
import { normalizeSavedMarketItems, useSavedMarketItems } from "../../src/renderer/src/lib/saved-market-items";
import { useMarketSearchRuntime } from "../../src/renderer/src/lib/market-search-runtime";
import { createConfigurationExportPayload, defaultPreferences, importConfigurationPayload, loadPreferences, normalizePreferences, savePreferences } from "../../src/renderer/src/lib/preferences";
import { companionState } from "./fixtures";
import { installMemoryPreferencesStorage } from "../fixtures/market";

beforeEach(installMemoryPreferencesStorage);

test("exact short item names rank before broad substring matches", () => {
  expect(marketItemSuggestions("ol")[0]).toMatchObject({name:"Ol",key:"normal:15:0:1"});
  expect(marketItemSuggestions("ol")).toHaveLength(12);
  expect(marketItemSuggestions("Short Sword")[0]).toMatchObject({name:"Short Sword",key:"normal:3:1:0"});
});

test("all retained identities are discoverable, while unproved runeword selectors never become masks", () => {
  expect(MARKET_ITEM_OPTIONS).toHaveLength(2035);
  expect(MARKET_ITEM_OPTIONS.filter(item => item.itemMask !== null)).toHaveLength(1935);
  expect(MARKET_ITEM_OPTIONS.filter(item => item.repository === "runeword")).toHaveLength(100);
  expect(MARKET_ITEM_OPTIONS.filter(item => item.experimental)).toHaveLength(24);
  expect(new Set(MARKET_ITEM_OPTIONS.map(item => item.key)).size).toBe(2035);
  expect(marketItemsForName("Codex of the Card Collector")[0]).toMatchObject({
    key:"runeword:3:0:93",itemMask:null,typeLabel:"Codex · Runeword",
  });
});

test("runeword filters survive save, reload, backup and undo while encoding remains blocked", async () => {
  const searchMarket = vi.fn();
  const readiness = ref(companionState().marketReadiness);
  readiness.value.canSearch = true;
  const search = useMarketSearchRuntime({searchMarket,now:ref(1000),readiness});
  const entries = ref<SavedMarketItem[]>(migrateShoppingList(["Codex of the Card Collector"]));
  const saved = useSavedMarketItems(entries,search);
  saved.loadSaved("legacy-0");
  expect(search.selectedItem.value?.label).toBe("Codex of the Card Collector");
  search.addStatFilter(271);
  search.updateStatFilter(search.statFilters.value[0].key,{minimum:10});
  expect(saved.saveDraft()).toBe(true);
  expect(saved.message.value).toContain("Runeword search encoding is not verified");
  expect(entries.value[0]).toMatchObject({itemKey:"runeword:3:0:93",request:null,criteria:{statFilters:[{statId:271,minimum:10}]}});
  expect(search.draftValid.value).toBe(true);
  expect(search.canSearch.value).toBe(false);
  await search.searchMarket();
  expect(searchMarket).not.toHaveBeenCalled();
  const prefs = normalizePreferences({...defaultPreferences,savedMarketItems:entries.value});
  expect(savePreferences(prefs)).toBe(true);
  const loaded = loadPreferences();
  expect(loaded.savedMarketItems).toEqual(entries.value);
  expect(importConfigurationPayload(createConfigurationExportPayload(loaded),defaultPreferences).uiPreferences.savedMarketItems).toEqual(entries.value);
  saved.deleteSaved("legacy-0"); saved.undoDelete(); saved.newSearch(); saved.loadSaved("legacy-0");
  expect(search.draftCriteria.value).toEqual({statFilters:[{statId:271,minimum:10}]});
  expect(saved.message.value).toContain("Runeword search encoding is not verified");
  expect(searchMarket).not.toHaveBeenCalled();
});

test("pending runeword criteria survive promotion to an identity with a separate native selector", () => {
  const searchMarket = vi.fn();
  const search = useMarketSearchRuntime({searchMarket,now:ref(1000),readiness:ref(companionState().marketReadiness)});
  const entries = ref<SavedMarketItem[]>([]);
  const saved = useSavedMarketItems(entries,search);
  saved.selectItem(marketItemsForName("Grief")[0]);
  search.updateMinSockets(4);
  search.addStatFilter(271);
  search.updateStatFilter(search.statFilters.value[0].key,{minimum:10});
  expect(saved.saveDraft()).toBe(true);
  const persisted = JSON.parse(JSON.stringify(entries.value));
  expect(persisted[0]).toMatchObject({itemKey:"runeword:3:0:1",request:null,
    criteria:{minSockets:4,statFilters:[{statId:271,minimum:10}]}});

  // Research v4 proves Grief's repository/selector ID81. This models a future
  // catalog migration/encoder boundary, not enabled product search. No mask is
  // supplied: runewords use filter_runeword independently of filter_masks.
  const promotedIdentity = {key:"runeword-repository:81",filterRuneword:81};
  const promoted = normalizeSavedMarketItems(persisted,key=>key==="runeword:3:0:1" ? promotedIdentity : null);
  expect(promoted[0]).toMatchObject({id:persisted[0].id,name:"Grief",itemKey:"runeword-repository:81",request:null,
    criteria:{minSockets:4,statFilters:[{statId:271,minimum:10}]}});
  expect(promoted[0]).not.toHaveProperty("itemMask");
  // A subsequent encoder receives the original saved values after promotion.
  expect({filter_runeword:promotedIdentity.filterRuneword,...promoted[0].criteria}).toEqual({
    filter_runeword:81,minSockets:4,statFilters:[{statId:271,minimum:10}],
  });
  expect(searchMarket).not.toHaveBeenCalled();
});

test("ready items retain criteria without a stored request and prefer them over stale encoded filters", () => {
  const criteria = {minSockets:4,statFilters:[{statId:271,minimum:10}]};
  const raw = {id:"future",name:"Cloak",itemKey:"unique:1:0:100",request:null,criteria};
  const entries = ref(normalizeSavedMarketItems([raw]));
  expect(entries.value[0]).toEqual(raw);
  const searchMarket = vi.fn();
  const readiness = ref(companionState().marketReadiness);
  readiness.value.canSearch = true;
  const search = useMarketSearchRuntime({searchMarket,now:ref(1000),readiness});
  const saved = useSavedMarketItems(entries,search);
  saved.loadSaved("future");
  expect(search.draftRequest.value).toEqual({itemMask:1073746020,...criteria});
  expect(search.canSearch.value).toBe(true);
  expect(saved.saveDraft()).toBe(true);
  expect(entries.value[0].criteria).toEqual(criteria);
  const conflicting = normalizeSavedMarketItems([{...entries.value[0],request:{itemMask:1073746020,statFilters:[]}}]);
  entries.value = conflicting;
  saved.loadSaved("future");
  expect(search.draftRequest.value).toEqual({itemMask:1073746020,...criteria});
  expect(searchMarket).not.toHaveBeenCalled();
});

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
