import { beforeEach, expect, test, vi } from "vitest";
import { ref } from "vue";
import { MARKET_ITEM_OPTIONS, migrateShoppingList, marketItemsForName, marketItemSuggestions, marketItemByKey, type SavedMarketItem } from "../../src/renderer/src/lib/market-items";
import { normalizeSavedMarketItems, useSavedMarketItems } from "../../src/renderer/src/lib/saved-market-items";
import { useMarketSearchRuntime } from "../../src/renderer/src/lib/market-search-runtime";
import { createConfigurationExportPayload, defaultPreferences, importConfigurationPayload, loadPreferences, normalizePreferences, savePreferences } from "../../src/renderer/src/lib/preferences";
import { companionState, itemTimelineEntry } from "./fixtures";
import { installMemoryPreferencesStorage } from "../fixtures/market";

beforeEach(installMemoryPreferencesStorage);

test("encoded restriction preserves numeric and contextual saved criteria through reload and explicit repair",async()=>{
  const criteria={statFilters:[{statId:23,minimum:1.75},{statId:203,minimum:2},{statId:292,minimum:1}]};
  const entries=ref<SavedMarketItem[]>(normalizeSavedMarketItems([{id:"v7-old",name:"Old exploratory fields",itemKey:"normal:0:0:0",
    request:{itemMask:0,...criteria}}]));
  expect(entries.value[0]).toEqual({id:"v7-old",name:"Old exploratory fields",itemKey:"normal:0:0:0",request:null,criteria});
  const searchMarket=vi.fn(async()=>({ok:true as const,result:{listings:[]}}));
  const search=useMarketSearchRuntime({searchMarket,now:ref(1000),readiness:ref(companionState().marketReadiness)});
  const saved=useSavedMarketItems(entries,search);saved.loadSaved("v7-old");
  expect(search.draftValid.value).toBe(true);expect(search.canSearch.value).toBe(false);
  expect(saved.saveDraft()).toBe(true);
  expect(savePreferences(normalizePreferences({...defaultPreferences,savedMarketItems:entries.value}))).toBe(true);
  expect(loadPreferences().savedMarketItems).toEqual(entries.value);
  await search.searchMarket();expect(searchMarket).not.toHaveBeenCalled();
  search.removeStatFilter(search.statFilters.value.find(filter=>filter.statId===292)!.key);
  expect(saved.saveDraft()).toBe(true);await search.searchMarket();
  expect(searchMarket).toHaveBeenCalledExactlyOnceWith({itemMask:0,statFilters:[{statId:23,minimum:1.75},{statId:203,minimum:2}]});
});

test("a v7 criteria-only record is searchable after capability correction without losing filters or implicit requests",()=>{
  const criteria={statFilters:[{statId:10,minimum:1},{statId:22,minimum:6},{statId:203,minimum:2}]};
  const entries=ref<SavedMarketItem[]>(normalizeSavedMarketItems([{id:"v7-gated",name:"Experimental numeric",itemKey:"normal:0:0:0",request:null,criteria}]));
  const searchMarket=vi.fn();
  const search=useMarketSearchRuntime({searchMarket,now:ref(1000),readiness:ref(companionState().marketReadiness)});
  const saved=useSavedMarketItems(entries,search);saved.loadSaved("v7-gated");
  expect(search.draftRequest.value).toEqual({itemMask:0,...criteria});
  expect(search.canSearch.value).toBe(true);
  expect(saved.saveDraft()).toBe(true);
  expect(savePreferences(normalizePreferences({...defaultPreferences,savedMarketItems:entries.value}))).toBe(true);
  expect(loadPreferences().savedMarketItems[0]).toMatchObject({id:"v7-gated",request:{itemMask:0,...criteria},criteria});
  expect(searchMarket).not.toHaveBeenCalled();
});

