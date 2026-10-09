import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, expect, test, vi } from "vitest";
import App from "../../src/renderer/src/App.vue";
import type { HeroSiegeCompanionApi } from "../../src/shared/ipc";
import type { CompanionState, CompanionStateUpdate } from "../../src/shared/app-state";
import type { MarketSearchResponse } from "../../src/shared/market-search";
import { companionState } from "./fixtures";
import { installMemoryPreferencesStorage } from "../fixtures/market";
import listingFixture from "../fixtures/market-listing-items.json";
import { deflateSync } from "node:zlib";
import { inspectDirectMarketResponse } from "../../src/main/market-direct-response";
import { handleMarketSearchRequest } from "../../src/main/market-search-handler";

const storageKey = "hero-siege-companion:preferences:v1";
const recoveryCopy = "With capture running, search for an item in the game’s Market or perform an in-game vote reset to collect the information needed.";
const stubs = {
  AppTitlebar: { template: "<div />" }, CompactView: { template: "<div />" },
  LiveSessionHeader: { template: "<div />" }, LiveView: { template: "<div />" },
  PastRunsView: { template: "<div />" }, ItemFilterView: { template: "<div />" },
  UpdateBanner: { template: "<div />" }, WhatsNewPrompt: { template: "<div />" },
};

beforeEach(installMemoryPreferencesStorage);

function setup(state: CompanionState = companionState()) {
  let update: (state: CompanionStateUpdate) => void = () => undefined;
  const api = {
    getState: vi.fn(async () => state), getGameExecutable: vi.fn(async () => null), setCompactMode: vi.fn(), setAlwaysOnTop: vi.fn(),
    getSupportDiagnosticsInfo: vi.fn(async () => ({ generatedFiles: [], logFiles: [] })),
    checkForUpdate: vi.fn(async () => null), searchMarket: vi.fn(async (): Promise<MarketSearchResponse> => ({ ok: true, result: { listings: [] } })),
    onStateUpdated: (listener: typeof update) => { update = listener; return () => { update = () => undefined; }; },
  };
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: api as unknown as HeroSiegeCompanionApi });
  return { api, emit: (next: CompanionState) => { state = next; update(next); } };
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  const match = wrapper.findAll("button").find((candidate) => candidate.text() === text);
  if (!match) throw new Error(`Missing button ${text}`);
  return match;
}

