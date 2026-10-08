import { beforeEach, expect, test, vi } from "vitest";
import { ref } from "vue";
import { marketItemByKey, type SavedMarketItem } from "../../src/renderer/src/lib/market-items";
import { normalizeSavedMarketItems, useSavedMarketItems } from "../../src/renderer/src/lib/saved-market-items";
import { useMarketSearchRuntime } from "../../src/renderer/src/lib/market-search-runtime";
import { createConfigurationExportPayload, defaultPreferences, importConfigurationPayload, loadPreferences, normalizePreferences, savePreferences } from "../../src/renderer/src/lib/preferences";
import { installMemoryPreferencesStorage } from "../fixtures/market";
import { companionState } from "./fixtures";

beforeEach(installMemoryPreferencesStorage);
const stats = [{ statId: 64, minimum: 8 }];
function setup(initial: SavedMarketItem[] = []) {
  const searchMarket = vi.fn(async () => ({ ok: true as const, result: { listings: [] } }));
  const search = useMarketSearchRuntime({ searchMarket, now: ref(1000), readiness: ref(companionState().marketReadiness) });
  const entries = ref(initial), saved = useSavedMarketItems(entries, search);
  return { entries, saved, search, searchMarket };
}

test("changing a target clears socket bounds, complete/incomplete stat drafts and the saved name", async () => {
  const { saved, search, searchMarket } = setup();
  saved.selectItem(marketItemByKey("unique:1:0:100")!);
  search.updateMinSockets(4); search.updateMaxSockets(6);
  search.addStatFilter(64); search.updateStatFilter(search.statFilters.value[0].key, { minimum: 8 });
  search.addStatFilter(201);
  saved.savedName.value = "Old cloak search";
  saved.selectItem(marketItemByKey("unique:4:0:0")!);
  expect(search.minSockets.value).toBeNull(); expect(search.maxSockets.value).toBeNull();
  expect(search.socketBaseRange.value).toBeNull();
  expect(search.statFilters.value).toEqual([]);
  expect(saved.savedName.value).toBe("");
  expect(search.draftValid.value).toBe(true);
  expect(searchMarket).not.toHaveBeenCalled();
  await search.searchMarket();
  expect(searchMarket).toHaveBeenCalledExactlyOnceWith({ itemMask: 1073758208, statFilters: [] });
});

test("base glove range is a hint, not a hard final-capacity restriction; explicit reselection starts fresh", () => {
  const { saved, search } = setup();
  saved.selectItem(marketItemByKey("unique:4:0:18")!);
  expect(search.socketBaseRange.value).toEqual({ minimum: 1, maximum: 2 });
  search.updateMinSockets(3); search.updateMaxSockets(6);
  expect(search.draftRequest.value).toEqual({ itemMask: 1073758226, minSockets: 3, maxSockets: 6, statFilters: [] });
  saved.selectItem(marketItemByKey("unique:4:0:18")!);
  expect(search.minSockets.value).toBeNull(); expect(search.maxSockets.value).toBeNull();
  saved.selectItem(marketItemByKey("normal:7:0:15")!);
  expect(search.minSockets.value).toBeNull(); expect(search.maxSockets.value).toBeNull();
});

test.each(["criteria", "request"])("legacy %s unknown-capacity socket bounds survive normalization, local and backup reload", source => {
  const entries = normalizeSavedMarketItems([{ id: "legacy", name: "Existing glove", itemKey: "unique:4:0:0",
    [source]: { ...(source === "request" ? { itemMask: 1073758208 } : {}), minSockets: 4, maxSockets: 6, statFilters: stats } }]);
  expect(entries[0]).toEqual({ id: "legacy", name: "Existing glove", itemKey: "unique:4:0:0",
    request: { itemMask: 1073758208, minSockets: 4, maxSockets: 6, statFilters: stats }, criteria: { minSockets: 4, maxSockets: 6, statFilters: stats } });
  const preferences = normalizePreferences({ ...defaultPreferences, savedMarketItems: entries });
  expect(savePreferences(preferences)).toBe(true);
  expect(loadPreferences().savedMarketItems).toEqual(entries);
  expect(importConfigurationPayload(createConfigurationExportPayload(preferences), defaultPreferences).uiPreferences.savedMarketItems).toEqual(entries);
  const { saved, search, searchMarket } = setup(loadPreferences().savedMarketItems);
  saved.loadSaved("legacy");
  expect(search.draftRequest.value).toEqual({ itemMask: 1073758208, minSockets: 4, maxSockets: 6, statFilters: stats });
  expect(searchMarket).not.toHaveBeenCalled();
});

test.each([9, -1, 1.5, "4"])("invalid saved socket value %s repairs only that bound and preserves other criteria", minSockets => {
  const entries = normalizeSavedMarketItems([{ id: "old", name: "Cloak", itemKey: "unique:1:0:100", criteria: { minSockets, maxSockets: 5, statFilters: stats } }]);
  expect(entries[0].criteria).toEqual({ maxSockets: 5, statFilters: stats });
  expect(entries[0].request).toEqual({ itemMask: 1073746020, maxSockets: 5, statFilters: stats });
  expect(entries[0].socketFilterAdjustment).toBe("invalid");
});

