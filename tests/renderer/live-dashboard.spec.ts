import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LiveView from "../../src/renderer/src/components/LiveView.vue";
import { projectLiveRunChartLanes, type LiveRunHistorySample } from "../../src/renderer/src/lib/live-run-history";
import { baseTime, companionState, itemFilterGroup } from "./fixtures";

describe("Run Command live dashboard", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      },
    });
  });

  test("keeps timeline controls contextual and presents readable vertical zone effects", () => {
    const wrapper = mountLiveView();

    expect(wrapper.find(".live-dashboard-toolbar").exists()).toBe(false);
    expect(wrapper.get(".status-actions .dashboard-customizer-trigger").attributes("aria-label")).toBe("Customize dashboard");
    expect(wrapper.get(".run-score-strip").attributes("aria-label")).toBe("Run score");
    expect(wrapper.findAll(".run-score-cell")).toHaveLength(2);
    expect(wrapper.get(".run-score-identity").text()).toContain("TestHero");
    expect(wrapper.find('select[title="Visible item timeline history"]').exists()).toBe(false);
    expect(wrapper.get(".timeline-filter-menu").text()).toContain("Filters");
    expect(wrapper.get('select[title="Filter item timeline by type or item filter"]').text()).toContain("All items");
    expect(wrapper.findAll(".effect-column")).toHaveLength(2);
    expect(wrapper.findAll(".effect-column")[0].text()).toContain("Treasure Goblin");
    expect(wrapper.findAll(".effect-column")[0].text()).toContain("More loot.");
    expect(wrapper.findAll(".effect-column")[1].text()).toContain("Lingering Evil");
    expect(wrapper.findAll(".effect-column")[1].text()).toContain("More danger.");
    expect(wrapper.get(".timeline").classes()).toContain("timeline");
  });

  test("keeps empty activity fixtures compact and informative", async () => {
    const wrapper = mountLiveView();

    expect(wrapper.find("#item-timeline-card").exists()).toBe(true);
    expect(wrapper.find("#live-log-card").exists()).toBe(true);

    await wrapper.setProps({
      visibleItemTimeline: [],
      itemTimelineCount: 0,
      recentLogs: [],
    });

    expect(wrapper.get("#item-timeline-card-body .dashboard-empty-state").text()).toBe(
      "No tracked item drops in this session yet.",
    );
    expect(wrapper.get("#live-log-card-body .dashboard-empty-state").text()).toContain(
      "Capture events and diagnostics",
    );
    expect(wrapper.find("#item-timeline-card-body .timeline").exists()).toBe(false);
    expect(wrapper.find("#live-log-card-body .logs").exists()).toBe(false);
  });

  test("emits the contextual hide-unfiltered filter for its preference-owning parent", async () => {
    const wrapper = mountLiveView();
    const hideUnfiltered = wrapper.findAll(".timeline-filter-popover label")
      .find((label) => label.text().includes("Hide unfiltered items"));
    if (!hideUnfiltered) throw new Error("Hide unfiltered timeline control was not rendered");

    await hideUnfiltered.get("input").setValue(true);

    expect(wrapper.emitted("update:hideUnfilteredItems")).toEqual([[true]]);
    await wrapper.setProps({ hideUnfilteredItems: true });
    expect((hideUnfiltered.get("input").element as HTMLInputElement).checked).toBe(true);
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });

  test("honors parent-owned hidden fixtures, restores them through Customize Dashboard, and keeps collapse session-only", async () => {
    const wrapper = mountLiveView({ hiddenFixtures: ["live-log"] });

    expect(wrapper.find("#live-log-card-title").exists()).toBe(false);
    await wrapper.get(".dashboard-customizer-trigger").trigger("click");

    const liveLogFixture = wrapper.findAll(".dashboard-customizer-popover label")
      .find((label) => label.text().includes("Live Log"));
    if (!liveLogFixture) throw new Error("Live Log fixture control was not rendered");
    expect((liveLogFixture.get("input").element as HTMLInputElement).checked).toBe(false);
    await liveLogFixture.get("input").setValue(true);
    expect(wrapper.emitted("update:hiddenFixtures")).toEqual([[[]]]);
    await wrapper.setProps({ hiddenFixtures: [] });
    expect((liveLogFixture.get("input").element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find("#live-log-card-title").exists()).toBe(true);

    await wrapper.get('button[aria-label="Hide Live Log"]').trigger("click");
    expect(wrapper.emitted("update:hiddenFixtures")?.at(-1)).toEqual([["live-log"]]);
    await wrapper.setProps({ hiddenFixtures: ["live-log"] });
    expect(wrapper.find("#live-log-card-title").exists()).toBe(false);

    await wrapper.setProps({ hiddenFixtures: [] });
    await wrapper.get('button[aria-label="Collapse Live Log"]').trigger("click");
    expect(wrapper.get("#live-log-card-body").attributes("style")).toContain("display: none");
    expect(window.localStorage.setItem).not.toHaveBeenCalled();

    wrapper.unmount();
    const remounted = mountLiveView();
    expect(remounted.get("#live-log-card-body").attributes("style") ?? "").not.toContain("display: none");
  });

  test("keeps capture details collapsed until the contextual disclosure is used", async () => {
    const wrapper = mountLiveView();
    const details = wrapper.get('button[aria-controls="capture-details"]');

    expect(details.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("#capture-details").exists()).toBe(false);

    await details.trigger("click");

    expect(wrapper.emitted("update:showCaptureDetails")).toEqual([[true]]);
  });
});