test("real Market editor starts fresh on item change and preserves the original saved entry across reopen", async () => {
  window.localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 3, shoppingListItems: [], savedMarketItems: [
    { id: "legacy-glove", name: "Legacy gloves", itemKey: "unique:4:0:0",
      request: { itemMask: 1073758208, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] } },
  ] }));
  const { api } = setup();
  let wrapper = mount(App, { attachTo: document.body, global: { stubs } });
  try {
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-saved-load").exists()).toBe(true));
    await wrapper.get(".market-saved-load").trigger("click"); await flushPromises();
    expect((wrapper.get("#market-sockets").element as HTMLInputElement).value).toBe("4");
    expect(wrapper.get(".market-filter-summary").text()).toContain("4+ sockets");
    expect(wrapper.text()).toContain("Socket capacity is unverified");
    expect(document.activeElement?.id).toBe("market-sockets");
    expect((wrapper.get(".market-stat-row input").element as HTMLInputElement).value).toBe("8");
    await wrapper.get("form.market-editor").trigger("submit"); await flushPromises();
    expect(api.searchMarket).toHaveBeenCalledExactlyOnceWith({ itemMask: 1073758208, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] });
    await wrapper.get("#market-stat-query").setValue("unfinished stat search");
    await wrapper.get("#market-saved-name").setValue("Unsaved old name");
    await button(wrapper, "Change item").trigger("click");
    await wrapper.get("#market-item-query").setValue("Sharpshooter's Cloak");
    await wrapper.get(".market-options button").trigger("click");
    expect(wrapper.get("#market-sockets").attributes()).toMatchObject({ min: "0", max: "6", placeholder: "Any" });
    expect(wrapper.get(".market-socket-hint").text()).toContain("Base socket range: 2–4");
    expect(wrapper.findAll(".market-stat-row")).toHaveLength(0);
    expect((wrapper.get("#market-stat-query").element as HTMLInputElement).value).toBe("");
    expect((wrapper.get("#market-saved-name").element as HTMLInputElement).value).toBe("");
    expect(wrapper.find(".market-saved-list .selected").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Save changes");
    await wrapper.get("#market-sockets").setValue("4");
    await wrapper.get("#market-sockets-max").setValue("6");
    await button(wrapper, "Change item").trigger("click");
    await wrapper.get("#market-item-query").setValue("Zealot's Deathbringers");
    await wrapper.get(".market-options button").trigger("click");
    expect(wrapper.get("#market-sockets").attributes()).toMatchObject({ min: "0", max: "6" });
    expect(wrapper.get(".market-socket-hint").text()).toContain("Base socket range: 1–2");
    expect((wrapper.get("#market-sockets").element as HTMLInputElement).value).toBe("");
    expect((wrapper.get("#market-sockets-max").element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).not.toContain("Socket range cleared");
    expect(wrapper.findAll(".market-stat-row")).toHaveLength(0);
    await button(wrapper, "Save item and filters").trigger("click"); await flushPromises();
    const persisted = JSON.parse(window.localStorage.getItem(storageKey)!).savedMarketItems;
    expect(persisted).toHaveLength(2);
    expect(persisted[0]).toMatchObject({ id: "legacy-glove", name: "Legacy gloves", itemKey: "unique:4:0:0",
      request: { itemMask: 1073758208, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] } });
    expect(persisted[1]).toMatchObject({
      name: "Zealot's Deathbringers", itemKey: "unique:4:0:18", request: { itemMask: 1073758226, statFilters: [] },
      criteria: { statFilters: [] },
    });
    wrapper.unmount(); wrapper = mount(App, { global: { stubs } });
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-saved-load").exists()).toBe(true));
    await wrapper.findAll(".market-saved-load")[1].trigger("click");
    expect((wrapper.get("#market-sockets").element as HTMLInputElement).value).toBe("");
    expect(wrapper.findAll(".market-stat-row")).toHaveLength(0);
    await wrapper.findAll(".market-saved-load")[0].trigger("click");
    expect((wrapper.get("#market-sockets").element as HTMLInputElement).value).toBe("4");
    expect((wrapper.get(".market-stat-row input").element as HTMLInputElement).value).toBe("8");
    expect(api.searchMarket).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});

test("Clear resets the unsaved editor, partial queries and saved selection without deleting saved items or searching", async () => {
  window.localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 3, savedMarketItems: [
    { id: "old", name: "Saved cloak", itemKey: "unique:1:0:100", criteria: { minSockets: 4, maxSockets: 6, statFilters: [{ statId: 64, minimum: 8 }] } },
  ] }));
  const { api } = setup(); const wrapper = mount(App, { attachTo: document.body, global: { stubs } });
  try {
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-saved-load").exists()).toBe(true));
    await wrapper.get(".market-saved-load").trigger("click");
    await wrapper.get("#market-saved-query").setValue("cloak");
    await wrapper.get("#market-stat-query").setValue("life");
    await wrapper.get('ul[aria-label="Stat suggestions"] button').trigger("click");
    await wrapper.get("#market-stat-query").setValue("unfinished");
    await wrapper.get("#market-saved-name").setValue("Unsaved name");
    await button(wrapper, "Change item").trigger("click");
    await wrapper.get("#market-item-query").setValue("partial item");
    const persisted = window.localStorage.getItem(storageKey);
    await button(wrapper, "Clear").trigger("click"); await flushPromises();
    expect(wrapper.find(".market-chosen-item").exists()).toBe(false);
    expect(wrapper.findAll(".market-stat-row")).toHaveLength(0);
    expect(wrapper.find(".market-saved-list .selected").exists()).toBe(false);
    for (const id of ["market-item-query", "market-stat-query", "market-saved-query", "market-saved-name"])
      expect((wrapper.get(`#${id}`).element as HTMLInputElement).value).toBe("");
    expect(document.activeElement?.id).toBe("market-item-query");
    expect(window.localStorage.getItem(storageKey)).toBe(persisted);
    expect(wrapper.findAll(".market-saved-load")).toHaveLength(1);
    expect(api.searchMarket).not.toHaveBeenCalled();
    expect(wrapper.get(".market-form-actions").findAll("button").map(b => b.text())).toEqual(["Search market", "Clear", "Save item and filters"]);
    await wrapper.get(".market-saved-load").trigger("click");
    expect((wrapper.get("#market-sockets").element as HTMLInputElement).value).toBe("4");
    expect((wrapper.get("#market-sockets-max").element as HTMLInputElement).value).toBe("6");
    expect((wrapper.get(".market-stat-row input").element as HTMLInputElement).value).toBe("8");
  } finally { wrapper.unmount(); }
});

