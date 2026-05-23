import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import CompactView from "../../src/renderer/src/components/CompactView.vue";
import ItemFilterView from "../../src/renderer/src/components/ItemFilterView.vue";
import LiveView from "../../src/renderer/src/components/LiveView.vue";
import PastRunsView from "../../src/renderer/src/components/PastRunsView.vue";
import SettingsModal from "../../src/renderer/src/components/SettingsModal.vue";
import UpdateBanner from "../../src/renderer/src/components/UpdateBanner.vue";
import { defaultPostRunReportConfig } from "../../src/renderer/src/lib/report-config";
import { companionState, itemFilterGroup, itemTimelineEntry, pastRun } from "./fixtures";

describe("Vue component contracts", () => {
  test("UpdateBanner documents the release action contract", async () => {
    const wrapper = mount(UpdateBanner, {
      props: {
        update: {
          version: "v0.1.4",
          currentVersion: "v0.1.3",
          name: "Better loot handling",
          url: "https://example.test/release",
          publishedAt: "2026-05-23T12:00:00.000Z",
        },
      },
    });

    expect(wrapper.text()).toContain("Release v0.1.4 is now available");
    expect(wrapper.text()).toContain("Better loot handling");

    await buttonByText(wrapper, "Update").trigger("click");
    await buttonByText(wrapper, "Ignore").trigger("click");

    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("ignore")).toHaveLength(1);
  });

  test("CompactView keeps overlay numbers visible and emits shopping tray actions", async () => {
    const state = companionState();
    const wrapper = mount(CompactView, {
      props: {
        state,
        captureStatusLabel: "Capturing",
        compactClock: "12:00 PM",
        sessionDuration: "10m",
        zoneCountdown: "20m",
        compactTrackedItems: [
          { rarity: "Set", total: 1 },
          { rarity: "Satanic", total: 2 },
        ],
        oreDropTotal: 5,
        showShopping: true,
        activeShoppingItem: "Copper Ore",
        shoppingListItems: ["Copper Ore", "Ruby"],
      },
    });

    expect(wrapper.text()).toContain("Connected");
    expect(wrapper.text()).toContain("42 parsed");
    expect(wrapper.text()).toContain("10,000");
    expect(wrapper.text()).toContain("Copper Ore");

    await buttonByText(wrapper, "Ruby").trigger("click");
    await wrapper.get(".compact-shopping-toggle").trigger("click");
    await wrapper.get(".compact-shopping-close").trigger("click");

    expect(wrapper.emitted("copyShoppingItem")).toEqual([["Ruby"]]);
    expect(wrapper.emitted("update:showShopping")).toEqual([[false], [false]]);
  });

  test("ItemFilterView exercises group editing, mute state, suggestions, and rule toggles", async () => {
    const group = itemFilterGroup();
    const wrapper = mount(ItemFilterView, {
      props: {
        itemFilterGroups: [group],
        selectedItemFilterGroup: group,
        selectedItemFilterGroupedItems: [{ typeLabel: "Belt", items: group.items }],
        itemFilterDraftGroupName: "",
        itemFilterDraftItem: "sash",
        itemFilterSuggestions: ["Sash of the Magi"],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterMuted: false,
        developerItemResearchEnabled: true,
        itemResearchEntries: [
          {
            signature: "4:55:0:gloves #55",
            label: "Gloves #55",
            rarity: "Satanic",
            type: 4,
            id: 55,
            dropQuality: 0,
            count: 1,
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
            resolvedName: "",
            notes: "",
            ignored: false,
          },
        ],
        unresolvedItemResearchCount: 1,
      },
    });

    expect(wrapper.text()).toContain("Loot Alerts");
    expect(wrapper.text()).toContain("Sash of the Magi");
    expect(wrapper.text()).toContain("Item Research");
    expect(wrapper.text()).toContain("Gloves #55");

    await buttonByText(wrapper, "Mute All").trigger("click");
    await wrapper.get(".item-filter-add-group").trigger("submit");
    await buttonByText(wrapper, "Sash of the Magi").trigger("click");
    await checkboxByLabel(wrapper, "Satanic").setValue(false);
    await checkboxByLabel(wrapper, "Belt").setValue(false);
    await buttonByText(wrapper, "Save").trigger("click");

    expect(wrapper.emitted("update:itemFilterMuted")).toEqual([[true]]);
    expect(wrapper.emitted("addGroup")).toHaveLength(1);
    expect(wrapper.emitted("addItemToGroup")?.[0]).toEqual([group, "Sash of the Magi"]);
    expect(wrapper.emitted("saveItemResearchEntry")?.[0]?.[0]).toBe("4:55:0:gloves #55");
    expect(group.rarities).toEqual([]);
    expect(group.types).toEqual([]);
  });

  test("SettingsModal keeps persisted settings explicit and emits application actions", async () => {
    const wrapper = mount(SettingsModal, {
      props: {
        logLimitOptions: [10, 20, 50],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        logLimit: 20,
        timelineLimit: 10,
        timelineType: "all",
        launchThroughSteam: false,
        gameExecutablePath: "C:\\Games\\Hero Siege\\Hero_Siege.exe",
        showCaptureDetails: false,
        createDebugMode: false,
        alwaysOnTop: true,
        lockCompactLocation: false,
        hideSocketables: false,
        hideKeys: false,
        hideMaterials: false,
        developerItemResearchEnabled: true,
        unknownItemAudioPrompt: false,
        skipEmptyRuns: true,
        minRunDurationMinutes: 5,
        configIncludeAppSettings: true,
        configIncludeRunSaving: true,
        configIncludeReportTracking: true,
        configIncludeLootFilters: true,
        configIncludeItemResearch: false,
      },
    });

    expect(wrapper.text()).toContain("Settings");
    expect(wrapper.text()).toContain("Verbose live logging");
    expect((wrapper.get(".path-setting input").element as HTMLInputElement).value).toBe("C:\\Games\\Hero Siege\\Hero_Siege.exe");

    await wrapper.get('select[title="Visible log history"]').setValue("50");
    await checkboxByLabel(wrapper, "Research data").setValue(true);
    await buttonByText(wrapper, "Browse").trigger("click");
    await buttonByText(wrapper, "Import JSON").trigger("click");
    await buttonByText(wrapper, "Export JSON").trigger("click");
    await buttonByText(wrapper, "Reset Preferences").trigger("click");
    await buttonByText(wrapper, "Done").trigger("click");

    expect(wrapper.emitted("update:logLimit")).toEqual([[50]]);
    expect(wrapper.emitted("update:configIncludeItemResearch")).toEqual([[true]]);
    expect(wrapper.emitted("chooseGameExecutable")).toHaveLength(1);
    expect(wrapper.emitted("importConfiguration")).toHaveLength(1);
    expect(wrapper.emitted("exportConfiguration")).toHaveLength(1);
    expect(wrapper.emitted("reset")).toHaveLength(1);
    expect(wrapper.emitted("apply")).toHaveLength(1);
  });

  test("PastRunsView aggregates saved runs and toggles per-rarity breakdowns", async () => {
    const run = pastRun();
    const wrapper = mount(PastRunsView, {
      props: {
        pastRuns: [run, pastRun({ id: "run-2", totalGoldGained: 50_000, durationMs: 300_000 })],
        expandedDropKey: null,
        reportConfig: defaultPostRunReportConfig,
      },
    });

    expect(wrapper.text()).toContain("2/100 saved");
    expect(wrapper.text()).toContain("All Runs");
    expect(wrapper.text()).toContain("Last 10 Runs");
    expect(wrapper.text()).toContain("150,000");
    expect(wrapper.text()).toContain("Crystal Key");
    expect(wrapper.text()).toContain("Battle Fragment");

    await buttonByText(wrapper, "Configure Tracked").trigger("click");
    expect(wrapper.text()).toContain("Configure Tracked");

    await buttonByText(wrapper, "Satanic").trigger("click");

    expect(wrapper.emitted("update:expandedDropKey")).toEqual([[`${run.id}:Satanic`]]);
  });

  test("LiveView binds the high-churn dashboard controls through explicit update events", async () => {
    const state = companionState();
    const wrapper = mount(LiveView, {
      props: {
        state,
        captureStatusLabel: "Capturing",
        sessionDuration: "10m",
        currentGoldLabel: "1,010,000",
        zoneCountdown: "20m",
        zoneResetLabel: "12:30 PM",
        trackedItems: [
          { rarity: "Set", total: 1, mf: 0, perHour: 6, drops: [{ name: "Earth Shaper's Boots", total: 1, mf: 0 }] },
          { rarity: "Satanic", total: 2, mf: 1, perHour: 12, drops: [{ name: "Sash of the Magi", total: 2, mf: 1 }] },
        ],
        keyDropTotal: 2,
        oreDropTotal: 5,
        visibleItemTimeline: [itemTimelineEntry({ label: "Sash of the Magi", rarity: "Satanic" })],
        itemTimelineCount: 1,
        logLimitOptions: [10, 20, 50],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        shoppingListItems: ["Copper Ore"],
        shoppingSuggestions: ["Ruby"],
        activeShoppingItem: "Copper Ore",
        activeItemFilterGroups: [itemFilterGroup()],
        itemFilterGroupCount: 1,
        watchedItemCount: 1,
        lastItemFilterMatch: { itemLabel: "Sash of the Magi", groupName: "Loot Alerts", soundName: "Deep Gong", createdAt: state.stats.lastEventAt ?? 0 },
        recentLogs: state.logs,
        expandedLogIds: new Set<string>(),
        showCaptureDetails: false,
        expandedDropRarity: null,
        timelineLimit: 10,
        timelineType: "all",
        hideSocketables: false,
        hideKeys: false,
        hideMaterials: false,
        shoppingDraftItem: "",
        itemFilterMuted: false,
        logLimit: 20,
      },
    });

    expect(wrapper.text()).toContain("Gold Earned");
    expect(wrapper.text()).toContain("Sash of the Magi");
    expect(wrapper.text()).toContain("Loot Alerts");

    await buttonByText(wrapper, "Details").trigger("click");
    await buttonByText(wrapper, "Satanic").trigger("click");
    await wrapper.get(".shopping-form").trigger("submit");
    await buttonByText(wrapper, "Configure Filter").trigger("click");
    await wrapper.get(".logs button").trigger("click");

    expect(wrapper.emitted("update:showCaptureDetails")).toEqual([[true]]);
    expect(wrapper.emitted("update:expandedDropRarity")).toEqual([["Satanic"]]);
    expect(wrapper.emitted("addShoppingItem")).toHaveLength(1);
    expect(wrapper.emitted("configureFilter")).toHaveLength(1);
    expect(wrapper.emitted("toggleLog")?.[0]).toEqual([state.logs[0]]);
  });
});

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`Unable to find button containing text: ${text}`);
  return button;
}

function checkboxByLabel(wrapper: ReturnType<typeof mount>, text: string) {
  const label = wrapper.findAll("label").find((candidate) => candidate.text().includes(text));
  if (!label) throw new Error(`Unable to find label containing text: ${text}`);
  return label.get("input");
}
