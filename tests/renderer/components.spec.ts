import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import CompactView from "../../src/renderer/src/components/CompactView.vue";
import ItemFilterView from "../../src/renderer/src/components/ItemFilterView.vue";
import LiveView from "../../src/renderer/src/components/LiveView.vue";
import PastRunsView from "../../src/renderer/src/components/PastRunsView.vue";
import SettingsModal from "../../src/renderer/src/components/SettingsModal.vue";
import UpdateBanner from "../../src/renderer/src/components/UpdateBanner.vue";
import { defaultCompactRunTiles } from "../../src/renderer/src/lib/compact-tiles";
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
        compactRunTileDisplays: [
          { id: "duration", kind: "duration", label: "This Run", value: "10m", title: "Recording" },
          { id: "gold", kind: "gold", label: "Gold", value: "10,000", title: "Current 1,010,000 - 60,000/h" },
          { id: "xp", kind: "xp", label: "XP", value: "10.04m/h", title: "10,000 earned - 10,040,000/h" },
          { id: "kills", kind: "kills", label: "Kills", value: "25", title: "25 kills - 150/h" },
          { id: "sz", kind: "sz", label: "SZ", value: "20m", title: "Satanic zone details" },
          { id: "set", kind: "set", label: "Set", value: "1", title: "Set drops" },
          { id: "satanic", kind: "satanic", label: "Satanic", value: "2", title: "Satanic drops" },
          { id: "heroic", kind: "heroic", label: "Heroic", value: "3", title: "Heroic drops" },
        ],
        runPausedLabel: "Paused",
        canToggleRunPaused: true,
        showZone: true,
      },
    });

    expect(wrapper.text()).toContain("This Run");
    expect(wrapper.text()).toContain("Recording");
    expect(wrapper.text()).toContain("10,000");
    expect(wrapper.text()).toContain("Kills");
    expect(wrapper.text()).toContain("Siege Fields");

    await wrapper.get(".compact-zone-tray .compact-shopping-close").trigger("click");
    await buttonByText(wrapper, "Stop").trigger("click");
    await buttonByText(wrapper, "End Run").trigger("click");
    await buttonByText(wrapper, "SZ Details").trigger("click");

    expect(wrapper.emitted("toggleRunPaused")).toHaveLength(1);
    expect(wrapper.emitted("endRun")).toHaveLength(1);
    expect(wrapper.emitted("update:showZone")).toEqual([[false], [true]]);
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
    await buttonByText(wrapper, "Export Research JSON").trigger("click");
    await buttonByText(wrapper, "Save").trigger("click");

    expect(wrapper.emitted("update:itemFilterMuted")).toEqual([[true]]);
    expect(wrapper.emitted("addGroup")).toHaveLength(1);
    expect(wrapper.emitted("addItemToGroup")?.[0]).toEqual([group, "Sash of the Magi"]);
    expect(wrapper.emitted("exportItemResearch")).toHaveLength(1);
    expect(wrapper.emitted("saveItemResearchEntry")?.[0]?.[0]).toBe("4:55:0:gloves #55");
    expect(group.rarities).toEqual([]);
    expect(group.types).toEqual([]);
  });

  test("SettingsModal keeps persisted settings explicit and emits application actions", async () => {
    const wrapper = mount(SettingsModal, {
      props: {
        logLimitOptions: [10, 20, 50],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterGroups: [itemFilterGroup()],
        itemSuggestions: ["Sash of the Magi"],
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
        compactRunTiles: defaultCompactRunTiles,
      },
    });

    expect(wrapper.text()).toContain("Settings");
    expect(wrapper.text()).toContain("Verbose live logging");
    expect((wrapper.get(".path-setting input").element as HTMLInputElement).value).toBe("C:\\Games\\Hero Siege\\Hero_Siege.exe");

    await wrapper.get('select[title="Visible log history"]').setValue("50");
    await checkboxByLabel(wrapper, "Research data").setValue(true);
    await buttonByText(wrapper, "Add Custom").trigger("click");
    await buttonByText(wrapper, "Browse").trigger("click");
    await buttonByText(wrapper, "Import JSON").trigger("click");
    await buttonByText(wrapper, "Export JSON").trigger("click");
    await buttonByText(wrapper, "Reset Preferences").trigger("click");
    await wrapper.get(".modal-backdrop").trigger("click");
    await buttonByText(wrapper, "Done").trigger("click");

    expect(wrapper.emitted("update:logLimit")).toEqual([[50]]);
    expect(wrapper.emitted("update:configIncludeItemResearch")).toEqual([[true]]);
    expect(wrapper.emitted("update:compactRunTiles")?.[0]?.[0]).toHaveLength(defaultCompactRunTiles.length + 1);
    expect(wrapper.emitted("chooseGameExecutable")).toHaveLength(1);
    expect(wrapper.emitted("importConfiguration")).toHaveLength(1);
    expect(wrapper.emitted("exportConfiguration")).toHaveLength(1);
    expect(wrapper.emitted("reset")).toHaveLength(1);
    expect(wrapper.emitted("close")).toBeUndefined();
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

    await buttonByText(wrapper, "Configure Report").trigger("click");
    expect(wrapper.text()).toContain("Configure Report");

    await buttonByText(wrapper, "Satanic").trigger("click");

    expect(wrapper.emitted("update:expandedDropKey")).toEqual([[`${run.id}:Satanic`]]);
  });

  test("LiveView binds the high-churn dashboard controls through explicit update events", async () => {
    const state = companionState();
    const wrapper = mount(LiveView, {
      props: {
        state,
        captureStatusLabel: "Capturing",
        runTileDisplays: [
          { id: "duration", kind: "duration", label: "This Run", value: "10m", detail: "TestHero" },
          { id: "gold", kind: "gold", label: "Gold", value: "10k", detail: "60,000/h - Current 1,010,000" },
          { id: "xp", kind: "xp", label: "XP", value: "30k/h", detail: "5,000 earned" },
          { id: "kills", kind: "kills", label: "Kills", value: "25", detail: "150/h" },
        ],
        zoneCountdown: "20m",
        zoneResetLabel: "12:30 PM",
        trackedItems: [
          { rarity: "Set", total: 1, mf: 0, perHour: 6, drops: [{ name: "Earth Shaper's Boots", total: 1, mf: 0 }] },
          { rarity: "Satanic", total: 2, mf: 1, perHour: 12, drops: [{ name: "Sash of the Magi", total: 2, mf: 1 }] },
        ],
        keyDropTotal: 2,
        oreDropTotal: 5,
        visibleItemTimeline: [
          itemTimelineEntry({ label: "Sash of the Magi", rarity: "Satanic" }),
          itemTimelineEntry({ label: "Collectible #24", rarity: "Superior", type: 13, id: 24, fingerprint: "collectible-24" }),
        ],
        itemTimelineCount: 2,
        logLimitOptions: [10, 20, 50],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        shoppingListItems: ["Copper Ore"],
        shoppingSuggestions: ["Ruby"],
        activeShoppingItem: "Copper Ore",
        activeItemFilterGroups: [itemFilterGroup()],
        itemFilterGroupCount: 1,
        watchedItemCount: 1,
        lastItemFilterMatch: { itemLabel: "Sash of the Magi", groupName: "Loot Alerts", soundName: "Deep Gong", createdAt: state.stats.lastEventAt ?? 0 },
        developerItemResearchEnabled: true,
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

    expect(wrapper.text()).toContain("This Run");
    expect(wrapper.text()).toContain("Gold");
    expect(wrapper.text()).toContain("Kills");
    expect(wrapper.text()).toContain("Sash of the Magi");
    expect(wrapper.text()).toContain("Collectible #24");
    expect(wrapper.text()).toContain("Loot Alerts");

    await buttonByText(wrapper, "Details").trigger("click");
    await buttonByText(wrapper, "Satanic").trigger("click");
    await wrapper.get(".shopping-form").trigger("submit");
    await buttonByText(wrapper, "Configure Filter").trigger("click");
    await buttonByText(wrapper, "Identify").trigger("click");
    await wrapper.get(".logs button").trigger("click");

    expect(wrapper.emitted("update:showCaptureDetails")).toEqual([[true]]);
    expect(wrapper.emitted("update:expandedDropRarity")).toEqual([["Satanic"]]);
    expect(wrapper.emitted("addShoppingItem")).toHaveLength(1);
    expect(wrapper.emitted("configureFilter")).toHaveLength(1);
    expect(wrapper.emitted("identifyTimelineItem")?.[0]?.[0]).toMatchObject({ label: "Collectible #24", type: 13, id: 24 });
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