test("the real catalog card shows Gryphon's compound talent and percent phrase with provenance inside Details", async () => {
  const { api } = setup(); const wrapper = mount(App, { global: { stubs } });
  try {
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue("Gryphon's Claw");
    await wrapper.get(".market-options button").trigger("click");
    const card = wrapper.get(".market-catalog-ranges");
    expect(card.get(".market-range-list").text()).toContain("+[12\u201318] to [Execute]");
    expect(card.get(".market-range-list").text()).toContain("+[15\u201325]% Chance to Open Wounds");
    expect(card.findAll(".market-range-list > div")).toHaveLength(5);
    expect(card.get(".market-range-list").text()).not.toMatch(/Identifier:|Stat 202|Stat 203/);
    expect(card.get("details summary").text()).toBe("Details");
    expect(card.get("details").attributes("open")).toBeUndefined();
    expect(card.get("footer > small").text()).toBe("Experimental base ranges.");
    expect(card.get("details").text()).toContain("Build 24868792");
    expect(api.searchMarket).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});

test("the stat panel keeps its place beside the filters with a placeholder until an item is chosen", async () => {
  setup(); const wrapper = mount(App, { global: { stubs } });
  try {
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    const panel = () => wrapper.get(".market-filter-layout > :nth-child(2)");
    expect(wrapper.get(".market-filter-layout > :first-child").element.tagName).toBe("FIELDSET");
    expect(panel().classes()).toEqual(expect.arrayContaining(["market-catalog-ranges", "market-catalog-placeholder"]));
    expect(panel().text()).toBe("Choose an item to see its stats.");
    expect(panel().attributes("aria-labelledby")).toBeUndefined();
    expect(panel().find("button, input, a, [tabindex], [role]").exists()).toBe(false);
    expect(panel().find(".market-range-list").exists()).toBe(false);
    await wrapper.get("#market-item-query").setValue("Gryphon's Claw");
    await wrapper.get(".market-options button").trigger("click");
    expect(wrapper.findAll(".market-filter-layout > *")).toHaveLength(2);
    expect(wrapper.find(".market-catalog-placeholder").exists()).toBe(false);
    expect(panel().element.tagName).toBe("SECTION");
    expect(panel().attributes("aria-labelledby")).toBe("market-ranges-title");
    expect(panel().get("#market-ranges-title").text()).toBe("Gryphon's Claw");
    expect(panel().findAll(".market-range-list > div")).toHaveLength(5);
    await button(wrapper, "Clear").trigger("click"); await flushPromises();
    expect(panel().classes()).toContain("market-catalog-placeholder");
    expect(wrapper.find(".market-range-list").exists()).toBe(false);
  } finally { wrapper.unmount(); }
});

test.each(["before", "after"] as const)("Market tab shows recovery guidance once when region status arrives %s the failed request", async (order) => {
  const initial = companionState();
  initial.marketReadiness = { ...initial.marketReadiness, phase: "region-required", reason: "region_unprepared", regionQualified: false };
  const { api, emit } = setup(initial);
  const failed = companionState({ marketReadiness: { ...initial.marketReadiness, phase: "region-error", reason: "region_unavailable" } });
  api.searchMarket.mockImplementationOnce(async () => {
    if (order === "before") emit(failed);
    return { ok: false, errorCode: "template_unavailable" };
  });
  const wrapper = mount(App, { global: { stubs } });
  try {
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click"); await flushPromises();
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue("Sharpshooter's Cloak");
    await wrapper.get(".market-options button").trigger("click"); await flushPromises();
    await wrapper.get("form.market-editor").trigger("submit"); await flushPromises();
    if (order === "after") { emit(failed); await flushPromises(); }
    expect(wrapper.get('.market-readiness [role="status"]').text()).toBe("Market not ready");
    expect(wrapper.get(".market-readiness-detail").text()).toBe("Session captured, but region information could not be confirmed. " + recoveryCopy);
    expect(wrapper.text().split(recoveryCopy)).toHaveLength(2);
    expect(wrapper.find(".market-search-error").exists()).toBe(false);
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    expect(button(wrapper, "Search market").attributes("disabled")).toBeUndefined();
    expect(api.searchMarket).toHaveBeenCalledExactlyOnceWith({ itemMask: 1073746020, statFilters: [] });
  } finally { wrapper.unmount(); }
});

test("offline Market shows full cloak ranges and saves an experimental filter through restart", async () => {
  window.localStorage.setItem(storageKey, JSON.stringify({schemaVersion:3,savedMarketItems:[],shoppingListItems:[]}));
  const initial = companionState();
  initial.marketReadiness.canSearch = false;
  const {api} = setup(initial);
  let wrapper = mount(App,{global:{stubs}});
  try {
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue("Sharpshooter's Cloak");
    await wrapper.get(".market-options button").trigger("click");
    expect(wrapper.findAll(".market-range-list > div")).toHaveLength(12);
    expect(wrapper.get(".market-catalog-ranges").text()).toContain("Ranged Skills[6–12]");
    expect(wrapper.get(".market-catalog-ranges").text()).toContain("All Skills[2]");
    await wrapper.get("#market-stat-query").setValue("ranged");
    expect(wrapper.get('ul[aria-label="Stat suggestions"]').text()).toContain("Ranged Skills (experimental)");
    await wrapper.get('ul[aria-label="Stat suggestions"] button').trigger("click");
    await wrapper.get(".market-stat-row input").setValue("10");
    await button(wrapper,"Save item and filters").trigger("click");
    await flushPromises();
    expect(api.searchMarket).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).savedMarketItems[0].request).toEqual({itemMask:1073746020,statFilters:[{statId:271,minimum:10}]});
    wrapper.unmount(); wrapper = mount(App,{global:{stubs}});
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-saved-load").exists()).toBe(true));
    await wrapper.get(".market-saved-load").trigger("click");
    expect(wrapper.get(".market-stat-row label").text()).toContain("Ranged Skills (experimental)");
    expect((wrapper.get(".market-stat-row input").element as HTMLInputElement).value).toBe("10");
    expect(wrapper.findAll(".market-range-list > div")).toHaveLength(12);
    expect(api.searchMarket).not.toHaveBeenCalled();
  } finally {wrapper.unmount();}
});

