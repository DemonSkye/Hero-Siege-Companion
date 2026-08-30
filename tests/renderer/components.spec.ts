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
import { TRANSPARENT_PIXEL_URL } from "../../src/renderer/src/lib/item-assets";
import { itemTimelineKey } from "../../src/renderer/src/lib/item-filters";
import { defaultPostRunReportConfig, withPostRunReportSummaryItems } from "../../src/renderer/src/lib/report-config";
import { THEME_OPTIONS } from "../../src/renderer/src/lib/themes";
import { WHATS_NEW_RELEASE } from "../../src/renderer/src/lib/whats-new";
import { baseTime, companionState, itemFilterGroup, itemTimelineEntry, pastRun } from "./fixtures";

describe("Vue component contracts", () => {
  test("AppTitlebar exposes window chrome actions", async () => {
    const wrapper = mount(AppTitlebar, {
      props: {
        compactMode: true,
        fullWindowPinned: false,
      },
    });

    expect(wrapper.findAll(".window-controls button")).toHaveLength(4);

    await wrapper.get('button[aria-label="Exit compact mode"]').trigger("click");
    await wrapper.get('button[aria-label="Customize compact mode"]').trigger("click");
    await wrapper.get('button[aria-label="Minimize"]').trigger("click");
    await wrapper.get('button[aria-label="Close"]').trigger("click");

    expect(wrapper.emitted("toggle-compact-mode")).toHaveLength(1);
    expect(wrapper.emitted("open-compact-customization")).toHaveLength(1);
    expect(wrapper.emitted("minimize-window")).toHaveLength(1);
    expect(wrapper.emitted("close-window")).toHaveLength(1);

    await wrapper.setProps({ compactMode: false });
    expect(wrapper.findAll(".window-controls button")).toHaveLength(5);
    await wrapper.get('button[aria-label="Pin window on top"]').trigger("click");
    await wrapper.get('button[aria-label="Maximize or restore"]').trigger("click");

    expect(wrapper.emitted("toggle-full-window-pinned")).toHaveLength(1);
    expect(wrapper.emitted("toggle-maximize-window")).toHaveLength(1);
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
        now: baseTime,
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
        satanicZoneRefreshSubmitting: false,
      },
    });

    expect(wrapper.text()).toContain("This Run");
    expect(wrapper.text()).toContain("Recording");
    expect(wrapper.text()).toContain("10,000");
    expect(wrapper.text()).toContain("Kills");
    expect(wrapper.text()).toContain("Siege Fields");
    expect(wrapper.find('.compact-zone-refresh-button').exists()).toBe(false);
    expect(wrapper.find(".compact-zone-tile-with-refresh").exists()).toBe(false);

    await wrapper.get(".compact-zone-tray .compact-shopping-close").trigger("click");
    await buttonByText(wrapper, "Stop").trigger("click");
    await buttonByText(wrapper, "End Run").trigger("click");
    await buttonByText(wrapper, "SZ Details").trigger("click");

    expect(wrapper.emitted("toggleRunPaused")).toHaveLength(1);
    expect(wrapper.emitted("endRun")).toHaveLength(1);
    expect(wrapper.emitted("update:showZone")).toEqual([[false], [true]]);
  });

  test("CompactView places the opted-in refresh action beside the SZ clock and emits it after gating", async () => {
    const state = companionState();
    state.satanicZone = {
      ...state.satanicZone,
      refreshEnabled: true,
      refreshAvailable: true,
      refreshExperimental: true,
      nextAllowedRefreshAt: baseTime + 30_000,
    };
    const wrapper = mount(CompactView, {
      props: {
        state,
        now: baseTime,
        compactRunTileDisplays: [
          { id: "sz", kind: "sz", label: "SZ", value: "20m", title: "Satanic zone details" },
        ],
        runPausedLabel: "Paused",
        canToggleRunPaused: true,
        showZone: false,
        satanicZoneRefreshSubmitting: false,
      },
    });

    const clock = wrapper.get(".compact-zone-clock");
    expect(clock.element.parentElement?.classList.contains("compact-zone-tile-with-refresh")).toBe(true);
    expect(clock.get("strong").text()).toBe("20m");
    const refreshButton = clock.get(".compact-zone-refresh-button");
    expect(refreshButton.attributes("disabled")).toBeDefined();
    expect(refreshButton.attributes("title")).toBe("Refresh available in 30s.");
    expect(refreshButton.attributes("aria-label")).toBe("Refresh Satanic Zone unavailable: Refresh available in 30s.");

    await wrapper.setProps({ now: baseTime + 30_000 });
    expect(refreshButton.attributes("disabled")).toBeUndefined();
    expect(refreshButton.attributes("aria-label")).toBe("Refresh Satanic Zone");
    await refreshButton.trigger("click");

    expect(wrapper.emitted("refreshSatanicZone")).toHaveLength(1);
  });

  test("CompactView lets main recheck stale readiness and blocks only the local submission", async () => {
    const state = companionState();
    state.captureRunning = false;
    state.captureStatus = "error";
    state.satanicZone = {
      ...state.satanicZone,
      phase: "updating",
      refreshEnabled: true,
      refreshAvailable: false,
      refreshExperimental: false,
      nextAllowedRefreshAt: null,
      errorCode: "helper_unavailable",
    };
    const wrapper = mount(CompactView, {
      props: {
        state,
        now: baseTime,
        compactRunTileDisplays: [
          { id: "sz", kind: "sz", label: "SZ", value: "20m", title: "Satanic zone details" },
        ],
        runPausedLabel: "Paused",
        canToggleRunPaused: true,
        showZone: false,
        satanicZoneRefreshSubmitting: false,
      },
    });

    const refreshButton = wrapper.get(".compact-zone-refresh-button");
    expect(refreshButton.attributes("disabled")).toBeUndefined();
    expect(refreshButton.attributes("title")).toBe("Refresh Satanic Zone");
    await refreshButton.trigger("click");
    expect(wrapper.emitted("refreshSatanicZone")).toHaveLength(1);

    await wrapper.setProps({ satanicZoneRefreshSubmitting: true });
    expect(refreshButton.attributes("disabled")).toBeDefined();
    expect(refreshButton.attributes("title")).toBe("Submitting a manual refresh request.");
    await refreshButton.trigger("click");
    expect(wrapper.emitted("refreshSatanicZone")).toHaveLength(1);
  });

  test("ItemFilterView exposes the collapsible Filter Stack and contextual pack and sound actions", async () => {
    const group = itemFilterGroup();
    const customSound = {
      id: "custom-sound:boss",
      name: "Boss Drop",
      fileName: "boss.wav",
      src: "file:///sounds/boss.wav",
    };
    const wrapper = mount(ItemFilterView, {
      attachTo: document.body,
      props: {
        itemFilterGroups: [group],
        recoverableCompactFilterGroups: [{ id: "merc-items", name: "Merc Items", tileCount: 1 }],
        itemFilterSounds: [
          { id: "crystal-tink", name: "Crystal Tink" },
          { id: "deep-gong", name: "Deep Gong" },
          { id: customSound.id, name: customSound.name },
        ],
        customItemFilterSounds: [customSound],
        selectedItemFilterGroup: group,
        itemFilterDraftGroupName: "",
        itemFilterDraftItem: "sash",
        itemFilterSuggestions: ["Sash of the Magi"],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterMuted: false,
      },
    });

    expect(wrapper.text()).toContain("Filter Stack");
    expect(wrapper.text()).toContain("On · 1 rarity · 1 type · 1 watched · Crystal Tink");
    expect(wrapper.text()).not.toContain("Item Research");

    const groupToggle = wrapper.get(".filter-stack-toggle");
    expect(groupToggle.attributes("aria-expanded")).toBe("true");
    await groupToggle.trigger("click");
    expect(groupToggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".filter-stack-card-body").exists()).toBe(false);
    await groupToggle.trigger("click");

    await buttonByText(wrapper, "Mute all").trigger("click");
    await wrapper.get(".item-filter-add-group").trigger("submit");
    await buttonByText(wrapper, "Restore Merc Items").trigger("click");
    await buttonByText(wrapper, "Sash of the Magi").trigger("click");
    await checkboxByLabel(wrapper, "Satanic").setValue(false);
    await checkboxByLabel(wrapper, "Belt").setValue(false);
    await buttonByText(wrapper, "Import pack").trigger("click");
    await buttonByText(wrapper, "Export pack").trigger("click");

    await wrapper.get(".filter-stack-utility-toggle").trigger("click");
    expect(wrapper.text()).toContain("Loot alert sounds");
    expect(wrapper.text()).toContain("Boss Drop");
    await buttonByText(wrapper, "Import sounds").trigger("click");
    await buttonByText(wrapper, "Export soundpack").trigger("click");

    await wrapper.setProps({
      pendingItemFilterPackImport: {
        groups: [itemFilterGroup({ id: "shared-drops", name: "Shared Drops" })],
        sounds: [],
        unusedSounds: [],
        missingCustomSoundIds: [],
      },
    });
    await nextTick();
    expect(wrapper.text()).toContain("Add this pack?");
    expect(wrapper.text()).toContain("Shared Drops");
    await buttonByText(wrapper, "Add pack").trigger("click");

    await buttonByText(wrapper, "Remove group").trigger("click");
    expect(wrapper.text()).toContain('Remove “Loot Alerts”?');
    expect(wrapper.emitted("removeGroup")).toBeUndefined();
    const removeDialog = wrapper.get('[aria-labelledby="remove-filter-group-title"]');
    await nextTick();
    expect(document.activeElement).toBe(removeDialog.element);
    await wrapper.get(".item-filter-confirm-remove").trigger("click");

    expect(wrapper.emitted("update:itemFilterMuted")).toEqual([[true]]);
    expect(wrapper.emitted("selectGroup")?.at(-1)).toEqual([group]);
    expect(wrapper.emitted("addGroup")).toHaveLength(1);
    expect(wrapper.emitted("restoreMissingGroup")?.[0]?.[0]).toEqual({ id: "merc-items", name: "Merc Items", tileCount: 1 });
    expect(wrapper.emitted("removeGroup")?.[0]).toEqual([group]);
    expect(wrapper.emitted("addItemToGroup")?.[0]).toEqual([group, "Sash of the Magi"]);
    expect(wrapper.emitted("importFilterPack")).toHaveLength(1);
    expect(wrapper.emitted("exportFilterPack")).toHaveLength(1);
    expect(wrapper.emitted("confirmFilterPackImport")).toHaveLength(1);
    expect(wrapper.emitted("importSounds")).toHaveLength(1);
    expect(wrapper.emitted("exportSoundpack")).toHaveLength(1);
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
        itemFilterDraftGroupName: "",
        itemFilterDraftItem: "",
        itemFilterSuggestions: [],
        itemTypeOptions: [{ value: "6", label: "Belt" }],
        itemFilterMuted: false,
      },
    });

    expect(wrapper.text()).toContain("On · 1 rarity · 1 type · 1 watched · Crystal Tink fallback");
    expect(wrapper.text()).toContain("The original custom sound is missing. Alerts use Crystal Tink until you choose another.");
    expect(wrapper.text()).toContain("Uses Crystal Tink until another sound is selected.");

    await wrapper.get('button[aria-label="Preview Loot Alerts sound"]').trigger("click");

    expect(wrapper.emitted("testSound")?.[0]).toEqual(["custom-sound:missing-group", 75]);
  });

  test("SettingsModal exposes the unified autosaving settings ledger and support actions", async () => {
    const wrapper = mount(SettingsModal, {
      props: {
        ...settingsModalProps(),
        legacyThemeAvailable: true,
        legacyCompactThemeAvailable: true,
        legacyResearchAvailable: true,
        supportDiagnostics: [
          "Hero Siege Companion capture diagnostics",
          "App version: 0.2.8",
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
            path: "C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion\\logs\\app-debug.log",
            description: "App startup diagnostics.",
            exists: true,
            sizeBytes: 2048,
            updatedAt: "2026-05-25T12:00:00.000Z",
          },
          {
            name: "capture-debug.log.old",
            path: "C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion\\logs\\capture-debug.log.old",
            description: "Previous capture diagnostics.",
            exists: false,
            sizeBytes: 0,
            updatedAt: null,
          },
        ],
        gameExecutablePath: "C:\\Games\\Hero Siege\\Hero_Siege.exe",
      },
    });

    expect(wrapper.text()).toContain("A small set of app-wide choices");
    expect(wrapper.text()).toContain("Saved");
    expect(wrapper.text()).not.toContain("Done");
    expect(wrapper.text()).not.toContain("Apply");
    expect(wrapper.text()).not.toContain("Game executable");

    await wrapper.get('input[type="radio"][value="false"]').setValue(true);
    expect(wrapper.emitted("update:launchThroughSteam")?.[0]).toEqual([false]);
    await wrapper.setProps({ launchThroughSteam: false });
    expect((wrapper.get("#settings-game-executable").element as HTMLInputElement).value).toBe("C:\\Games\\Hero Siege\\Hero_Siege.exe");
    await buttonByText(wrapper, "Browse").trigger("click");

    await wrapper.get('[data-settings-section="appearance"]').trigger("click");
    expect(wrapper.findAll("option").filter((option) => option.text().includes("Legacy Custom"))).toHaveLength(2);
    await wrapper.get("#settings-app-theme").setValue("cyberpunk");
    await wrapper.get("#settings-compact-theme").setValue("light");
    await buttonByText(wrapper, "Reset Themes").trigger("click");

    await wrapper.get('[data-settings-section="features"]').trigger("click");
    await wrapper.get(".settings-switch input").trigger("change");
    expect(wrapper.emitted("update:satanicZoneRefreshEnabled")).toBeUndefined();
    expect(wrapper.text()).not.toContain("Exclusive");
    await buttonByText(wrapper, "Enable SZ Refresh").trigger("click");
    await buttonByText(wrapper, "Learn More").trigger("click");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("VPNs, system proxies, firewalls, and network-security tools");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("once every 30 seconds");
    await buttonByText(wrapper, "Close").trigger("click");

    await wrapper.get('[data-settings-section="support"]').trigger("click");
    expect(wrapper.text()).toContain("Backup & Restore");
    expect(wrapper.text()).toContain("Enhanced diagnostics");
    expect(wrapper.text()).toContain("Deep diagnostics");
    await buttonByText(wrapper, "Export Backup").trigger("click");
    await buttonByText(wrapper, "Restore Backup").trigger("click");
    await buttonByText(wrapper, "Turn On").trigger("click");
    await buttonByText(wrapper, "Start 10 min").trigger("click");
    const deepDisclosure = wrapper.findAll("details").find((details) => details.text().includes("Deep diagnostics"));
    if (!deepDisclosure) throw new Error("Expected deep diagnostics disclosure");
    await deepDisclosure.get("summary").trigger("click");
    await buttonByText(wrapper, "Start 10 min…").trigger("click");
    expect(wrapper.emitted("setDiagnosticsMode")).toHaveLength(2);
    await buttonByText(wrapper, "Start 10 Minutes").trigger("click");
    await buttonByText(wrapper, "Open Log Folder").trigger("click");
    await buttonByText(wrapper, "Create Support Bundle").trigger("click");
    await buttonByText(wrapper, "Reset Window Position").trigger("click");

    await wrapper.setProps({
      backupPreview: {
        sourceVersion: 2,
        settings: 4,
        filterGroups: 3,
        sounds: 2,
        customThemes: 1,
        compactTiles: 6,
        legacyFormat: false,
      },
    });
    await nextTick();
    expect(wrapper.get(".settings-action-dialog").text()).toContain("3 item filters");
    await exactButtonByText(wrapper, "Restore Backup").trigger("click");
    await wrapper.setProps({ backupPreview: null });

    await buttonByText(wrapper, "Factory Reset").trigger("click");
    await checkboxByLabel(wrapper, "Also delete item filters").setValue(true);
    await exactButtonByText(wrapper, "Factory Reset").trigger("click");

    expect(wrapper.text()).toContain(`Hero Siege Companion ${WHATS_NEW_RELEASE.version}`);
    expect(wrapper.text()).toContain(WHATS_NEW_RELEASE.title);
    expect(wrapper.text()).toContain("Refined Live Session by removing the separate Run Command banner");
    expect(wrapper.text()).toContain("Added a full-width collapsible Run Pace graph");
    expect(wrapper.text()).toContain("Redesigned Item Filters as a collapsible Filter Stack");
    expect(wrapper.text()).toContain("Redesigned Past Runs as Report Desk");
    expect(wrapper.text()).toContain("Rebuilt Settings as one autosaving");
    expect(wrapper.text()).toContain("Past Runs now keeps up to 250 meaningful runs");
    expect(wrapper.text()).toContain("Retired the player-facing Item Research notebook");
    expect(wrapper.text()).toContain("Added experimental manual Satanic Zone refresh.");
    expect(wrapper.text()).toContain("changing it while connected can disconnect the active game.");
    expect(wrapper.text()).toContain("Patched stability issues across capture startup, packet handling, diagnostics, and native shutdown.");
    expect(wrapper.text()).toContain("Updated the tracked Hero Siege season number to Season 11.");
    expect(wrapper.text()).toContain(
      "Added automatic item recognition using the game's own item list, so most named drops no longer need to be identified by hand.",
    );
    expect(wrapper.text()).toContain(
      "Fixed ordinary randomly generated items, including charms, being mistaken for Set items. They now show their correct base type and no longer inflate Set totals.",
    );
    expect(wrapper.text()).toContain(
      "Fixed captured item drops disappearing before they reached the timeline, including Satanic and Set items while the optional relay is active.",
    );
    expect(wrapper.text()).toContain(
      "Added the current Act 9 Satanic Zone names, so zones such as Shipwreck Cove no longer appear as raw map codes.",
    );
    expect(wrapper.text()).toContain("Various bug fixes and reliability improvements.");
    expect(wrapper.text()).toContain("Npcap is still required for capture.");
    expect(WHATS_NEW_RELEASE.items).toHaveLength(17);
    expect(WHATS_NEW_RELEASE.sections).toHaveLength(0);
    expect(wrapper.text()).toContain("Highlights");
    const whatsNew = wrapper.get(".settings-whats-new");
    expect(whatsNew.text()).not.toContain("Themes And Appearance");
    expect(whatsNew.text()).not.toContain("Added The Hierophant for collectible type 13 / id 40.");

    await wrapper.get('[data-settings-section="developers"]').trigger("click");
    expect(wrapper.text()).toContain("Advanced theme-authoring resources");
    expect(wrapper.text()).toContain("Player-facing Item Research has been retired.");
    await buttonByText(wrapper, "Import Theme").trigger("click");
    await buttonByText(wrapper, "Export Current Theme").trigger("click");
    await buttonByText(wrapper, "Download Starter Theme").trigger("click");
    await buttonByText(wrapper, "Copy Reference").trigger("click");
    await buttonByText(wrapper, "Export Legacy Research").trigger("click");

    await wrapper.get(".modal-backdrop").trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("update:satanicZoneRefreshEnabled")).toEqual([[true]]);
    expect(wrapper.emitted("update:themeId")).toEqual([["cyberpunk"]]);
    expect(wrapper.emitted("update:compactThemeId")).toEqual([["light"]]);
    expect(wrapper.emitted("resetThemes")).toHaveLength(1);
    expect(wrapper.emitted("setDiagnosticsMode")).toEqual([
      ["enhanced", "manual"],
      ["enhanced", "timed"],
      ["deep", "timed"],
    ]);
    expect(wrapper.emitted("exportBackup")).toHaveLength(1);
    expect(wrapper.emitted("chooseBackup")).toHaveLength(1);
    expect(wrapper.emitted("confirmRestoreBackup")).toHaveLength(1);
    expect(wrapper.emitted("factoryReset")).toEqual([[true]]);
    expect(wrapper.emitted("exportTheme")).toHaveLength(1);
    expect(wrapper.emitted("exportThemeTemplate")).toHaveLength(1);
    expect(wrapper.emitted("importTheme")).toHaveLength(1);
    const settingsTabChanges = wrapper.emitted("settingsTabChange");
    expect(settingsTabChanges).toContainEqual(["appearance"]);
    expect(settingsTabChanges).toContainEqual(["support"]);
    expect(settingsTabChanges).toContainEqual(["developers"]);
    expect(wrapper.emitted("chooseGameExecutable")).toHaveLength(1);
    expect(wrapper.emitted("openSupportLogsDirectory")).toHaveLength(1);
    expect(wrapper.emitted("saveSupportDiagnostics")).toHaveLength(1);
    expect(wrapper.emitted("resetWindowPosition")).toHaveLength(1);
    expect(wrapper.emitted("copyThemeTokenReference")).toHaveLength(1);
    expect(wrapper.emitted("exportLegacyResearch")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("SettingsModal focuses the dialog and keyboard-navigates its ledger sections", async () => {
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
    const appSection = wrapper.get('[data-settings-section="app"]');
    expect(document.activeElement).toBe(dialog.element);
    expect(appSection.attributes("aria-current")).toBe("page");
    expect(wrapper.get(".settings-ledger-content").attributes("aria-label")).toBe("App section");

    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(wrapper.get(".settings-close").element);

    await wrapper.get(".settings-ledger-nav").trigger("keydown", { key: "ArrowRight" });
    await nextTick();
    expect(wrapper.get('[data-settings-section="appearance"]').attributes("aria-current")).toBe("page");
    expect(wrapper.get(".settings-ledger-content").attributes("aria-label")).toBe("Appearance section");

    await dialog.trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test("PastRunsView presents the Report Desk aggregate and same-view run detail", async () => {
    const missingIconDrop = "A Missing Icon Regression Item";
    const run = pastRun({ tags: ["Dungeons"] });
    run.itemBreakdown.Heroic[missingIconDrop] = { name: missingIconDrop, total: 1, mf: 0 };
    const wrapper = mount(PastRunsView, {
      props: {
        pastRuns: [run, pastRun({ id: "run-2", accountName: "ForgeHero", tags: ["Codex"], totalGoldGained: 50_000, durationMs: 300_000 })],
        reportConfig: defaultPostRunReportConfig,
        itemFilterGroups: [itemFilterGroup()],
      },
    });

    expect(wrapper.text()).toContain("Report Desk");
    expect(wrapper.text()).toContain("2 saved");
    expect(wrapper.text()).toContain("All Runs");
    expect(wrapper.text()).toContain("magic-find flagged is the server flag count");
    expect(wrapper.text()).toContain("Heroic");
    expect(wrapper.text()).toContain("Gold/h");
    expect(wrapper.text()).toContain("600,000");
    const missingAggregateDrop = wrapper.findAll(".aggregate-detail-panel .aggregate-top-list > div").find((row) => row.text().includes(missingIconDrop));
    if (!missingAggregateDrop) throw new Error("Expected aggregate drop row without a known icon");
    const placeholderIcon = missingAggregateDrop.get("img.drop-breakdown-icon");
    expect(placeholderIcon.attributes("src")).toBe(TRANSPARENT_PIXEL_URL);
    expect(placeholderIcon.attributes("alt")).toBe("");
    expect(missingAggregateDrop.get(".drop-breakdown-name").text()).toBe(missingIconDrop);

    await wrapper.get(".past-run-copy-filtered-summary").trigger("click");
    await wrapper.get(".past-run-export-csv").trigger("click");
    await wrapper.get(".past-run-export-json").trigger("click");

    await wrapper.findAll(".past-run-card-primary-action")[0].trigger("click");
    expect(wrapper.get(".past-run-single-report").text()).toContain("TestHero");
    expect(wrapper.get(".past-run-details").text()).toContain("Copper Ore");
    expect(wrapper.get(".past-run-details").text()).toContain("Scourge Loop");
    await wrapper.get(".past-run-copy-selected-summary").trigger("click");

    await wrapper.get('button[aria-label="More actions for TestHero"]').trigger("click");
    expect(wrapper.get(".past-run-action-menu").attributes("role")).toBe("menu");
    await wrapper.get(".past-run-copy-summary").trigger("click");
    await wrapper.get('button[aria-label="More actions for TestHero"]').trigger("click");
    await buttonByText(wrapper, "Edit Tags").trigger("click");
    expect(wrapper.get(".run-tag-menu").attributes("role")).toBe("menu");
    const codexOption = wrapper.findAll(".run-tag-option").find((option) => option.text().includes("#Codex"));
    if (!codexOption) throw new Error("Expected Codex tag option");
    await codexOption.trigger("click");

    await wrapper.get(".past-run-search input").setValue("dungeons");
    expect(wrapper.text()).toContain("1/2 shown");
    expect(wrapper.findAll(".past-run-library-card")).toHaveLength(1);

    await wrapper.get(".past-run-search input").setValue("");
    await wrapper.get(".past-run-library-aggregate").trigger("click");

    await buttonByText(wrapper, "Configure Report").trigger("click");
    expect(wrapper.text()).toContain("Configure Report");

    expect(wrapper.emitted("update-run-tags")).toEqual([[run.id, ["Dungeons", "Codex"]]]);
    expect(wrapper.emitted("export-runs-json")?.[0]?.[0]).toMatchObject({
      kind: "past-runs",
      filter: { runCount: 2 },
    });
    expect(wrapper.emitted("export-runs-csv")?.[0]?.[0]).toContain("section,label,value,mf_flagged,unique,detail");
    expect(wrapper.emitted("export-runs-csv")?.[0]?.[0]).toContain("rarity,Heroic");
    const copiedSummaries = wrapper.emitted("copy-summary")?.map((entry) => entry[0] as string) ?? [];
    expect(copiedSummaries).toEqual(expect.arrayContaining([
      expect.stringContaining("**Hero Siege Past Runs - All Runs**"),
      expect.stringContaining("**Hero Siege Run - TestHero**"),
    ]));
  });

  test("PastRunsView keeps empty selected gear buckets out of the run detail report", async () => {
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

    expect(wrapper.get(".aggregate-metrics").text()).toContain("Merc Items");
    expect(wrapper.get(".aggregate-detail-grid").text()).not.toContain("Merc Items");

    await wrapper.get(".past-run-card-primary-action").trigger("click");

    expect(wrapper.get(".past-run-metrics").text()).toContain("Merc Items");
    const details = wrapper.get(".past-run-details");
    expect(details.text()).toContain("Satanic");
    expect(details.text()).not.toContain("Merc Items");
    expect(wrapper.findAll(".past-run-detail-panel")).toHaveLength(1);
  });

  test("PastRunsView confirms deleting all runs and individual saved runs", async () => {
    const wrapper = mount(PastRunsView, {
      props: {
        pastRuns: [
          pastRun({ id: "run-alpha", accountName: "Run Alpha" }),
          pastRun({ id: "run-beta", accountName: "Run Beta" }),
        ],
        reportConfig: defaultPostRunReportConfig,
        itemFilterGroups: [],
      },
    });

    const deleteAllButton = wrapper.get('button[aria-label="Delete all past runs"]');
    expect(deleteAllButton.find(".trash-icon").exists()).toBe(true);

    await deleteAllButton.trigger("click");
    expect(wrapper.emitted("delete-all-runs")).toBeUndefined();
    expect(wrapper.get('[aria-label="Confirm delete all past runs"]').text()).toContain("Delete 2 saved runs?");

    await wrapper.get(".past-run-cancel-delete-all").trigger("click");
    expect(wrapper.find('[aria-label="Confirm delete all past runs"]').exists()).toBe(false);

    await wrapper.get('button[aria-label="Delete all past runs"]').trigger("click");
    await wrapper.get(".past-run-confirm-delete-all").trigger("click");
    expect(wrapper.emitted("delete-all-runs")).toEqual([[]]);

    await wrapper.get('button[aria-label="More actions for Run Alpha"]').trigger("click");
    expect(wrapper.get('[aria-label="Actions for Run Alpha"]').attributes("role")).toBe("menu");
    await buttonByText(wrapper, "Delete").trigger("click");
    expect(wrapper.emitted("delete-run")).toBeUndefined();
    expect(wrapper.get('[aria-label="Confirm delete Run Alpha"]').text()).toContain("Delete this run?");

    await wrapper.get(".past-run-confirm-delete").trigger("click");
    expect(wrapper.emitted("delete-run")).toEqual([["run-alpha"]]);
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
    const now = state.stats.lastEventAt ?? Date.now();
    state.satanicZone = {
      current: state.stats.satanicZone,
      phase: "current",
      source: "captured",
      lastAttemptAt: now - 1_000,
      lastSuccessAt: now,
      refreshEnabled: true,
      refreshAvailable: true,
      refreshExperimental: true,
      validUntil: now + 600_000,
      nextAllowedRefreshAt: null,
      errorCode: null,
    };
    const filteredDrop = itemTimelineEntry({ label: "Sash of the Magi", rarity: "Satanic", mfDrop: true });
    const ordinaryDrop = itemTimelineEntry({ label: "Collectible #24", rarity: "Superior", type: 13, id: 24, fingerprint: "collectible-24" });
    const filterGroup = itemFilterGroup();
    const wrapper = mount(LiveView, {
      props: {
        state,
        now,
        captureStatusLabel: "Capturing",
        liveRunGraphElapsedMs: 600_000,
        runPausedLabel: "Paused",
        runTileDisplays: [
          { id: "duration", kind: "duration", label: "This Run", value: "10m", detail: "TestHero" },
          { id: "gold", kind: "gold", label: "Gold", value: "10k", detail: "60,000/h - Current 1,010,000" },
          { id: "xp", kind: "xp", label: "XP", value: "30k/h", detail: "5,000 earned" },
          { id: "kills", kind: "kills", label: "Kills", value: "25", detail: "150/h" },
        ],
        liveRunGraphLanes: [],
        liveRunGraphCustomItems: [],
        liveRunGraphEnabledStandardMetrics: ["xp", "gold", "kills", "items"],
        liveRunItemNameOptions: ["Aurelion Fury"],
        zoneCountdown: "20m",
        zoneResetLabel: "12:30 PM",
        satanicZoneRefreshSubmitting: false,
        trackedItems: [
          { rarity: "Set", total: 1, mf: 0, perHour: 6, drops: [{ name: "Earth Shaper's Boots", total: 1, mf: 0 }] },
          { rarity: "Satanic", total: 2, mf: 1, perHour: 12, drops: [{ name: "Sash of the Magi", total: 2, mf: 1 }] },
        ],
        keyDropTotal: 2,
        oreDropTotal: 5,
        visibleItemTimeline: [filteredDrop, ordinaryDrop],
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
        recentLogs: state.logs,
        expandedLogIds: new Set<string>(),
        showCaptureDetails: false,
        expandedDropRarity: null,
        timelineType: "all",
        hideSocketables: false,
        hideKeys: false,
        hideMaterials: false,
        hideUnfilteredItems: false,
        shoppingDraftItem: "",
        logLimit: 20,
        hiddenFixtures: [],
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
    expect(wrapper.text()).not.toContain("Run command");
    expect(wrapper.text()).toContain("Run Pace");
    expect(wrapper.get('summary[aria-label="Customize dashboard"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Identify");
    expect(wrapper.findAll(".run-score-cell")).toHaveLength(4);
    expect(wrapper.findAll(".run-score-cell").map((cell) => cell.classes().find((name) => name.startsWith("run-score-") && name !== "run-score-cell"))).toEqual([
      "run-score-duration",
      "run-score-gold",
      "run-score-xp",
      "run-score-kills",
    ]);
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
    await checkboxByLabel(wrapper, "Hide unfiltered items").setValue(true);
    await buttonByText(wrapper, "Loot Alerts").trigger("click");
    await wrapper.get('button[aria-label="Refresh Satanic Zone"]').trigger("click");
    await wrapper.get(".logs button").trigger("click");
    await wrapper.get('button[aria-label="Hide Live Log"]').trigger("click");

    expect(wrapper.emitted("update:showCaptureDetails")).toEqual([[true]]);
    expect(wrapper.emitted("update:expandedDropRarity")).toEqual([["Satanic"]]);
    expect(wrapper.emitted("update:hideUnfilteredItems")).toEqual([[true]]);
    expect(wrapper.emitted("addShoppingItem")).toHaveLength(1);
    expect(wrapper.emitted("openItemFilterGroup")).toEqual([["loot-alerts"]]);
    expect(wrapper.emitted("refreshSatanicZone")).toHaveLength(1);
    expect(wrapper.emitted("toggleLog")?.[0]).toEqual([state.logs[0]]);
    expect(wrapper.emitted("update:hiddenFixtures")?.[0]).toEqual([["live-log"]]);

    await wrapper.setProps({ hiddenFixtures: ["live-log"] });
    expect(wrapper.find("#live-log-card").exists()).toBe(false);
    expect(wrapper.get(".dashboard-hidden-count").text()).toBe("1");
    await checkboxByLabel(wrapper, "Live Log").setValue(true);
    expect(wrapper.emitted("update:hiddenFixtures")?.at(-1)).toEqual([[]]);
  });

  test("LiveView surfaces the Npcap setup checklist when first-run prerequisites are wrong", async () => {
    const state = companionState();
    const now = state.stats.lastEventAt ?? Date.now();
    state.satanicZone = {
      current: state.stats.satanicZone,
      phase: "current",
      source: "captured",
      lastAttemptAt: now - 1_000,
      lastSuccessAt: now,
      validUntil: now + 600_000,
      nextAllowedRefreshAt: null,
      errorCode: null,
      refreshEnabled: false,
      refreshAvailable: false,
      refreshExperimental: false,
    };
    state.health = {
      ...state.health,
      npcapService: "Stopped",
      adminOnly: true,
      winPcapCompatible: false,
    };
    const wrapper = mount(LiveView, {
      props: {
        state,
        now,
        captureStatusLabel: "Needs attention",
        liveRunGraphElapsedMs: 0,
        runPausedLabel: "Paused",
        runTileDisplays: [],
        liveRunGraphLanes: [],
        liveRunGraphCustomItems: [],
        liveRunGraphEnabledStandardMetrics: ["xp", "gold", "kills", "items"],
        liveRunItemNameOptions: [],
        zoneCountdown: "20m",
        zoneResetLabel: "12:30 PM",
        satanicZoneRefreshSubmitting: false,
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
        recentLogs: [],
        expandedLogIds: new Set<string>(),
        showCaptureDetails: false,
        expandedDropRarity: null,
        timelineType: "all",
        hideSocketables: false,
        hideKeys: false,
        hideMaterials: false,
        hideUnfilteredItems: false,
        shoppingDraftItem: "",
        logLimit: 20,
        hiddenFixtures: [],
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

function exactButtonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().trim() === text);
  if (!button) throw new Error(`Unable to find button with text: ${text}`);
  return button;
}

function checkboxByLabel(wrapper: ReturnType<typeof mount>, text: string) {
  const label = wrapper.findAll("label").find((candidate) => candidate.text().includes(text) && candidate.find("input").exists());
  if (!label) throw new Error(`Unable to find label containing text: ${text}`);
  return label.get("input");
}

function settingsModalProps() {
  return {
    themeOptions: THEME_OPTIONS,
    captureDiagnostics: {
      enhanced: { mode: "off" as const, timedUntil: null },
      deep: { mode: "off" as const, timedUntil: null },
    },
    diagnosticsNow: baseTime,
    supportDiagnostics: "Hero Siege Companion capture diagnostics",
    supportGeneratedFiles: [],
    supportLogFiles: [],
    supportLogsPath: "C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion\\logs",
    supportBundleBusy: false,
    whatsNew: WHATS_NEW_RELEASE,
    launchThroughSteam: true,
    gameExecutablePath: "",
    satanicZoneRefreshEnabled: false,
    themeId: "voidglass" as const,
    compactThemeId: "voidglass" as const,
    themeCustomMode: false,
    compactThemeCustomMode: false,
    compactThemeMatchesApp: true,
  };
}