test("legacy reversed range clears both bounds visibly and repair notice survives reload until explicit save", () => {
  const entries = normalizeSavedMarketItems([{ id: "old", name: "Cloak", itemKey: "unique:1:0:100", request: { itemMask: 1073746020, minSockets: 5, maxSockets: 2, statFilters: stats } }]);
  expect(entries[0].criteria).toEqual({ statFilters: stats });
  expect(entries[0].socketFilterAdjustment).toBe("order");
  expect(savePreferences(normalizePreferences({ ...defaultPreferences, savedMarketItems: entries }))).toBe(true);
  const { saved, search, entries: reloaded } = setup(loadPreferences().savedMarketItems);
  saved.loadSaved("old");
  expect(saved.message.value).toContain("minimum was greater than maximum");
  expect(search.draftRequest.value).toEqual({ itemMask: 1073746020, statFilters: stats });
  expect(saved.saveDraft()).toBe(true);
  expect(reloaded.value[0]).not.toHaveProperty("socketFilterAdjustment");
});

test("Any omits bounds; explicit zero stays distinct; invalid range prevents save/search", async () => {
  const { saved, search, searchMarket } = setup();
  saved.selectItem(marketItemByKey("unique:1:0:100")!);
  search.updateMinSockets(5); search.updateMaxSockets(4);
  expect(search.draftValid.value).toBe(false); expect(saved.saveDraft()).toBe(false);
  await search.searchMarket(); expect(searchMarket).not.toHaveBeenCalled();
  search.updateMinSockets(0); search.updateMaxSockets(0);
  expect(search.draftRequest.value).toEqual({ itemMask: 1073746020, minSockets: 0, maxSockets: 0, statFilters: [] });
  search.updateMinSockets(null); search.updateMaxSockets(null);
  await search.searchMarket();
  expect(searchMarket).toHaveBeenCalledExactlyOnceWith({ itemMask: 1073746020, statFilters: [] });
});

test("editing maximum during a pending search and changing context suppress stale rows but retain cooldown", async () => {
  let finish!: (value: { ok: true; result: { listings: { price: number }[] }; nextAllowedSearchAt: number }) => void;
  const searchMarket = vi.fn(() => new Promise<{ ok: true; result: { listings: { price: number }[] }; nextAllowedSearchAt: number }>(resolve => { finish = resolve; }));
  const readiness = ref(companionState().marketReadiness);
  const search = useMarketSearchRuntime({ searchMarket, now: ref(1000), readiness });
  const saved = useSavedMarketItems(ref([]), search);
  saved.selectItem(marketItemByKey("unique:1:0:100")!); search.updateMaxSockets(6);
  const pending = search.searchMarket();
  expect(searchMarket).toHaveBeenCalledExactlyOnceWith({ itemMask: 1073746020, maxSockets: 6, statFilters: [] });
  search.updateMaxSockets(4); readiness.value = { ...readiness.value, contextVersion: 2 };
  await search.searchMarket(); expect(searchMarket).toHaveBeenCalledTimes(1);
  finish({ ok: true, result: { listings: [{ price: 999 }] }, nextAllowedSearchAt: 16000 }); await pending;
  expect(search.listings.value).toEqual([]); expect(search.phase.value).toBe("idle");
  expect(search.maxSockets.value).toBe(4); expect(search.cooldownRemainingSeconds.value).toBe(15);
});

test.each(["clear", "change item"])("%s detaches the saved entry and discards a pending reply without resetting admission", async action => {
  const original = normalizeSavedMarketItems([{ id: "old", name: "Old cloak", itemKey: "unique:1:0:100",
    criteria: { minSockets: 4, maxSockets: 6, statFilters: stats } }])[0];
  const entries = ref([original]);
  let finish!: (value: { ok: true; result: { listings: { price: number }[] }; nextAllowedSearchAt: number; observedAt: number; cached: boolean }) => void;
  const searchMarket = vi.fn(() => new Promise<Parameters<typeof finish>[0]>(resolve => { finish = resolve; }));
  const readiness = ref(companionState().marketReadiness);
  const beforeReadiness = companionState().marketReadiness;
  const search = useMarketSearchRuntime({ searchMarket, now: ref(1000), readiness });
  const saved = useSavedMarketItems(entries, search);
  saved.loadSaved("old"); saved.savedName.value = "Unsaved rename";
  const pending = search.searchMarket();
  if (action === "clear") saved.newSearch();
  else saved.selectItem(marketItemByKey("unique:4:0:18")!);
  expect(saved.editingId.value).toBeNull(); expect(saved.savedName.value).toBe("");
  expect(search.statFilters.value).toEqual([]);
  expect(search.minSockets.value).toBeNull(); expect(search.maxSockets.value).toBeNull();
  expect(search.searchInFlight.value).toBe(true); expect(search.canSearch.value).toBe(false);
  await search.searchMarket(); expect(searchMarket).toHaveBeenCalledTimes(1);
  finish({ ok: true, result: { listings: [{ price: 999 }] }, nextAllowedSearchAt: 16000, observedAt: 1200, cached: true });
  await pending;
  expect(search.listings.value).toEqual([]); expect(search.phase.value).toBe("idle");
  expect(search.errorMessage.value).toBe(""); expect(search.resultObservedAt.value).toBeNull(); expect(search.resultCached.value).toBe(false);
  expect(search.cooldownRemainingSeconds.value).toBe(15); expect(readiness.value).toEqual(beforeReadiness);
  expect(entries.value).toEqual([original]);
  saved.selectItem(marketItemByKey("unique:4:0:18")!);
  expect(search.cooldownRemainingSeconds.value).toBe(15);
  expect(saved.saveDraft()).toBe(true);
  expect(entries.value).toHaveLength(2); expect(entries.value[0]).toEqual(original);
  expect(entries.value[1]).toMatchObject({ name: "Zealot's Deathbringers", itemKey: "unique:4:0:18", criteria: { statFilters: [] } });
  expect(entries.value[1].id).not.toBe("old");
});