test("real Market tab migrates, loads, edits, persists and reopens saved filters without implicit searches", async () => {
  window.localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 2, shoppingListItems: ["Sharpshooter's Cloak", "Owner unknown item"] }));
  const { api } = setup();
  let wrapper = mount(App, { attachTo: document.body, global: { stubs } });
  try {
    await flushPromises();
    await wrapper.get("#view-tab-market").trigger("click");
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    expect(wrapper.get("#view-panel-market").attributes("aria-labelledby")).toBe("view-tab-market");
    expect(wrapper.text()).toContain("Owner unknown item");
    expect(wrapper.find(".shopping-list").exists()).toBe(false);
    await wrapper.findAll(".market-saved-load")[0].trigger("click");
    await flushPromises();
    expect(document.activeElement?.id).toBe("market-sockets");
    await wrapper.get("#market-sockets").setValue("4");
    await wrapper.get("#market-stat-query").setValue("mana stolen");
    await wrapper.get('ul[aria-label="Stat suggestions"] button').trigger("click");
    await flushPromises();
    await wrapper.get(".market-stat-row input").setValue("8");
    await wrapper.get("#market-saved-name").setValue("Mana cloak");
    await button(wrapper, "Save changes").trigger("click");
    await flushPromises();
    expect(api.searchMarket).not.toHaveBeenCalled();
    const durable = JSON.parse(window.localStorage.getItem(storageKey)!);
    expect(durable).toMatchObject({ schemaVersion: 3, shoppingListItems: ["Sharpshooter's Cloak", "Owner unknown item"], savedMarketItems: [
      { id: "legacy-0", name: "Mana cloak", itemKey: "unique:1:0:100", request: { itemMask: 1_073_746_020, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] } },
      { id: "legacy-1", name: "Owner unknown item", request: null },
    ] });
    await wrapper.get("#view-tab-live").trigger("click");
    await wrapper.get("#view-tab-market").trigger("click");
    await flushPromises();
    expect((wrapper.get("#market-sockets").element as HTMLInputElement).value).toBe("4");
    wrapper.unmount();
    wrapper = mount(App, { attachTo: document.body, global: { stubs } });
    await flushPromises();
    await wrapper.get("#view-tab-market").trigger("click");
    await flushPromises();
    await wrapper.findAll(".market-saved-load")[0].trigger("click");
    await flushPromises();
    expect((wrapper.get(".market-stat-row input").element as HTMLInputElement).value).toBe("8");
    expect(api.searchMarket).not.toHaveBeenCalled();
    await wrapper.get('button[aria-label="Delete saved item Mana cloak"]').trigger("click");
    await flushPromises();
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).savedMarketItems).toHaveLength(1);
    await button(wrapper, "Undo delete").trigger("click");
    await flushPromises();
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).savedMarketItems[0].name).toBe("Mana cloak");
  } finally { wrapper.unmount(); }
});

