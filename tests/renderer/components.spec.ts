import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, test } from "vitest";

import AppTitlebar from "../../src/renderer/src/components/AppTitlebar.vue";
import CompactView from "../../src/renderer/src/components/CompactView.vue";
import ItemFilterView from "../../src/renderer/src/components/ItemFilterView.vue";
import LiveSessionHeader from "../../src/renderer/src/components/LiveSessionHeader.vue";
import LiveView from "../../src/renderer/src/components/LiveView.vue";
import PastRunsView from "../../src/renderer/src/components/PastRunsView.vue";
import PastRunReportConfigModal from "../../src/renderer/src/components/PastRunReportConfigModal.vue";
import SettingsModal from "../../src/renderer/src/components/SettingsModal.vue";
import UpdateBanner from "../../src/renderer/src/components/UpdateBanner.vue";
import WhatsNewPrompt from "../../src/renderer/src/components/WhatsNewPrompt.vue";
import { defaultCompactRunTiles } from "../../src/renderer/src/lib/compact-tiles";
import { TRANSPARENT_PIXEL_URL } from "../../src/renderer/src/lib/item-assets";
import { itemTimelineKey } from "../../src/renderer/src/lib/item-filters";
import { defaultPostRunReportConfig, withPostRunReportSummaryItems } from "../../src/renderer/src/lib/report-config";
import { DEFAULT_THEME_ACCENTS, THEME_OPTIONS } from "../../src/renderer/src/lib/themes";
import { WHATS_NEW_RELEASE } from "../../src/renderer/src/lib/whats-new";
import { companionState, itemFilterGroup, itemTimelineEntry, pastRun } from "./fixtures";

