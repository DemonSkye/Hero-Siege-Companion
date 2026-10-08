import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { ref } from "vue";
import MarketReadinessStatus from "../../src/renderer/src/components/MarketReadinessStatus.vue";
import MarketSearchDialog from "../../src/renderer/src/components/MarketSearchDialog.vue";
import { createInitialMarketReadiness, type MarketReadiness } from "../../src/shared/market-readiness";
import { useMarketSearchRuntime } from "../../src/renderer/src/lib/market-search-runtime";
import { companionState, itemTimelineEntry } from "./fixtures";

const recoveryCopy = "With capture running, search for an item in the game’s Market or perform an in-game vote reset to collect the information needed.";

describe("Market readiness UI", () => {
  test("explains established transient endpoint mismatch even with all six fields", () => {
    const wrapper = mount(MarketReadinessStatus, { props: { readiness: {
      ...companionState().marketReadiness, phase: "collecting", reason: "endpoint_mismatch", canSearch: false, missingFields: [],
    } } });
    expect(wrapper.get('[role="status"]').text()).toBe("Market not ready");
    expect(wrapper.text()).toContain("matching session information");
    expect(wrapper.text()).toContain("search for an item");
    expect(wrapper.text()).toContain(recoveryCopy);
  });
  test("shows accessible readiness and recovery without field counts; first-search preparation stays truthful", async () => {
    const wrapper = mount(MarketReadinessStatus, { props: { readiness: createInitialMarketReadiness() } });
    expect(wrapper.get('[role="status"]').text()).toBe("Market not ready");
    expect(wrapper.text()).toContain("Start capture");
    expect(wrapper.text()).toContain("search for an item");
    expect(wrapper.text()).toContain(recoveryCopy);
    expect(wrapper.text()).not.toMatch(/\d\/6|fields received|Account identity/);
    expect(wrapper.get('[role="status"]').attributes("aria-live")).toBe("polite");
    expect(wrapper.get(".market-readiness-light").attributes("aria-hidden")).toBe("true");
    await wrapper.setProps({ readiness: { ...companionState().marketReadiness, phase: "region-required", reason: "region_unprepared", regionQualified: false } });
    expect(wrapper.text()).not.toMatch(/\d\/6|fields received/);
    expect(wrapper.get('[role="status"]').text()).toBe("Market ready");
    expect(wrapper.text()).toContain("Your first search will prepare region information");
    expect(wrapper.classes()).toContain("is-ready");
    await wrapper.setProps({ readiness: { ...companionState().marketReadiness, phase: "collecting", reason: "missing_fields", canSearch: false, missingFields: ["season", "hardcore"] } });
    expect(wrapper.get('[role="status"]').text()).toBe("Market not ready");
    expect(wrapper.text()).toContain("current game information");
    expect(wrapper.text()).toContain("search for an item");
    expect(wrapper.text()).toContain(recoveryCopy);
    expect(wrapper.text()).not.toMatch(/\d\/6|fields received|Character mode/);
    await wrapper.setProps({ readiness: companionState().marketReadiness });
    expect(wrapper.get('[role="status"]').text()).toBe("Market ready");
    expect(wrapper.text()).not.toContain("vote reset");
  });

  test("preparing and region failure remain distinct from ready and missing context", async () => {
    const wrapper = mount(MarketReadinessStatus, { props: { readiness: {
      ...companionState().marketReadiness, phase: "preparing", canSearch: false,
    } } });
    expect(wrapper.get('[role="status"]').text()).toBe("Preparing Market");
    expect(wrapper.text()).toContain("preparing region information");
    expect(wrapper.text()).not.toContain("vote reset");
    await wrapper.setProps({ readiness: { ...companionState().marketReadiness, phase: "region-error", reason: "region_unavailable", regionQualified: false } });
    expect(wrapper.get('[role="status"]').text()).toBe("Market not ready");
    expect(wrapper.text()).toContain("region information could not be confirmed");
    expect(wrapper.text()).toContain(recoveryCopy);
    expect(wrapper.get('.market-readiness-detail[role="alert"]').text()).toContain(recoveryCopy);
    expect(wrapper.classes()).toContain("is-error");
  });

  test.each(["before", "after"] as const)("explains region preparation failure when readiness arrives %s the lookup reply", async (order) => {
    const state = ref<MarketReadiness>({ ...companionState().marketReadiness, phase: "region-required", reason: "region_unprepared", regionQualified: false });
    const runtime = useMarketSearchRuntime({ readiness: state, now: ref(1_000), searchMarket: vi.fn(async () => {
      if (order === "before") state.value = { ...state.value, phase: "region-error", reason: "region_unavailable" };
      return { ok: false as const, errorCode: "template_unavailable" as const };
    }) });
    runtime.openMarketSearch(itemTimelineEntry());
    await runtime.searchMarket();
    expect(runtime.errorMessage.value).toContain("Session captured, but region information could not be confirmed");
    expect(runtime.errorMessage.value).toContain(recoveryCopy);
    expect(state.value.phase).toBe(order === "before" ? "region-error" : "region-required");
    if (order === "after") state.value = { ...state.value, phase: "region-error", reason: "region_unavailable" };
    expect(runtime.errorMessage.value).toContain("Session captured, but region information could not be confirmed");
    expect(state.value.missingFields).toEqual([]);
    expect(runtime.canSearch.value).toBe(true);
  });

  test("keeps readiness independent from cooldown, blocks missing/expired context, and permits explicit region preparation", async () => {
    const readiness = ref(createInitialMarketReadiness());
    const now = ref(1_000);
    const search = vi.fn(async () => ({ ok: true as const, result: { listings: [{ price: 100 }] }, nextAllowedSearchAt: 16_000 }));
    const runtime = useMarketSearchRuntime({ readiness, now, searchMarket: search });
    runtime.openMarketSearch(itemTimelineEntry());
    await runtime.searchMarket();
    expect(search).not.toHaveBeenCalled();
    readiness.value = { ...companionState().marketReadiness, phase: "region-required", reason: "region_unprepared", regionQualified: false };
    expect(runtime.canSearch.value).toBe(true);
    await runtime.searchMarket();
    expect(search).toHaveBeenCalledTimes(1);
    readiness.value = companionState().marketReadiness;
    const wrapper = mount(MarketSearchDialog, { props: {
      item: itemTimelineEntry(), readiness: readiness.value, minSockets: null, statFilters: [],
      phase: "success", listings: [{ price: 100 }], totalMatches: 1, errorMessage: "",
      resultObservedAt: 1_000, resultCached: false, canSearch: runtime.canSearch.value,
      cooldownRemainingSeconds: runtime.cooldownRemainingSeconds.value,
    } });
    expect(wrapper.get('[role="status"]').text()).toBe("Market ready");
    expect(wrapper.get('button[type="submit"]').text()).toBe("Search in 15s");
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    now.value = 16_000;
    expect(runtime.canSearch.value).toBe(true);
    readiness.value = { ...readiness.value, phase: "expired", reason: "identity_expired", sessionCurrent: false, canSearch: false };
    await runtime.searchMarket();
    expect(search).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ readiness: readiness.value, canSearch: runtime.canSearch.value, cooldownRemainingSeconds: 0 });
    expect(wrapper.get('[role="status"]').text()).toBe("Market not ready");
    expect(wrapper.text()).toContain("session information expired");
    expect(wrapper.text()).toContain(recoveryCopy);
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  test.each([
    ["waiting", "capture_inactive"], ["waiting", "game_unavailable"],
    ["collecting", "missing_fields"], ["collecting", "endpoint_mismatch"],
    ["expired", "identity_expired"], ["region-error", "region_unavailable"],
  ] as const)("%s/%s offers both in-game context actions in one paragraph", (phase, reason) => {
    const wrapper = mount(MarketReadinessStatus, { props: { readiness: {
      ...companionState().marketReadiness, phase, reason, canSearch: false,
    } } });
    expect(wrapper.get('[role="status"]').text()).toBe("Market not ready");
    expect(wrapper.findAll(".market-readiness-detail")).toHaveLength(1);
    expect(wrapper.text().split(recoveryCopy)).toHaveLength(2);
    wrapper.unmount();
  });

  test("legacy dialog shows shared region guidance once and retains distinct request errors", async () => {
    const readiness: MarketReadiness = { ...companionState().marketReadiness, phase: "region-error", reason: "region_unavailable", regionQualified: false };
    const wrapper = mount(MarketSearchDialog, { props: {
      item: itemTimelineEntry(), readiness, minSockets: null, statFilters: [], phase: "error",
      listings: [], totalMatches: null, errorMessage: "Session captured, but region information could not be confirmed. " + recoveryCopy,
      resultObservedAt: null, resultCached: false, canSearch: true, cooldownRemainingSeconds: 0,
    } });
    expect(wrapper.text().split(recoveryCopy)).toHaveLength(2);
    expect(wrapper.find(".market-search-error").exists()).toBe(false);
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    await wrapper.setProps({ errorMessage: "The market rejected this request's checksum." });
    expect(wrapper.get('.market-search-error[role="alert"]').text()).toBe("The market rejected this request's checksum.");
    expect(wrapper.text().split(recoveryCopy)).toHaveLength(2);
    wrapper.unmount();
  });
});