test("real tab handles unavailable, loading, rejected, empty and price states while retaining filter edits", async () => {
  const initial = companionState();
  initial.marketReadiness = { ...initial.marketReadiness, contextVersion: 1, canSearch: false, phase: "waiting", reason: "capture_inactive" };
  const { api, emit } = setup(initial);
  const wrapper = mount(App, { attachTo: document.body, global: { stubs } });
  try {
    await flushPromises();
    await wrapper.get("#view-tab-market").trigger("click"); await flushPromises();
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue("Sharpshooter's Cloak");
    await wrapper.get(".market-options button").trigger("click"); await flushPromises();
    await wrapper.get("#market-sockets").setValue("4");
    expect(button(wrapper, "Search market").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".market-results").text()).toContain("waiting for current session evidence");
    const readinessStatus = wrapper.get(".market-readiness");
    expect(readinessStatus.get('[role="status"]').text()).toBe("Market not ready");
    expect(readinessStatus.text()).toContain("Start capture");
    expect(readinessStatus.text()).toContain(recoveryCopy);
    expect(wrapper.text().split(recoveryCopy)).toHaveLength(2);
    expect(readinessStatus.text()).not.toMatch(/\d\/6|fields received/);
    expect(readinessStatus.get(".market-readiness-light").attributes("aria-hidden")).toBe("true");
    expect(button(wrapper, "Save item and filters").attributes("disabled")).toBeUndefined();
    emit(companionState({ marketReadiness: { ...companionState().marketReadiness, contextVersion: 1 } })); await flushPromises();
    expect(readinessStatus.get('[role="status"]').text()).toBe("Market ready");
    let settle!: (response: MarketSearchResponse) => void;
    api.searchMarket.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    await wrapper.get("form.market-editor").trigger("submit");
    expect(wrapper.get(".market-results").text()).toContain("Searching current listings");
    await wrapper.get("form.market-editor").trigger("submit");
    expect(api.searchMarket).toHaveBeenCalledOnce();
    expect(api.searchMarket).toHaveBeenCalledWith({ itemMask: 1_073_746_020, minSockets: 4, statFilters: [] });
    settle({ ok: false, errorCode: "checksum_rejected", nextAllowedSearchAt: Date.now() + 14_000 });
    await flushPromises();
    expect(wrapper.get(".market-results").text()).toContain("market rejected this request's checksum");
    expect(readinessStatus.get('[role="status"]').text()).toBe("Market ready");
    expect(readinessStatus.text()).not.toMatch(/\d\/6|fields received|vote reset/);
    expect(wrapper.get("form.market-editor").text()).toContain("4+ sockets");
    expect(wrapper.text()).toMatch(/Next search available in 1[45]s/);
    // Reopen with a different API response: cooldown is process-local and no
    // returned prices/context are persisted by renderer preferences.
  } finally { wrapper.unmount(); }

  api.searchMarket.mockResolvedValue({ ok: true, result: { listings: [] } });
  const reopened = mount(App, { global: { stubs } });
  try {
    await flushPromises(); await reopened.get("#view-tab-market").trigger("click"); await flushPromises();
    await vi.waitFor(() => expect(reopened.find(".market-workspace").exists()).toBe(true));
    await reopened.get("#market-item-query").setValue("Sharpshooter's Cloak"); await reopened.get(".market-options button").trigger("click");
    await reopened.get("form.market-editor").trigger("submit"); await flushPromises();
    expect(reopened.get(".market-results").text()).toContain("No matching price listings");
    api.searchMarket.mockResolvedValue({ ok: true, cached: true, observedAt: 1_000, result: {
      listings: [{ price: -1 }, ...Array.from({ length: 25 }, (_, index) => ({ price: (25 - index) * 200_000, unitPrice: 100_000 }))], totalMatches: 42, returnedCount: 101,
    } });
    await reopened.get("form.market-editor").trigger("submit"); await flushPromises();
    expect(reopened.get(".market-results").text()).toContain("Cached at");
    expect(reopened.get(".market-result-details").text()).toContain("server count 42");
    expect(reopened.get(".market-result-details").attributes("open")).toBeUndefined();
    expect(reopened.findAll(".market-price-table tbody tr")).toHaveLength(20);
    expect(reopened.findAll(".market-price-table tbody tr")[0].text()).toContain("200,000 gold");
    expect(reopened.get(".market-result-details").text()).toContain("20 shown · 101 returned rows");
    expect(reopened.get(".market-results").text()).toContain("100,000 gold per unit");
    emit(companionState({ marketReadiness: { ...companionState().marketReadiness, contextVersion: 2 } })); await flushPromises();
    expect(reopened.find(".market-price-table").exists()).toBe(false);
  } finally { reopened.unmount(); }
});