test.each([
  ["Cap","normal",0,0,0,"normal:0:0:0",{itemMask:0}],
  ["Sharpshooter's Cloak","unique",1,100,0,"unique:1:0:100",{itemMask:1073746020}],
  ["Grief","runeword",3,81,0,"runeword-repository:81",{runewordId:81}],
  ["Codex of the Card Collector","runeword",11,86,0,"runeword-repository:86",{runewordId:86}],
] as const)("Timeline and picker routes save and explicitly search the same target for %s",async(label,repository,type,id,weaponType,key,target)=>{
  for (const route of ["timeline","picker"]) {
    const searchMarket=vi.fn(async()=>({ok:true as const,result:{listings:[]}}));
    const search=useMarketSearchRuntime({searchMarket,now:ref(1000),readiness:ref(companionState().marketReadiness)});
    const previous=normalizeSavedMarketItems([{id:"previous",name:"Preserved filters",itemKey:"unique:1:0:100",request:null,
      criteria:{statFilters:[{statId:185,minimum:103}]}}]);
    const entries=ref<SavedMarketItem[]>(previous),saved=useSavedMarketItems(entries,search);
    saved.loadSaved("previous");
    if (route==="timeline") expect(saved.openTimelineItem(itemTimelineEntry({repository,type,id,weaponType,label}))).toBe(true);
    else {saved.newSearch();saved.selectItem(marketItemByKey(key)!);}
    expect(saved.editingId.value).toBeNull();
    expect(saved.itemKey.value).toBe(key);
    search.updateMinSockets(4);search.addStatFilter(271);
    search.updateStatFilter(search.statFilters.value[0].key,{minimum:10});
    expect(saved.saveDraft()).toBe(true);
    expect(entries.value[0]).toEqual(previous[0]);
    expect(entries.value[1]).toMatchObject({name:label,itemKey:key,request:{...target,minSockets:4,statFilters:[{statId:271,minimum:10}]},
      criteria:{minSockets:4,statFilters:[{statId:271,minimum:10}]}});
    expect(searchMarket).not.toHaveBeenCalled();
    expect(savePreferences(normalizePreferences({...defaultPreferences,savedMarketItems:entries.value}))).toBe(true);
    expect(loadPreferences().savedMarketItems).toEqual(entries.value);
    saved.newSearch();saved.loadSaved(entries.value[1].id);
    expect(searchMarket).not.toHaveBeenCalled();
    await search.searchMarket();
    expect(searchMarket).toHaveBeenCalledExactlyOnceWith({...target,minSockets:4,statFilters:[{statId:271,minimum:10}]});
  }
});

test("exact short item names rank before broad substring matches", () => {
  expect(marketItemSuggestions("ol")[0]).toMatchObject({name:"Ol",key:"normal:15:0:1"});
  expect(marketItemSuggestions("ol")).toHaveLength(12);
  expect(marketItemSuggestions("Short Sword")[0]).toMatchObject({name:"Short Sword",key:"normal:3:1:0"});
});

test("all retained identities are discoverable, and native runeword selectors never become masks", () => {
  expect(MARKET_ITEM_OPTIONS).toHaveLength(2035);
  expect(MARKET_ITEM_OPTIONS.filter(item => item.itemMask !== null)).toHaveLength(1935);
  expect(MARKET_ITEM_OPTIONS.filter(item => item.repository === "runeword")).toHaveLength(100);
  expect(MARKET_ITEM_OPTIONS.filter(item => item.experimental)).toHaveLength(24);
  expect(new Set(MARKET_ITEM_OPTIONS.map(item => item.key)).size).toBe(2035);
  expect(marketItemsForName("Codex of the Card Collector")[0]).toMatchObject({
    key:"runeword-repository:86",itemMask:null,runewordId:86,typeLabel:"Codex · Runeword",
  });
  expect(marketItemsForName("Spelunker")[0]).toMatchObject({runewordId:88,typeLabel:"Consumable · Runeword"});
});

test("deprecated and untranslated identities retain their keys and expose honest availability", () => {
  const deprecated = MARKET_ITEM_OPTIONS.filter(item => item.name.startsWith("deprecated · definition"));
  expect(deprecated).toHaveLength(23);
  expect(deprecated.map(item=>item.key).sort()).toEqual(Array.from({length:23},(_,id)=>`unique:11:0:${id}`).sort());
  expect(deprecated.every(item=>item.availabilityNotice?.includes("Deprecated definition"))).toBe(true);
  const deck = MARKET_ITEM_OPTIONS.find(item=>item.key==="unique:3:16:13")!;
  expect(deck).toMatchObject({name:"w_throwing_darkmoon_deck (experimental)",itemMask:1140862989});
  const persisted=normalizeSavedMarketItems([{id:"legacy-placeholder",name:"Old item name",itemKey:"unique:11:0:3",request:{itemMask:1073786883,statFilters:[]}}]);
  expect(persisted[0]).toMatchObject({id:"legacy-placeholder",name:"Old item name",itemKey:"unique:11:0:3"});
});