function mountLiveView(overrides: { hiddenFixtures?: Array<"item-timeline" | "live-log">; hideUnfilteredItems?: boolean } = {}) {
  const state = companionState();
  const filterGroup = itemFilterGroup();
  const graphSample: LiveRunHistorySample = {
    recordedAt: baseTime,
    elapsedMs: 600_000,
    xp: 50_000,
    gold: 10_000,
    kills: 25,
    items: 2,
    itemCounts: {},
  };

  return mount(LiveView, {
    props: {
      state,
      now: baseTime,
      captureStatusLabel: "Capturing",
      runTileDisplays: [
        { id: "duration", kind: "duration" as const, label: "This Run", value: "10m", detail: "TestHero" },
        { id: "gold", kind: "gold" as const, label: "Gold", value: "10k", detail: "60,000/h" },
      ],
      liveRunGraphElapsedMs: graphSample.elapsedMs,
      runPausedLabel: "Paused",
      liveRunGraphLanes: projectLiveRunChartLanes([graphSample], []),
      liveRunGraphCustomItems: [],
      liveRunGraphEnabledStandardMetrics: ["xp", "gold", "kills", "items"],
      liveRunItemNameOptions: ["The Bucket", "Copper Ore"],
      zoneCountdown: "20m",
      zoneResetLabel: "12:30 PM",
      satanicZoneRefreshSubmitting: false,
      trackedItems: [
        { rarity: "Satanic", total: 2, mf: 1, perHour: 12, drops: [{ name: "Sash of the Magi", total: 2, mf: 1 }] },
      ],
      keyDropTotal: 2,
      oreDropTotal: 5,
      visibleItemTimeline: state.stats.itemTimeline,
      itemTimelineCount: state.stats.itemTimeline.length,
      itemFilterMatchHistory: [],
      logLimitOptions: [10, 20, 50],
      itemTypeOptions: [{ value: "6", label: "Belt" }],
      itemFilterGroups: [filterGroup],
      shoppingListItems: ["Copper Ore"],
      shoppingSuggestions: ["Ruby"],
      activeShoppingItem: "Copper Ore",
      recentLogs: state.logs,
      expandedLogIds: new Set<string>(),
      showCaptureDetails: false,
      expandedDropRarity: null,
      timelineType: "all",
      hideSocketables: true,
      hideKeys: true,
      hideMaterials: true,
      hideUnfilteredItems: overrides.hideUnfilteredItems ?? false,
      hiddenFixtures: overrides.hiddenFixtures ?? [],
      shoppingDraftItem: "",
      logLimit: 20,
    },
  });
}