test("real Market results retain fractional unit prices without rounding small prices to zero", async () => {
  const { api } = setup();
  api.searchMarket.mockResolvedValue({ ok: true, result: { listings: [
    { price: 300, unitPrice: 0.5 },
    { price: 600, unitPrice: 1_234.56789 },
    { price: 900, unitPrice: 0.0000001 },
    { price: 1_200, unitPrice: 100_000 },
    { price: 1_500 },
  ] } });
  const wrapper = mount(App, { global: { stubs } });
  try {
    await flushPromises();
    await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue("Sharpshooter's Cloak");
    await wrapper.get(".market-options button").trigger("click");
    await wrapper.get("form.market-editor").trigger("submit");
    await flushPromises();
    // Literal values are independent of the presentation formatter. These use
    // the test environment's existing en-US grouping/decimal convention.
    expect(wrapper.findAll(".market-price-table .market-unit-price").map(cell => cell.text())).toEqual([
      "0.5 gold per unit", "1,234.56789 gold per unit", "0.0000001 gold per unit", "100,000 gold per unit", "Unavailable",
    ]);
    expect(wrapper.findAll(".market-price-table tbody tr td:first-of-type").map(cell => cell.text())).toEqual([
      "300 gold", "600 gold", "900 gold", "1,200 gold", "1,500 gold",
    ]);
  } finally { wrapper.unmount(); }
});