test("new semantic gaps preserve request-only saved filters through storage, restart and repair without implicit search", async()=>{
  const searchMarket=vi.fn(async()=>({ok:true as const,result:{listings:[]}}));
  const readiness=ref(companionState().marketReadiness);readiness.value.canSearch=true;
  const search=useMarketSearchRuntime({searchMarket,readiness,now:ref(1000)});
  const criteria={minSockets:4,statFilters:[{statId:185,minimum:103},{statId:271,minimum:10}]};
  const normalized=normalizeSavedMarketItems([{id:"old",name:"Saved metadata",itemKey:"unique:1:0:100",request:{itemMask:1073746020,...criteria}}]);
  expect(normalized).toEqual([{id:"old",name:"Saved metadata",itemKey:"unique:1:0:100",request:null,criteria}]);
  const entries=ref<SavedMarketItem[]>(normalized),saved=useSavedMarketItems(entries,search);
  saved.loadSaved("old");
  expect(search.draftCriteria.value).toEqual(criteria);
  expect(search.draftValid.value).toBe(true);
  expect(search.canSearch.value).toBe(false);
  expect(saved.saveDraft()).toBe(true);
  const prefs=normalizePreferences({...defaultPreferences,savedMarketItems:entries.value});
  expect(savePreferences(prefs)).toBe(true);
  expect(loadPreferences().savedMarketItems).toEqual(normalized);
  expect(importConfigurationPayload(createConfigurationExportPayload(prefs),defaultPreferences).uiPreferences.savedMarketItems).toEqual(normalized);
  saved.deleteSaved("old");saved.undoDelete();saved.newSearch();saved.loadSaved("old");
  await search.searchMarket();expect(searchMarket).not.toHaveBeenCalled();
  search.removeStatFilter(search.statFilters.value[0].key);
  expect(saved.saveDraft()).toBe(true);
  await search.searchMarket();
  expect(searchMarket).toHaveBeenCalledExactlyOnceWith({itemMask:1073746020,minSockets:4,statFilters:[{statId:271,minimum:10}]});
});

test("runeword filters survive save, reload, backup and undo and search only explicitly", async () => {
  const searchMarket = vi.fn(async()=>({ok:true as const,result:{listings:[]}}));
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
  expect(entries.value[0]).toMatchObject({itemKey:"runeword-repository:86",request:{runewordId:86,statFilters:[{statId:271,minimum:10}]},criteria:{statFilters:[{statId:271,minimum:10}]}});
  expect(search.draftValid.value).toBe(true);
  expect(search.canSearch.value).toBe(true);
  expect(searchMarket).not.toHaveBeenCalled();
  const prefs = normalizePreferences({...defaultPreferences,savedMarketItems:entries.value});
  expect(savePreferences(prefs)).toBe(true);
  const loaded = loadPreferences();
  expect(loaded.savedMarketItems).toEqual(entries.value);
  expect(importConfigurationPayload(createConfigurationExportPayload(loaded),defaultPreferences).uiPreferences.savedMarketItems).toEqual(entries.value);
  saved.deleteSaved("legacy-0"); saved.undoDelete(); saved.newSearch(); saved.loadSaved("legacy-0");
  expect(search.draftCriteria.value).toEqual({statFilters:[{statId:271,minimum:10}]});
  expect(searchMarket).not.toHaveBeenCalled();
  await search.searchMarket();
  expect(searchMarket).toHaveBeenCalledExactlyOnceWith({runewordId:86,statFilters:[{statId:271,minimum:10}]});
});

test("pending runeword criteria survive actual native-selector promotion and durable reload", () => {
  const searchMarket = vi.fn();
  const search = useMarketSearchRuntime({searchMarket,now:ref(1000),readiness:ref(companionState().marketReadiness)});
  // Reconstructed old c02/ab8 schema3 record, where Grief's key used case1.
  const persisted = [{id:"pending-grief",name:"Grief",itemKey:"runeword:3:0:1",request:null,
    criteria:{minSockets:4,statFilters:[{statId:271,minimum:10}]}}];
  const promoted = normalizeSavedMarketItems(persisted);
  const entries = ref<SavedMarketItem[]>(promoted);
  const saved = useSavedMarketItems(entries,search);
  expect(promoted[0]).toMatchObject({id:"pending-grief",name:"Grief",itemKey:"runeword-repository:81",
    request:{runewordId:81,minSockets:4,statFilters:[{statId:271,minimum:10}]},
    criteria:{minSockets:4,statFilters:[{statId:271,minimum:10}]}});
  expect(promoted[0].request).not.toHaveProperty("itemMask");
  saved.loadSaved("pending-grief");
  expect(search.draftRequest.value).toEqual({runewordId:81,minSockets:4,statFilters:[{statId:271,minimum:10}]});
  expect(saved.saveDraft()).toBe(true);
  const prefs=normalizePreferences({...defaultPreferences,savedMarketItems:entries.value});
  expect(savePreferences(prefs)).toBe(true);
  expect(loadPreferences().savedMarketItems).toEqual(promoted);
  expect(normalizeSavedMarketItems(loadPreferences().savedMarketItems)).toEqual(promoted);
  expect(importConfigurationPayload(createConfigurationExportPayload(prefs),defaultPreferences).uiPreferences.savedMarketItems).toEqual(promoted);
  expect(searchMarket).not.toHaveBeenCalled();
});