describe("Vue component contracts", () => {
  test("AppTitlebar exposes window chrome actions", async () => {
    const wrapper = mount(AppTitlebar, {
      props: {
        compactMode: true,
      },
    });

    await wrapper.get('button[aria-label="Exit compact mode"]').trigger("click");
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    await wrapper.get('button[aria-label="Minimize"]').trigger("click");
    await wrapper.get('button[aria-label="Close"]').trigger("click");

    expect(wrapper.emitted("toggle-compact-mode")).toHaveLength(1);
    expect(wrapper.emitted("open-compact-settings")).toHaveLength(1);
    expect(wrapper.emitted("minimize-window")).toHaveLength(1);
    expect(wrapper.emitted("close-window")).toHaveLength(1);
  });

  test("LiveSessionHeader exposes primary live-session actions", async () => {
    const wrapper = mount(LiveSessionHeader, {
      props: {
        captureRunning: false,
        runStatus: "paused",
        canToggleRunPaused: true,
        title: "Item Filter",
      },
    });

    expect(wrapper.get("h1").text()).toBe("Item Filter");

    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    await buttonByText(wrapper, "Resume Run").trigger("click");
    await buttonByText(wrapper, "End Run").trigger("click");
    await buttonByText(wrapper, "Launch Game").trigger("click");

    expect(wrapper.emitted("open-settings")).toHaveLength(1);
    expect(wrapper.emitted("toggle-run-paused")).toHaveLength(1);
    expect(wrapper.emitted("end-run")).toHaveLength(1);
    expect(wrapper.emitted("toggle-capture")).toHaveLength(1);
  });

  test("WhatsNewPrompt emits release prompt decisions", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Before prompt";
    document.body.appendChild(opener);
    opener.focus();
    const wrapper = mount(WhatsNewPrompt, {
      attachTo: document.body,
      props: {
        version: "0.2.0",
      },
    });

    await nextTick();
    expect(wrapper.text()).toContain("Version 0.2.0");
    const dialog = wrapper.get('[role="dialog"]');
    expect(document.activeElement).toBe(dialog.element);

    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(buttonByText(wrapper, "Show me").element);

    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttonByText(wrapper, "No Thanks").element);

    await buttonByText(wrapper, "Show me").trigger("click");
    await buttonByText(wrapper, "No Thanks").trigger("click");
    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("dismiss")).toHaveLength(2);
    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

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
    const researchEntry = {
      signature: "4:55:0:gloves #55",
      label: "Gloves #55",
      rarity: "Satanic",
      type: 4,
      id: 55,
      dropQuality: 0,
      classification: "unknown-normal",
      count: 1,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      resolvedName: "",
      notes: "",
      ignored: false,
    };
    const wrapper = mount(ItemFilterView, {
      attachTo: document.body,
      props: {
        itemFilterGroups: [group],
        recoverableCompactFilterGroups: [{ id: "merc-items", name: "Merc Items", tileCount: 1 }],
        itemFilterSounds: [{ id: "crystal-tink", name: "Crystal Tink" }, { id: "deep-gong", name: "Deep Gong" }],
        selectedItemFilterGroup: group,
        selectedItemFilterGroupedItems: [{ typeLabel: "Belt", items: group.items }],
        itemFilterDraftGroupName: "",
        itemFilterDraftItem: "sash",
        itemFilterSuggestions: ["Sash of the Magi"],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterMuted: false,
        developerItemResearchEnabled: true,
        itemResearchEntries: [researchEntry],
        unresolvedItemResearchCount: 1,
      },
    });

    expect(wrapper.text()).toContain("Loot Alerts");
    expect(wrapper.text()).toContain("Merc Items");
    expect(wrapper.text()).toContain("Sash of the Magi");
    expect(wrapper.text()).toContain("Item Research");
    expect(wrapper.text()).toContain("Gloves #55");
    expect(wrapper.text()).toContain("Unknown normal item");

    await buttonByText(wrapper, "Mute All").trigger("click");
    await wrapper.get(".item-filter-add-group").trigger("submit");
    await buttonByText(wrapper, "Restore Merc Items").trigger("click");
    await buttonByText(wrapper, "Sash of the Magi").trigger("click");
    await checkboxByLabel(wrapper, "Satanic").setValue(false);
    await checkboxByLabel(wrapper, "Belt").setValue(false);
    await buttonByText(wrapper, "Export Research JSON").trigger("click");
    await buttonByText(wrapper, "Export Resolved").trigger("click");
    await buttonByText(wrapper, "Export Unresolved").trigger("click");
    const researchInputs = wrapper.findAll(".item-research-row input");
    await researchInputs[0].setValue("Mystery Thing");
    expect(wrapper.text()).toContain("Name is not in known item options.");
    await researchInputs[0].setValue("Sash of the Magi");
    await researchInputs[1].setValue("confirmed");
    await buttonByText(wrapper, "Save").trigger("click");
    await wrapper.setProps({ itemResearchEntries: [{ ...researchEntry, resolvedName: "Sash of the Magi", notes: "confirmed" }] });
    await buttonByText(wrapper, "Clear Resolved").trigger("click");
    await buttonByText(wrapper, "Reset").trigger("click");
    await wrapper.setProps({ itemResearchEntries: [{ ...researchEntry, ignored: true }] });
    await buttonByText(wrapper, "Clear Ignored").trigger("click");
    await wrapper.setProps({ itemResearchEntries: [researchEntry] });
    expect((wrapper.findAll(".item-research-row input")[0].element as HTMLInputElement).value).toBe("");
    await buttonByText(wrapper, "Remove Group").trigger("click");

    expect(wrapper.text()).toContain('Remove "Loot Alerts"?');
    expect(wrapper.emitted("removeGroup")).toBeUndefined();
    const removeDialog = wrapper.get('[aria-labelledby="remove-filter-group-title"]');
    await nextTick();
    expect(document.activeElement).toBe(removeDialog.element);

    const removeButton = wrapper.get(".item-filter-confirm-remove");
    const closeButton = wrapper.get('button[aria-label="Cancel remove group"]');
    (removeButton.element as HTMLButtonElement).focus();
    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(closeButton.element);
    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(removeButton.element);

    await removeDialog.trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(wrapper.text()).not.toContain('Remove "Loot Alerts"?');
    expect(document.activeElement).toBe(buttonByText(wrapper, "Remove Group").element);

    await buttonByText(wrapper, "Remove Group").trigger("click");
    await wrapper.get(".item-filter-confirm-remove").trigger("click");

    expect(wrapper.emitted("update:itemFilterMuted")).toEqual([[true]]);
    expect(wrapper.emitted("addGroup")).toHaveLength(1);
    expect(wrapper.emitted("restoreMissingGroup")?.[0]?.[0]).toEqual({ id: "merc-items", name: "Merc Items", tileCount: 1 });
    expect(wrapper.emitted("removeGroup")?.[0]).toEqual([group]);
    expect(wrapper.emitted("addItemToGroup")?.[0]).toEqual([group, "Sash of the Magi"]);
    expect(wrapper.emitted("exportItemResearch")).toEqual([[], ["resolved"], ["unresolved"]]);
    expect(wrapper.emitted("saveItemResearchEntry")?.[0]).toEqual(["4:55:0:gloves #55", { resolvedName: "Sash of the Magi", notes: "confirmed" }]);
    expect(wrapper.emitted("resetItemResearchEntry")?.[0]).toEqual(["4:55:0:gloves #55"]);
    expect(wrapper.emitted("clearResolvedItemResearchEntries")).toHaveLength(1);
    expect(wrapper.emitted("clearIgnoredItemResearchEntries")).toHaveLength(1);
    expect(wrapper.emitted("updateGroup")).toContainEqual([{ ...group, rarities: [] }]);
    expect(wrapper.emitted("updateGroup")).toContainEqual([{ ...group, types: [] }]);
    expect(group.rarities).toEqual(["Satanic"]);
    expect(group.types).toEqual([6]);
    wrapper.unmount();
  });

  test("ItemFilterView warns when a saved custom sound is missing", async () => {
    const group = itemFilterGroup({
      soundId: "custom-sound:missing-group",
      items: [{ name: "Sash of the Magi", soundId: "custom-sound:missing-item", typeLabel: "Belt" }],
    });
    const wrapper = mount(ItemFilterView, {
      props: {
        itemFilterGroups: [group],
        itemFilterSounds: [{ id: "crystal-tink", name: "Crystal Tink" }, { id: "deep-gong", name: "Deep Gong" }],
        selectedItemFilterGroup: group,
        selectedItemFilterGroupedItems: [{ typeLabel: "Belt", items: group.items }],
        itemFilterDraftGroupName: "",
        itemFilterDraftItem: "",
        itemFilterSuggestions: [],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterMuted: false,
        developerItemResearchEnabled: false,
        itemResearchEntries: [],
        unresolvedItemResearchCount: 0,
      },
    });

    expect(wrapper.text()).toContain("Enabled · Missing custom sound - uses Crystal Tink");
    expect(wrapper.text()).toContain("Missing custom sound. Alerts use Crystal Tink until another sound is selected or the sound is re-imported.");
    expect(wrapper.text()).toContain("Uses Crystal Tink until another sound is selected.");

    await wrapper.get('button[aria-label="Play selected group sound"]').trigger("click");

    expect(wrapper.emitted("testSound")?.[0]).toEqual(["custom-sound:missing-group", 75]);
  });

  test("ItemFilterView filters item research rows by status, type, and rarity", async () => {
    const group = itemFilterGroup();
    const baseEntry = {
      signature: "4:55:0:gloves #55",
      label: "Gloves #55",
      rarity: "Satanic",
      type: 4,
      id: 55,
      dropQuality: 0,
      classification: "unknown-normal",
      count: 1,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      resolvedName: "",
      notes: "",
      ignored: false,
    };
    const wrapper = mount(ItemFilterView, {
      props: {
        itemFilterGroups: [group],
        itemFilterSounds: [{ id: "crystal-tink", name: "Crystal Tink" }],
        selectedItemFilterGroup: null,
        selectedItemFilterGroupedItems: [],
        itemFilterDraftGroupName: "",
        itemFilterDraftItem: "",
        itemFilterSuggestions: [],
        itemTypeOptions: [{ value: "3", label: "Weapon" }, { value: "4", label: "Gloves" }, { value: "13", label: "Collectible" }],
        itemFilterMuted: false,
        developerItemResearchEnabled: true,
        itemResearchEntries: [
          baseEntry,
          { ...baseEntry, signature: "3:10:0:weapon #10", label: "Weapon #10", type: 3, id: 10, resolvedName: "Mystery Blade" },
          { ...baseEntry, signature: "13:24:0:collectible #24", label: "Collectible #24", rarity: "Superior", type: 13, id: 24, classification: "material-collectible", ignored: true },
        ],
        unresolvedItemResearchCount: 1,
      },
    });

    const filters = wrapper.findAll(".item-research-toolbar select");
    await filters[0].setValue("resolved");
    expect(wrapper.text()).toContain("Mystery Blade");
    expect(wrapper.text()).not.toContain("Gloves #55");

    await filters[0].setValue("all");
    await filters[1].setValue("13");
    expect(wrapper.text()).toContain("Collectible #24");
    expect(wrapper.text()).not.toContain("Weapon #10");

    await filters[1].setValue("all");
    await filters[2].setValue("Satanic");
    expect(wrapper.text()).toContain("Gloves #55");
    expect(wrapper.text()).toContain("Mystery Blade");
    expect(wrapper.text()).not.toContain("Collectible #24");
  });

  test("ItemFilterView presents known missing icons as maintainer backlog", async () => {
    const group = itemFilterGroup();
    const missingIconEntry = {
      signature: "3:11:0:angel",
      label: "Angel",
      rarity: "Set",
      type: 3,
      id: 11,
      dropQuality: 0,
      classification: "known-missing-icon",
      count: 1,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      resolvedName: "",
      notes: "",
      ignored: false,
    };
    const wrapper = mount(ItemFilterView, {
      props: {
        itemFilterGroups: [group],
        itemFilterSounds: [{ id: "crystal-tink", name: "Crystal Tink" }],
        selectedItemFilterGroup: null,
        selectedItemFilterGroupedItems: [],
        itemFilterDraftGroupName: "",
        itemFilterDraftItem: "",
        itemFilterSuggestions: [],
        itemTypeOptions: [{ value: "3", label: "Weapon" }],
        itemFilterMuted: false,
        developerItemResearchEnabled: true,
        itemResearchEntries: [missingIconEntry],
        unresolvedItemResearchCount: 0,
      },
    });

    expect(wrapper.text()).toContain("0 need naming \u00b7 1 app icon backlog \u00b7 developer notebook");
    expect(wrapper.find(".item-research-row.missing-icon").exists()).toBe(false);
    await buttonByText(wrapper, "Show Research").trigger("click");
    const row = wrapper.get(".item-research-row.missing-icon");
    expect(row.text()).toContain("App icon missing");
    expect(row.text()).toContain("No player action needed");
    expect(row.get("a").attributes("href")).toBe("https://herosiege.wiki.gg/wiki/Angel");
    expect(row.find('input[placeholder="Actual item name"]').exists()).toBe(false);
    expect(row.find('input[placeholder="Notes"]').exists()).toBe(false);
    await buttonByText(wrapper, "Dismiss").trigger("click");
    expect(wrapper.emitted("ignoreItemResearchEntry")?.[0]).toEqual(["3:11:0:angel"]);

    const filters = wrapper.findAll(".item-research-toolbar select");
    await filters[0].setValue("unresolved");
    expect(wrapper.text()).toContain("No research entries match the current filters.");
    await filters[0].setValue("missing-icon");
    expect(wrapper.text()).toContain("Angel");
  });

  test("SettingsModal keeps persisted settings explicit and emits application actions", async () => {
    const wrapper = mount(SettingsModal, {
      props: {
        logLimitOptions: [10, 20, 50],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterGroups: [itemFilterGroup()],
        itemSuggestions: ["Sash of the Magi"],
        themeOptions: THEME_OPTIONS,
        customItemFilterSounds: [{ id: "custom-sound:boss", name: "Boss Drop", fileName: "boss.wav", src: "file:///sounds/boss.wav" }],
        supportDiagnostics: [
          "Hero Siege Companion capture diagnostics",
          "App version: 0.1.6",
          "Npcap service: Running",
          "Adapter: \\Device\\NPF_Test",
          "Parser errors: 0",
        ].join("\n"),
        supportGeneratedFiles: [
          {
            name: "diagnostics-summary.txt",
            description: "Current capture status and app version.",
          },
        ],
        supportLogFiles: [
          {
            name: "app-debug.log",
            path: "C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion\\app-debug.log",
            description: "App startup diagnostics.",
            exists: true,
            sizeBytes: 2048,
            updatedAt: "2026-05-25T12:00:00.000Z",
          },
          {
            name: "capture-debug.log.old",
            path: "C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion\\capture-debug.log.old",
            description: "Previous capture diagnostics.",
            exists: false,
            sizeBytes: 0,
            updatedAt: null,
          },
        ],
        supportLogsPath: "C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion",
        supportBundleBusy: false,
        whatsNew: WHATS_NEW_RELEASE,
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
        themeId: "dark",
        compactThemeId: "dark",
        themeAccents: { ...DEFAULT_THEME_ACCENTS },
        themeTextures: {},
        compactThemeTextures: {},
        themeForegroundFills: {},
        compactThemeForegroundFills: {},
        skipEmptyRuns: true,
        minRunDurationMinutes: 5,
        configIncludeAppSettings: true,
        configIncludeRunSaving: true,
        configIncludeReportTracking: true,
        configIncludeLootFilters: true,
        configIncludeSounds: true,
        configIncludeItemResearch: false,
        compactRunTiles: defaultCompactRunTiles,
      },
    });

    expect(wrapper.text()).toContain("Settings");
    await buttonByText(wrapper, "Capture").trigger("click");
    expect(wrapper.text()).toContain("Verbose live logging");
    await wrapper.get('nav[role="tablist"]').trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.text()).toContain("Rarity colors stay game-matched.");

    await buttonByText(wrapper, "General").trigger("click");
    expect((wrapper.get(".path-setting input").element as HTMLInputElement).value).toBe("C:\\Games\\Hero Siege\\Hero_Siege.exe");
    await wrapper.get('select[title="Visible log history"]').setValue("50");

    await buttonByText(wrapper, "Appearance").trigger("click");
    expect(wrapper.text()).toContain("Rarity colors stay game-matched.");
    await wrapper.get('select[title="Application theme"]').setValue("cyberpunk");
    await wrapper.get('input[title="Theme accent color"]').setValue("#00f0ff");
    await wrapper.get('select[title="Full app background texture"]').setValue("carbon-fiber");
    await wrapper.get('input[title="Full app foreground fill"]').setValue("62");
    await wrapper.get('select[title="Compact mode theme"]').setValue("light");
    await wrapper.get('input[title="Compact theme accent color"]').setValue("#ffffff");
    await wrapper.get('select[title="Compact background texture"]').setValue("brushed-metal");
    await wrapper.get('input[title="Compact foreground fill"]').setValue("91");
    expect(wrapper.text()).toContain("Theme file reference");
    expect(wrapper.text()).toContain("Export Starter Theme");
    expect(wrapper.text()).toContain("buttonPrimary");
    expect(wrapper.text()).toContain("--button-primary");
    await buttonByText(wrapper, "Export Theme").trigger("click");
    await buttonByText(wrapper, "Export Starter Theme").trigger("click");
    await buttonByText(wrapper, "Import Theme").trigger("click");

    await buttonByText(wrapper, "Sounds").trigger("click");
    expect(wrapper.text()).toContain("Loot alert sounds");
    expect(wrapper.text()).toContain("Boss Drop");
    await buttonByText(wrapper, "Import Sounds").trigger("click");
    await buttonByText(wrapper, "Export Soundpack").trigger("click");
    await wrapper.get('button[aria-label="Remove Boss Drop"]').trigger("click");

    await buttonByText(wrapper, "Import / Export").trigger("click");
    await checkboxByLabel(wrapper, "Sounds").setValue(false);
    await checkboxByLabel(wrapper, "Research data").setValue(true);
    await buttonByText(wrapper, "Import JSON").trigger("click");
    await buttonByText(wrapper, "Export JSON").trigger("click");

    await buttonByText(wrapper, "Dashboard").trigger("click");
    expect(wrapper.text()).toContain("Tile presets");
    expect(wrapper.text()).toContain("Resource Focused");
    await buttonByText(wrapper, "Add Custom").trigger("click");
    await buttonByText(wrapper, "Resource Focused").trigger("click");
    expect(wrapper.text()).toContain("Resource Focused will replace existing custom dashboard tiles.");
    await buttonByText(wrapper, "Replace").trigger("click");

    await buttonByText(wrapper, "What's New").trigger("click");
    expect(wrapper.text()).toContain(`What's New in ${WHATS_NEW_RELEASE.version}`);
    expect(wrapper.text()).toContain("Hero Siege Companion v0.2.5");
    expect(wrapper.text()).toContain("Npcap is still required for capture.");
    expect(wrapper.text()).toContain("Highlights");
    expect(wrapper.text()).toContain(WHATS_NEW_RELEASE.items[0]);
    expect(wrapper.text()).toContain("Themes And Appearance");
    expect(wrapper.text()).toContain("Past Runs");
    expect(wrapper.text()).toContain("Use report presets, linked Item Filter groups, custom recap groups, top-drop limits, and resource drawers to shape run recaps.");
    expect(wrapper.text()).toContain("Item Research can filter, classify, export scoped review data, clear resolved or ignored rows, and separate generated placeholders from missing-icon follow-up work.");
    expect(wrapper.text()).not.toContain("Added The Hierophant for collectible type 13 / id 40.");

    await buttonByText(wrapper, "Support").trigger("click");
    expect(wrapper.text()).toContain("Diagnostics bundle");
    expect(wrapper.text()).toContain("does not include packet captures");
    expect(wrapper.text()).toContain("Npcap service: Running");
    expect(wrapper.text()).toContain("app-debug.log");
    expect(wrapper.text()).not.toContain("capture-debug.log.old");
    expect(wrapper.text()).not.toContain("Missing");
    await buttonByText(wrapper, "Copy Summary").trigger("click");
    await buttonByText(wrapper, "Save ZIP").trigger("click");

    await buttonByText(wrapper, "General").trigger("click");
    await buttonByText(wrapper, "Browse").trigger("click");
    await buttonByText(wrapper, "Reset Preferences").trigger("click");
    await wrapper.get(".modal-backdrop").trigger("click");
    expect(wrapper.find('nav[role="tablist"]').exists()).toBe(true);
    expect(wrapper.findAll('button[role="tab"]').some((tab) => tab.attributes("aria-selected") === "true")).toBe(true);
    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Escape" });
    await buttonByText(wrapper, "Done").trigger("click");

    expect(wrapper.emitted("update:logLimit")).toEqual([[50]]);
    expect(wrapper.emitted("update:themeId")).toEqual([["cyberpunk"]]);
    expect(wrapper.emitted("update:compactThemeId")).toEqual([["light"]]);
    expect(wrapper.emitted("update:themeTextures")).toEqual([[{ cyberpunk: "carbon-fiber" }]]);
    expect(wrapper.emitted("update:compactThemeTextures")).toEqual([[{ light: "brushed-metal" }]]);
    expect(wrapper.emitted("update:themeForegroundFills")).toEqual([[{ cyberpunk: 62 }]]);
    expect(wrapper.emitted("update:compactThemeForegroundFills")).toEqual([[{ light: 91 }]]);
    expect(wrapper.emitted("updateThemeAccent")).toEqual([["#00f0ff", "cyberpunk"], ["#ffffff", "light"]]);
    expect(wrapper.emitted("exportTheme")).toHaveLength(1);
    expect(wrapper.emitted("exportThemeTemplate")).toHaveLength(1);
    expect(wrapper.emitted("importTheme")).toHaveLength(1);
    const settingsTabChanges = wrapper.emitted("settingsTabChange");
    expect(settingsTabChanges).toContainEqual(["capture"]);
    expect(settingsTabChanges).toContainEqual(["appearance"]);
    expect(settingsTabChanges).toContainEqual(["sounds"]);
    expect(settingsTabChanges).toContainEqual(["whatsNew"]);
    expect(settingsTabChanges).toContainEqual(["support"]);
    expect(wrapper.emitted("update:configIncludeSounds")).toEqual([[false]]);
    expect(wrapper.emitted("update:configIncludeItemResearch")).toEqual([[true]]);
    const compactTileUpdates = wrapper.emitted("update:compactRunTiles");
    expect(compactTileUpdates?.[0]?.[0]).toHaveLength(defaultCompactRunTiles.length + 1);
    const resourcePresetTiles = compactTileUpdates?.[1]?.[0] as Array<{ kind: string }>;
    expect(resourcePresetTiles.map((tile) => tile.kind)).toEqual(["duration", "gold", "keys", "ores", "materials", "sz"]);
    expect(wrapper.emitted("chooseGameExecutable")).toHaveLength(1);
    expect(wrapper.emitted("importSounds")).toHaveLength(1);
    expect(wrapper.emitted("exportSounds")).toHaveLength(1);
    expect(wrapper.emitted("removeSound")?.[0]?.[0]).toMatchObject({ id: "custom-sound:boss" });
    expect(wrapper.emitted("copySupportDiagnosticsSummary")).toHaveLength(1);
    expect(wrapper.emitted("saveSupportDiagnostics")).toHaveLength(1);
    expect(wrapper.emitted("importConfiguration")).toHaveLength(1);
    expect(wrapper.emitted("exportConfiguration")).toHaveLength(1);
    expect(wrapper.emitted("reset")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("apply")).toHaveLength(1);
  });

  test("SettingsModal focuses the dialog and links tabs to panels", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open settings";
    document.body.appendChild(opener);
    opener.focus();
    const wrapper = mount(SettingsModal, {
      attachTo: document.body,
      props: settingsModalProps(),
    });

    await nextTick();
    const dialog = wrapper.get('[role="dialog"]');
    const generalTab = wrapper.get('[data-settings-tab="general"]');
    expect(document.activeElement).toBe(dialog.element);
    expect(generalTab.attributes("aria-controls")).toBe("settings-panel-general");
    expect(wrapper.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe("settings-tab-general");
    expect(wrapper.get('[role="tabpanel"]').classes()).toContain("settings-tab-panel");

    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(wrapper.get(".settings-close").element);

    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttonByText(wrapper, "Done").element);

    await dialog.trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test("PastRunsView aggregates saved runs and expands selected report item details", async () => {
    const missingIconDrop = "A Missing Icon Regression Item";
    const run = pastRun({ tags: ["Dungeons"] });
    run.itemBreakdown.Satanic[missingIconDrop] = { name: missingIconDrop, total: 1, mf: 0 };
    const wrapper = mount(PastRunsView, {
      props: {
        pastRuns: [run, pastRun({ id: "run-2", accountName: "ForgeHero", tags: ["Codex"], totalGoldGained: 50_000, durationMs: 300_000 })],
        reportConfig: defaultPostRunReportConfig,
        itemFilterGroups: [itemFilterGroup()],
      },
    });

    expect(wrapper.text()).toContain("2/100 saved");
    expect(wrapper.text()).toContain("All Runs");
    expect(wrapper.text()).toContain("magic-find flagged is the server flag count");
    expect(wrapper.text()).toContain("Magic-find flagged");
    expect(wrapper.text()).toContain("150,000");
    const missingAggregateDrop = wrapper.findAll(".aggregate-detail-panel .aggregate-top-list > div").find((row) => row.text().includes(missingIconDrop));
    if (!missingAggregateDrop) throw new Error("Expected aggregate drop row without a known icon");
    const placeholderIcon = missingAggregateDrop.get("img.drop-breakdown-icon");
    expect(placeholderIcon.attributes("src")).toBe(TRANSPARENT_PIXEL_URL);
    expect(placeholderIcon.attributes("alt")).toBe("");
    expect(missingAggregateDrop.get(".drop-breakdown-name").text()).toBe(missingIconDrop);

    await buttonByText(wrapper, "Details").trigger("click");
    expect(buttonByText(wrapper, "Hide Details").attributes("aria-controls")).toContain("past-run-details-");
    expect(wrapper.text()).toContain("Crystal Key");
    expect(wrapper.text()).toContain("Battle Fragment");
    expect(wrapper.text()).toContain("Sash of the Magi");

    await wrapper.get(".past-run-copy-filtered-summary").trigger("click");
    await wrapper.get(".past-run-export-csv").trigger("click");
    await wrapper.get(".past-run-copy-summary").trigger("click");

    await wrapper.get(".past-run-search input").setValue("dungeons");
    expect(wrapper.text()).toContain("1/2 shown");
    expect(wrapper.findAll(".past-run-card")).toHaveLength(1);

    await wrapper.get(".past-run-search input").setValue("");
    await wrapper.get(".tag-selector-button").trigger("click");
    expect(wrapper.get(".tag-selector-button").attributes("aria-controls")).toContain("run-tag-menu-");
    expect(wrapper.get(".run-tag-menu").attributes("role")).toBe("menu");
    const codexOption = wrapper.findAll(".run-tag-option").find((option) => option.text().includes("#Codex"));
    if (!codexOption) throw new Error("Expected Codex tag option");
    await codexOption.trigger("click");

    await buttonByText(wrapper, "Configure Report").trigger("click");
    expect(wrapper.text()).toContain("Configure Report");

    await buttonByText(wrapper, "Export JSON").trigger("click");

    expect(wrapper.emitted("update-run-tags")).toEqual([[run.id, ["Dungeons", "Codex"]]]);
    expect(wrapper.emitted("export-runs-json")?.[0]?.[0]).toMatchObject({
      kind: "past-runs",
      filter: { runCount: 2 },
    });
    expect(wrapper.emitted("export-runs-csv")?.[0]?.[0]).toContain("section,label,value,mf_flagged,unique,detail");
    expect(wrapper.emitted("export-runs-csv")?.[0]?.[0]).toContain("rarity,Satanic");
    expect(wrapper.emitted("copy-summary")?.[0]?.[0]).toContain("**Hero Siege Past Runs - All Runs**");
    expect(wrapper.emitted("copy-summary")?.[1]?.[0]).toContain("**Hero Siege Run - TestHero**");
  });

  test("PastRunsView keeps empty selected gear buckets out of expanded details", async () => {
    const wrapper = mount(PastRunsView, {
      props: {
        pastRuns: [pastRun()],
        reportConfig: withPostRunReportSummaryItems(defaultPostRunReportConfig, ["filter:merc-items", "rarity:Satanic"]),
        itemFilterGroups: [
          itemFilterGroup({
            id: "merc-items",
            name: "Merc Items",
            rarities: [],
            types: [],
            items: [{ name: "Missing Relic", soundId: "", typeLabel: "Unknown" }],
          }),
        ],
      },
    });

    expect(wrapper.get(".past-run-metrics").text()).toContain("Merc Items");

    await buttonByText(wrapper, "Details").trigger("click");

    const details = wrapper.get(".past-run-details");
    expect(details.text()).toContain("Satanic");
    expect(details.text()).not.toContain("Merc Items");
    expect(wrapper.findAll(".past-run-detail-panel")).toHaveLength(1);
  });

  test("PastRunReportConfigModal owns report editing events", async () => {
    const editableReportConfig = withPostRunReportSummaryItems(defaultPostRunReportConfig, ["metric:gold"]);
    const wrapper = mount(PastRunReportConfigModal, {
      props: {
        reportConfig: editableReportConfig,
        itemFilterGroups: [itemFilterGroup()],
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    await wrapper.get('input[placeholder="New group name"]').setValue("Bossing");
    await buttonByText(wrapper, "Add Group").trigger("submit");
    const createdConfig = wrapper.emitted("update:reportConfig")?.[0]?.[0];

    expect(createdConfig).toMatchObject({
      itemFilterGroupIds: [],
      trackedItems: [],
      itemGroups: [expect.objectContaining({ name: "Bossing", enabled: true, types: [] })],
    });
    expect(createdConfig?.summaryItems).toContain(`group:${createdConfig?.itemGroups[0].id}`);

    await wrapper.setProps({ reportConfig: createdConfig });
    await checkboxByLabel(wrapper, "Loot Alerts").setValue(true);
    const linkedConfig = wrapper.emitted("update:reportConfig")?.[1]?.[0];
    expect(linkedConfig?.itemFilterGroupIds).toEqual(["loot-alerts"]);
    expect(linkedConfig?.summaryItems).toContain("filter:loot-alerts");

    await wrapper.setProps({ reportConfig: linkedConfig });
    await checkboxByLabel(wrapper, "Ring").setValue(true);
    expect(wrapper.emitted("update:reportConfig")?.[2]?.[0].itemGroups[0].types).toEqual([7]);

    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Escape" });
    await buttonByText(wrapper, "Done").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
  });

  test("PastRunReportConfigModal applies presets and confirms before replacing groups", async () => {
    const customReport = {
      ...defaultPostRunReportConfig,
      itemGroups: [{
        id: "bosses",
        name: "Bosses",
        enabled: true,
        rarities: ["Satanic"],
        types: [],
        items: ["Sash of the Magi"],
      }],
      itemFilterGroupIds: ["loot-alerts"],
    };
    const wrapper = mount(PastRunReportConfigModal, {
      props: {
        reportConfig: customReport,
        itemFilterGroups: [itemFilterGroup()],
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    expect(wrapper.text()).toContain("Report presets");
    await buttonByText(wrapper, "Gear Farming").trigger("click");
    expect(wrapper.text()).toContain("Gear Farming will replace existing recap groups and linked Item Filter groups.");
    expect(wrapper.emitted("update:reportConfig")).toBeUndefined();

    await buttonByText(wrapper, "Replace").trigger("click");
    const presetConfig = wrapper.emitted("update:reportConfig")?.[0]?.[0];
    expect(presetConfig).toMatchObject({
      summaryItems: ["metric:gold", "metric:xp", "metric:kills", "metric:mfDrops", "rarity:Satanic", "rarity:Heroic", "rarity:Angelic"],
      summaryMetrics: ["gold", "xp", "kills", "mfDrops"],
      dropRarities: ["Satanic", "Heroic", "Angelic"],
      resourceDrawers: [],
      topDropLimit: 10,
      itemGroups: [],
      itemFilterGroupIds: [],
    });
  });

  test("PastRunReportConfigModal ignores stale deleted filter summary items at the limit", async () => {
    const staleReportConfig = withPostRunReportSummaryItems(defaultPostRunReportConfig, [
      "metric:gold",
      "metric:xp",
      "metric:kills",
      "metric:keys",
      "metric:ores",
      "metric:materials",
      "metric:mfDrops",
      "filter:deleted-filter",
    ]);
    const wrapper = mount(PastRunReportConfigModal, {
      props: {
        reportConfig: staleReportConfig,
        itemFilterGroups: [itemFilterGroup()],
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    const satanicCheckbox = checkboxByLabel(wrapper, "Satanic");
    expect(satanicCheckbox.attributes("disabled")).toBeUndefined();

    await satanicCheckbox.setValue(true);

    const nextConfig = wrapper.emitted("update:reportConfig")?.[0]?.[0];
    expect(nextConfig?.summaryItems).not.toContain("filter:deleted-filter");
    expect(nextConfig?.summaryItems).toContain("rarity:Satanic");

    await wrapper.get('input[placeholder="New group name"]').setValue("Fresh Drops");
    await buttonByText(wrapper, "Add Group").trigger("submit");

    const groupConfig = wrapper.emitted("update:reportConfig")?.[1]?.[0];
    expect(groupConfig?.summaryItems).not.toContain("filter:deleted-filter");
    expect(groupConfig?.summaryItems).toContain(`group:${groupConfig?.itemGroups[0].id}`);
  });

  test("PastRunReportConfigModal traps focus and restores the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open report config";
    document.body.appendChild(opener);
    opener.focus();
    const wrapper = mount(PastRunReportConfigModal, {
      attachTo: document.body,
      props: {
        reportConfig: defaultPostRunReportConfig,
        itemFilterGroups: [itemFilterGroup()],
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    await nextTick();
    const dialog = wrapper.get('[role="dialog"]');
    expect(document.activeElement).toBe(dialog.element);

    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(wrapper.get(".settings-close").element);

    buttonByText(wrapper, "Done").element.focus();
    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(wrapper.get(".settings-close").element);

    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test("LiveView binds the high-churn dashboard controls through explicit update events", async () => {
    const state = companionState();
    const filteredDrop = itemTimelineEntry({ label: "Sash of the Magi", rarity: "Satanic", mfDrop: true });
    const researchDrop = itemTimelineEntry({ label: "Collectible #24", rarity: "Superior", type: 13, id: 24, fingerprint: "collectible-24" });
    const filterGroup = itemFilterGroup();
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
        visibleItemTimeline: [filteredDrop, researchDrop],
        itemTimelineCount: 2,
        itemFilterMatchHistory: [
          {
            id: itemTimelineKey(filteredDrop),
            item: filteredDrop,
            groupId: filterGroup.id,
            groupName: filterGroup.name,
            soundName: "Deep Gong",
            matchedAt: state.stats.lastEventAt ?? 0,
          },
        ],
        logLimitOptions: [10, 20, 50],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterGroups: [filterGroup],
        shoppingListItems: ["Copper Ore"],
        shoppingSuggestions: ["Ruby"],
        activeShoppingItem: "Copper Ore",
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
        hideUnfilteredItems: false,
        shoppingDraftItem: "",
        logLimit: 20,
      },
    });

    expect(wrapper.text()).toContain("This Run");
    expect(wrapper.text()).toContain("Gold");
    expect(wrapper.text()).toContain("Kills");
    expect(wrapper.text()).toContain("Sash of the Magi");
    expect(wrapper.text()).toContain("Collectible #24");
    expect(wrapper.text()).toContain("Loot Alerts");
    expect(wrapper.text()).toContain("1 MF flagged");
    expect(wrapper.text()).toContain("Magic-find flagged");
    expect(wrapper.get('select[title="Filter item timeline by type or item filter"]').text()).toContain("Filter: Loot Alerts");
    expect(wrapper.find("#item-filter-card").exists()).toBe(false);
    const dashboardColumns = wrapper.findAll(".dashboard-column");
    expect(dashboardColumns).toHaveLength(2);
    expect(dashboardColumns[0].findAll(".live-dashboard-card-title h2").map((heading) => heading.attributes("id"))).toEqual([
      "satanic-zone-card-title",
      "item-timeline-card-title",
      "shopping-list-card-title",
    ]);
    expect(dashboardColumns[1].findAll(".live-dashboard-card-title h2").map((heading) => heading.attributes("id"))).toEqual([
      "tracked-drops-card-title",
      "live-log-card-title",
    ]);

    await wrapper.get('button[aria-label="Collapse Gold"]').trigger("click");
    expect(wrapper.find(".collapsible-metric.collapsed").exists()).toBe(true);
    expect(wrapper.get('button[aria-label="Expand Gold"]').exists()).toBe(true);

    await wrapper.get('button[aria-label="Collapse Tracked Items"]').trigger("click");
    expect(wrapper.get("#tracked-drops-card-body").attributes("style")).toContain("display: none");
    await wrapper.get('button[aria-label="Expand Tracked Items"]').trigger("click");
    expect(wrapper.get("#tracked-drops-card-body").attributes("style") ?? "").not.toContain("display: none");

    await buttonByText(wrapper, "Details").trigger("click");
    await buttonByText(wrapper, "Satanic").trigger("click");
    await wrapper.get(".shopping-form").trigger("submit");
    await checkboxByLabel(wrapper, "Hide unfiltered").setValue(true);
    await buttonByText(wrapper, "Loot Alerts").trigger("click");
    await buttonByText(wrapper, "Identify").trigger("click");
    await wrapper.get(".logs button").trigger("click");

    expect(wrapper.emitted("update:showCaptureDetails")).toEqual([[true]]);
    expect(wrapper.emitted("update:expandedDropRarity")).toEqual([["Satanic"]]);
    expect(wrapper.emitted("update:hideUnfilteredItems")).toEqual([[true]]);
    expect(wrapper.emitted("addShoppingItem")).toHaveLength(1);
    expect(wrapper.emitted("openItemFilterGroup")).toEqual([["loot-alerts"]]);
    expect(wrapper.emitted("identifyTimelineItem")?.[0]?.[0]).toMatchObject({ label: "Collectible #24", type: 13, id: 24 });
    expect(wrapper.emitted("toggleLog")?.[0]).toEqual([state.logs[0]]);
  });

  test("LiveView surfaces the Npcap setup checklist when first-run prerequisites are wrong", async () => {
    const state = companionState();
    state.health = {
      ...state.health,
      npcapService: "Stopped",
      adminOnly: true,
      winPcapCompatible: false,
    };
    const wrapper = mount(LiveView, {
      props: {
        state,
        captureStatusLabel: "Needs attention",
        runTileDisplays: [],
        zoneCountdown: "20m",
        zoneResetLabel: "12:30 PM",
        trackedItems: [],
        keyDropTotal: 0,
        oreDropTotal: 0,
        visibleItemTimeline: [],
        itemTimelineCount: 0,
        itemFilterMatchHistory: [],
        logLimitOptions: [10, 20, 50],
        itemTypeOptions: [],
        itemFilterGroups: [],
        shoppingListItems: [],
        shoppingSuggestions: [],
        activeShoppingItem: "",
        developerItemResearchEnabled: false,
        recentLogs: [],
        expandedLogIds: new Set<string>(),
        showCaptureDetails: false,
        expandedDropRarity: null,
        timelineLimit: 10,
        timelineType: "all",
        hideSocketables: false,
        hideKeys: false,
        hideMaterials: false,
        hideUnfilteredItems: false,
        shoppingDraftItem: "",
        logLimit: 20,
      },
    });

    expect(wrapper.text()).toContain("Npcap needs a quick check");
    expect(wrapper.text()).toContain("Current status: Stopped");
    expect(wrapper.text()).toContain("administrator-only access unchecked");
    expect(wrapper.text()).toContain("WinPcap API-compatible mode checked");

    await buttonByText(wrapper, "Open Npcap Guide").trigger("click");

    expect(wrapper.emitted("openNpcapGuide")).toHaveLength(1);
  });
});

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`Unable to find button containing text: ${text}`);
  return button;
}

function checkboxByLabel(wrapper: ReturnType<typeof mount>, text: string) {
  const label = wrapper.findAll("label").find((candidate) => candidate.text().includes(text) && candidate.find("input").exists());
  if (!label) throw new Error(`Unable to find label containing text: ${text}`);
  return label.get("input");
}

function settingsModalProps() {
  return {
    logLimitOptions: [10, 20, 50],
    itemTypeOptions: [{ value: "6", label: "Belt" }],
    itemFilterGroups: [itemFilterGroup()],
    itemSuggestions: ["Sash of the Magi"],
    themeOptions: THEME_OPTIONS,
    customItemFilterSounds: [],
    supportDiagnostics: "Hero Siege Companion capture diagnostics",
    supportGeneratedFiles: [],
    supportLogFiles: [],
    supportLogsPath: "C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion",
    supportBundleBusy: false,
    whatsNew: WHATS_NEW_RELEASE,
    logLimit: 20,
    timelineLimit: 10,
    timelineType: "all",
    launchThroughSteam: false,
    gameExecutablePath: "",
    showCaptureDetails: false,
    createDebugMode: false,
    alwaysOnTop: true,
    lockCompactLocation: false,
    hideSocketables: false,
    hideKeys: false,
    hideMaterials: false,
    developerItemResearchEnabled: true,
    unknownItemAudioPrompt: false,
    themeId: "dark",
    compactThemeId: "dark",
    themeAccents: { ...DEFAULT_THEME_ACCENTS },
    themeTextures: {},
    compactThemeTextures: {},
    themeForegroundFills: {},
    compactThemeForegroundFills: {},
    skipEmptyRuns: true,
    minRunDurationMinutes: 5,
    configIncludeAppSettings: true,
    configIncludeRunSaving: true,
    configIncludeReportTracking: true,
    configIncludeLootFilters: true,
    configIncludeSounds: true,
    configIncludeItemResearch: false,
    compactRunTiles: defaultCompactRunTiles,
  };
}