test("tab keyboard navigation wraps and focuses the selected tab", async () => {
  setup();
  const wrapper = mount(App, { attachTo: document.body, global: { stubs } });
  try {
    await flushPromises();
    await wrapper.get("#view-tab-live").trigger("keydown", { key: "ArrowLeft" }); await flushPromises();
    expect(document.activeElement?.id).toBe("view-tab-past");
    await wrapper.get("#view-tab-past").trigger("keydown", { key: "Home" }); await flushPromises();
    expect(document.activeElement?.id).toBe("view-tab-live");
    await wrapper.get("#view-tab-live").trigger("keydown", { key: "ArrowRight" });
    await wrapper.get("#view-tab-filter").trigger("keydown", { key: "ArrowRight" }); await flushPromises();
    expect(document.activeElement?.id).toBe("view-tab-market");
    expect(wrapper.get("#view-tab-market").attributes("tabindex")).toBe("0");
  } finally { wrapper.unmount(); }
});

test("compressed listing data crosses main allowlist and real Market UI with ranges distinct from rolls", async () => {
  const { api, emit } = setup();
  const rows = [listingFixture.specimens[0].row, ...listingFixture.capturedRows];
  const body = Buffer.from(JSON.stringify({ status: 1, itemCount: rows.length,
    items: deflateSync(Buffer.from(JSON.stringify(rows))).toString("base64") }));
  api.searchMarket.mockImplementation(request => handleMarketSearchRequest(request, {
    search: async () => inspectDirectMarketResponse(body, 200).response,
  } as never));
  const wrapper = mount(App, { global: { stubs } });
  try {
    await flushPromises();
    await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue("Battle Mage's Shield");
    await wrapper.get(".market-options button").trigger("click");
    expect(wrapper.get(".market-chosen-item").text()).toContain("Shield");
    expect(wrapper.get(".market-heading").text()).toBe("MarketNew search");
    expect(wrapper.get(".market-editor").text()).not.toMatch(/Edit saved filters|Choose an item, set your minimums|Price ascending/);
    expect(wrapper.get(".market-filter-layout fieldset").find("legend").exists()).toBe(false);
    expect(wrapper.get(".market-catalog-ranges").text()).toContain("Base values, not listing rolls");
    const manaRange = wrapper.findAll(".market-range-list > div").find(row => row.text().startsWith("Mana[300"));
    expect(manaRange?.text()).toBe("Mana[300–450]");
    expect(api.searchMarket).not.toHaveBeenCalled();
    await wrapper.get("form.market-editor").trigger("submit");
    await flushPromises();
    expect(api.searchMarket).toHaveBeenCalledOnce();
    expect(api.searchMarket).toHaveBeenCalledWith({ itemMask: 1073766438, statFilters: [] });
    const shield = wrapper.findAll(".market-listing-item")[3];
    expect(shield.text()).toContain("Actual listing rolls");
    expect(shield.findAll("li").find(row => row.text().startsWith("Mana439"))?.text()).toBe("Mana439");
    expect(shield.text()).toContain("Enhanced Defense124%");
    expect(wrapper.findAll(".market-listing-item")[0].text()).toContain("Reconstructed listing stats (experimental)");
    expect(wrapper.findAll(".market-listing-item")[0].text()).toContain("Enhanced Damage per level0.5%");
    const results = wrapper.get(".market-results");
    expect(results.find("caption").exists()).toBe(false);
    expect(results.get(".market-results-footer").text()).toContain("Fetched at");
    expect(results.get(".market-result-details").attributes("open")).toBeUndefined();
    expect(wrapper.get(".market-editor").text()).not.toContain("Actual listing rolls");
    emit(companionState({ marketReadiness: { ...companionState().marketReadiness, contextVersion: 2 } }));
    await flushPromises();
    expect(results.find(".market-price-table").exists()).toBe(false);
    expect(wrapper.get(".market-catalog-ranges").text()).toContain("Mana[300–450]");
    await wrapper.get(".market-chosen-item button").trigger("click");
    await wrapper.get("#market-item-query").setValue("Sharpshooter's Cloak");
    await wrapper.get(".market-options button").trigger("click");
    expect(wrapper.get(".market-catalog-ranges").text()).toContain("Ranged Skills[6–12]");
    expect(wrapper.text()).not.toContain("Mana300–450");
  } finally { wrapper.unmount(); }
});