test("switching runeword to normal and clearing drops selectors and stale in-flight results", async()=>{
  let finish!: (value:{ok:true;result:{listings:{price:number}[]}})=>void;
  const searchMarket=vi.fn(()=>new Promise<{ok:true;result:{listings:{price:number}[]}}>(resolve=>{finish=resolve;}));
  const readiness=ref(companionState().marketReadiness);readiness.value.canSearch=true;
  const runtime=useMarketSearchRuntime({searchMarket,readiness,now:ref(1000)});
  const saved=useSavedMarketItems(ref([]),runtime);
  saved.selectItem(marketItemsForName("Grief")[0]);
  expect(runtime.draftRequest.value).toEqual({runewordId:81,statFilters:[]});
  const pending=runtime.searchMarket();
  expect(searchMarket).toHaveBeenCalledExactlyOnceWith({runewordId:81,statFilters:[]});
  saved.selectItem(marketItemsForName("Sharpshooter's Cloak")[0]);
  expect(runtime.draftRequest.value).toEqual({itemMask:1073746020,statFilters:[]});
  await runtime.searchMarket();expect(searchMarket).toHaveBeenCalledTimes(1);
  finish({ok:true,result:{listings:[{price:999}]}});await pending;
  expect(runtime.listings.value).toEqual([]);
  expect(runtime.phase.value).toBe("idle");
  saved.selectItem(marketItemsForName("Grief")[0]);
  readiness.value={...readiness.value,contextVersion:2};
  expect(runtime.listings.value).toEqual([]);
  saved.newSearch();expect(runtime.draftRequest.value).toBeNull();
  saved.selectItem(marketItemsForName("Short Sword")[0]);
  expect(runtime.draftRequest.value).toEqual({itemMask:4206592,statFilters:[]});
  expect(runtime.draftRequest.value).not.toHaveProperty("runewordId");
});

test("ready items retain criteria without a stored request and prefer them over stale encoded filters", () => {
  const criteria = {minSockets:4,statFilters:[{statId:271,minimum:10}]};
  const raw = {id:"future",name:"Cloak",itemKey:"unique:1:0:100",request:null,criteria};
  const entries = ref(normalizeSavedMarketItems([raw]));
  expect(entries.value[0]).toEqual({...raw,request:{itemMask:1073746020,...criteria}});
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
  expect(normalizeSavedMarketItems([{ ...entries.value[0], request: { itemMask: 1, statFilters: [] } }])[0].request).toEqual({itemMask:1073746020,minSockets:3,statFilters:[{statId:64,minimum:9}]});
});

test("choosing a catalog item after loading an unresolved migrated name preserves the original and starts a new filter", () => {
  const searchMarket = vi.fn();
  const search = useMarketSearchRuntime({ searchMarket, now: ref(1_000), readiness: ref(companionState().marketReadiness) });
  const entries = ref(migrateShoppingList(["Owner original name"]));
  const saved = useSavedMarketItems(entries, search);
  saved.loadSaved("legacy-0");
  expect(saved.message.value).toContain("has no catalog match");
  saved.selectItem(marketItemsForName("Sharpshooter's Cloak")[0]);
  expect(saved.saveDraft()).toBe(true);
  expect(entries.value).toHaveLength(2);
  expect(entries.value[0]).toMatchObject({ id: "legacy-0", name: "Owner original name", itemKey: null, request: null });
  expect(entries.value[1]).toMatchObject({ name: "Sharpshooter's Cloak", request: { itemMask: 1_073_746_020 } });
  expect(entries.value[1].id).not.toBe("legacy-0");
  expect(searchMarket).not.toHaveBeenCalled();
});
