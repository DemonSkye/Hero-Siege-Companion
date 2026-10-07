import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, expect, test, vi } from "vitest";
import App from "../../src/renderer/src/App.vue";
import type { HeroSiegeCompanionApi } from "../../src/shared/ipc";
import type { CompanionState, CompanionStateUpdate } from "../../src/shared/app-state";
import type { MarketSearchResponse } from "../../src/shared/market-search";
import { companionState } from "./fixtures";
import { installMemoryPreferencesStorage } from "../fixtures/market";

const storageKey = "hero-siege-companion:preferences:v1";
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
    getState: vi.fn(async () => state), setCompactMode: vi.fn(), setAlwaysOnTop: vi.fn(),
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
    expect(button(wrapper, "Save item and filters").attributes("disabled")).toBeUndefined();
    emit(companionState({ marketReadiness: { ...companionState().marketReadiness, contextVersion: 1 } })); await flushPromises();
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
    expect(reopened.get(".market-results").text()).toContain("Server returned count: 42");
    expect(reopened.findAll(".market-price-table tbody tr")).toHaveLength(20);
    expect(reopened.findAll(".market-price-table tbody tr")[0].text()).toContain("200,000 gold");
    expect(reopened.get(".market-results").text()).toContain("Showing 20 price listings from 101 returned page rows");
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
    expect(wrapper.findAll(".market-price-table tbody tr td:last-child").map(cell => cell.text())).toEqual([
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