test.each([
  { name: "Tiny Planet", row: { price: 1, unit_price: 1, fingerprint: "SYNTHETIC-0-0-10",
    item_data: { c: 1, b: 92, j: 0, d: 1, e: 11, w: 1, a: 618478963 } },
    catalog: "Increased Orbital Projectile Duration[15%–25%]", listing: "Increased Orbital Projectile Duration22%" },
  { name: "Bob's Piece of Plywood", row: listingFixture.specimens[1].row,
    catalog: "10% Chance when Struck: Chainsaw Massacre (Level 40)", listing: "10% Chance when Struck: Chainsaw Massacre (Level 40)" },
])("$name presents grounded catalog data and independently verified listing information", async specimen => {
  const { api } = setup();
  const body = Buffer.from(JSON.stringify({ status: 1, itemCount: 1,
    items: deflateSync(Buffer.from(JSON.stringify([specimen.row]))).toString("base64") }));
  api.searchMarket.mockImplementation(request => handleMarketSearchRequest(request, {
    search: async () => inspectDirectMarketResponse(body, 200).response,
  } as never));
  const wrapper = mount(App, { global: { stubs } });
  try {
    await flushPromises();
    await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue(specimen.name);
    await wrapper.get(".market-options button").trigger("click");
    expect(wrapper.get(".market-catalog-ranges").text()).toContain(specimen.catalog);
    expect(wrapper.get(".market-catalog-ranges").text()).not.toContain("Catalog ranges are not available");
    await wrapper.get("form.market-editor").trigger("submit");
    await flushPromises();
    const listing = wrapper.get(".market-listing-details");
    expect(listing.text()).toContain(specimen.listing);
    expect(wrapper.text()).not.toMatch(/Triggered skill ID|Unknown stat 18[67]|Triggered skill103/);
    if (specimen.name === "Tiny Planet") {
      expect(listing.text()).toContain("Reconstructed listing stats (experimental)");
      expect(listing.findAll(".market-listing-stats li")).toHaveLength(1);
    } else {
      expect(listing.text()).toContain("Actual listing rolls");
      expect(listing.text()).toContain("Strength27");
      expect(listing.findAll(".market-listing-stats li")).toHaveLength(7);
      // The observed tooltip's attack-damage/rating details are not reconstructed.
      expect(wrapper.text()).not.toMatch(/176%|200%/);
    }
  } finally { wrapper.unmount(); }
});

test("local save failures retain the editable entry and expose retry without searching", async () => {
  const { api } = setup();
  const wrapper = mount(App, { global: { stubs } });
  try {
    await flushPromises(); await wrapper.get("#view-tab-market").trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".market-workspace").exists()).toBe(true));
    await wrapper.get("#market-item-query").setValue("Sharpshooter's Cloak");
    await wrapper.get(".market-options button").trigger("click");
    await wrapper.get("#market-saved-name").setValue("Retry cloak");
    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
    await button(wrapper, "Save item and filters").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("Local saving failed");
    expect(wrapper.text()).toContain("Retry cloak");
    await button(wrapper, "Retry save").trigger("click"); await flushPromises();
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).savedMarketItems.some((entry: { name: string }) => entry.name === "Retry cloak")).toBe(true);
    expect(api.searchMarket).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});
