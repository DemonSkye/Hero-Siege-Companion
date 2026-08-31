import { beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_RUN_ARCHIVE_PREFERENCES } from "../../src/shared/initial-state";
import {
  createConfigurationExportPayload,
  createConfigurationImportPreview,
  createFactoryResetPreferences,
  defaultPreferences,
  importConfigurationPayload,
  loadPreferences,
  normalizePreferences,
  savePreferences,
  serializeDurablePreferences,
} from "../../src/renderer/src/lib/preferences";
import { DEFAULT_THEME_ACCENTS } from "../../src/renderer/src/lib/themes";
import { itemFilterGroup } from "./fixtures";

describe("full configuration backups", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  test("always exports one complete supported backup and excludes retired runtime controls", () => {
    const payload = createConfigurationExportPayload(
      {
        ...defaultPreferences,
        launchThroughSteam: false,
        gameExecutablePath: "C:/Games/Hero Siege/Hero_Siege.exe",
        hiddenDashboardPanels: ["live-log"],
        hideUnfilteredTimelineItems: true,
        postRunReport: {
          ...defaultPreferences.postRunReport,
          exactTrackedItems: ["Ruby Ore", "Heavy Gloves"],
        },
        itemResearchEntries: [{
          signature: "legacy-entry",
          label: "Legacy",
          rarity: "Unknown",
          repository: "unknown",
          type: 1,
          id: 1,
          weaponType: 0,
          dropQuality: 0,
          classification: "unknown-normal",
          count: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
          resolvedName: "",
          notes: "",
          ignored: false,
        }],
      },
    );

    expect(payload).toMatchObject({ kind: "backup", version: 2 });
    expect(payload.uiPreferences).toMatchObject({
      launchThroughSteam: false,
      hiddenDashboardPanels: ["live-log"],
      hideUnfilteredTimelineItems: true,
      postRunReport: expect.objectContaining({ exactTrackedItems: ["Ruby Ore", "Heavy Gloves"] }),
    });
    expect(payload.uiPreferences).not.toHaveProperty("itemResearchEntries");
    expect(payload).not.toHaveProperty("runArchivePreferences");
    expect(payload).not.toHaveProperty("capturePreferences");

    const restored = importConfigurationPayload(payload, normalizePreferences(defaultPreferences)).uiPreferences;
    expect(restored.postRunReport.exactTrackedItems).toEqual(["Ruby Ore", "Heavy Gloves"]);
  });

  test("previews old configurations and restores supported data without reviving retired switches", () => {
    const currentResearch = [{
      signature: "preserve-me",
      label: "Preserve Me",
      rarity: "Unknown",
      repository: "unknown",
      type: 1,
      id: 1,
      weaponType: 0,
      dropQuality: 0,
      classification: "unknown-normal" as const,
      count: 1,
      firstSeenAt: 1,
      lastSeenAt: 1,
      resolvedName: "",
      notes: "",
      ignored: false,
    }];
    const current = normalizePreferences({ ...defaultPreferences, itemResearchEntries: currentResearch });
    const legacy = {
      app: "hero-siege-companion",
      kind: "configuration",
      version: 1,
      uiPreferences: {
        schemaVersion: 1,
        launchThroughSteam: false,
        alwaysOnTop: true,
        showCaptureDetails: true,
        developerItemResearchEnabled: true,
        unknownItemAudioPrompt: true,
        itemResearchEntries: [{ ...currentResearch[0], signature: "discard-me" }],
        themeId: "voidglass",
        themeAccents: { ...DEFAULT_THEME_ACCENTS, voidglass: "#123456" },
        itemFilterGroups: [itemFilterGroup({ id: "imported", name: "Imported" })],
        customItemFilterSounds: [],
        compactRunTiles: defaultPreferences.compactRunTiles,
      },
      runArchivePreferences: { skipEmptyRuns: false, minDurationMinutes: 30 },
      capturePreferences: { captureWideLogging: true },
    };

    expect(createConfigurationImportPreview(legacy)).toMatchObject({
      sourceVersion: 1,
      filterGroups: 1,
      legacyFormat: true,
    });

    const restored = importConfigurationPayload(legacy, current).uiPreferences;
    expect(restored.launchThroughSteam).toBe(false);
    expect(restored.alwaysOnTop).toBe(false);
    expect(restored.showCaptureDetails).toBe(false);
    expect(restored.developerItemResearchEnabled).toBe(false);
    expect(restored.unknownItemAudioPrompt).toBe(false);
    expect(restored.itemResearchEntries).toEqual(current.itemResearchEntries);
    expect(restored.themeCustomMode).toBe(true);
  });

  test("replaces an at-cap sound catalog before normalizing backup filter references", () => {
    const currentSounds = Array.from({ length: 24 }, (_, index) => ({
      id: `custom-sound:current-${index}`,
      name: `Current ${index}`,
      fileName: `current-${index}.wav`,
      src: `file:///sounds/current-${index}.wav`,
    }));
    const current = normalizePreferences({
      ...defaultPreferences,
      customItemFilterSounds: currentSounds,
    });
    const restoredSound = {
      id: "custom-sound:restored-alert",
      name: "Restored Alert",
      fileName: "restored-alert.wav",
      src: "file:///managed/restored-alert.wav",
    };
    const backup = {
      app: "hero-siege-companion",
      kind: "backup",
      version: 2,
      uiPreferences: {
        schemaVersion: 2,
        customItemFilterSounds: [restoredSound],
        itemFilterGroups: [itemFilterGroup({
          id: "restored-filter",
          name: "Restored Filter",
          soundId: restoredSound.id,
          items: [],
        })],
      },
    };

    const restored = importConfigurationPayload(backup, current).uiPreferences;

    expect(restored.customItemFilterSounds).toEqual([restoredSound]);
    expect(restored.itemFilterGroups).toEqual([
      expect.objectContaining({ id: "restored-filter", soundId: restoredSound.id }),
    ]);
    expect(restored.customItemFilterSounds).not.toEqual(expect.arrayContaining(currentSounds));
  });

  test("accepts only the current backup identity plus the two documented legacy shapes", () => {
    const current = normalizePreferences(defaultPreferences);
    const currentBackup = {
      app: "hero-siege-companion",
      kind: "backup",
      version: 2,
      uiPreferences: { schemaVersion: 2, themeId: "cyberpunk" },
    };
    const legacyConfiguration = {
      app: "hero-siege-companion",
      kind: "configuration",
      version: 1,
      uiPreferences: { schemaVersion: 1, launchThroughSteam: false },
    };
    const bareLegacyPreferences = { launchThroughSteam: false, themeId: "demonsteel" };

    expect(createConfigurationImportPreview(currentBackup)).toMatchObject({ sourceVersion: 2, legacyFormat: false });
    expect(createConfigurationImportPreview(legacyConfiguration)).toMatchObject({ sourceVersion: 1, legacyFormat: true });
    expect(importConfigurationPayload(bareLegacyPreferences, current).uiPreferences).toMatchObject({
      launchThroughSteam: false,
      themeId: "demonsteel",
    });

    for (const unsupported of [
      { ...currentBackup, app: "another-app" },
      { ...currentBackup, kind: "theme" },
      { ...currentBackup, version: 3 },
      { ...currentBackup, version: "2" },
      { schemaVersion: 2, themeId: "cyberpunk" },
      { unrelated: true },
    ]) {
      expect(() => createConfigurationImportPreview(unsupported)).toThrow();
      expect(() => importConfigurationPayload(unsupported, current)).toThrow();
    }
  });

  test("treats missing preference schema markers as legacy theme migration input", () => {
    const migrated = normalizePreferences({
      themeId: "voidglass",
      compactThemeId: "demonsteel",
      themeAccents: { ...DEFAULT_THEME_ACCENTS, voidglass: "#123456", demonsteel: "#654321" },
    });

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.themeCustomMode).toBe(true);
    expect(migrated.compactThemeCustomMode).toBe(true);
    expect(migrated.compactThemeMatchesApp).toBe(false);
  });

  test("rewrites seeded v1 preferences to the canonical durable shape", () => {
    const legacyResearch = [{
      signature: "legacy-entry",
      label: "Legacy Entry",
      rarity: "Unknown",
      repository: "unknown",
      type: 1,
      id: 1,
      weaponType: 0,
      dropQuality: 0,
      classification: "unknown-normal",
      count: 1,
      firstSeenAt: 1,
      lastSeenAt: 1,
      resolvedName: "",
      notes: "",
      ignored: false,
    }];
    window.localStorage.setItem("hero-siege-companion:preferences:v1", JSON.stringify({
      schemaVersion: 1,
      logLimit: 500,
      timelineLimit: 250,
      showCaptureDetails: true,
      alwaysOnTop: true,
      lockCompactLocation: false,
      developerItemResearchEnabled: true,
      unknownItemAudioPrompt: true,
      launchThroughSteam: false,
      itemResearchEntries: legacyResearch,
    }));

    const migrated = loadPreferences();
    savePreferences(migrated);
    const saved = JSON.parse(window.localStorage.getItem("hero-siege-companion:preferences:v1") ?? "{}") as Record<string, unknown>;

    expect(saved).toMatchObject({ schemaVersion: 2, launchThroughSteam: false });
    expect(saved.itemResearchEntries).toHaveLength(1);
    for (const retiredKey of [
      "logLimit",
      "timelineLimit",
      "showCaptureDetails",
      "alwaysOnTop",
      "lockCompactLocation",
      "developerItemResearchEnabled",
      "unknownItemAudioPrompt",
    ]) {
      expect(saved).not.toHaveProperty(retiredKey);
    }

    const cleared = JSON.parse(serializeDurablePreferences({ ...migrated, itemResearchEntries: [] })) as Record<string, unknown>;
    expect(cleared).not.toHaveProperty("itemResearchEntries");
  });

  test("factory reset preserves costly filters and imported sounds unless filter deletion is explicit", () => {
    const authoredFilter = itemFilterGroup({ id: "authored", name: "Authored Filter" });
    const sound = { id: "custom-sound:alert", name: "Alert", fileName: "alert.wav", src: "file:///sounds/alert.wav" };
    const current = normalizePreferences({
      ...defaultPreferences,
      themeId: "cyberpunk",
      compactThemeMatchesApp: false,
      itemFilterGroups: [authoredFilter],
      customItemFilterSounds: [sound],
    });

    const preserved = createFactoryResetPreferences(current);
    expect(preserved.itemFilterGroups).toEqual([authoredFilter]);
    expect(preserved.customItemFilterSounds).toEqual([sound]);
    expect(preserved.themeId).toBe(defaultPreferences.themeId);
    expect(preserved.compactThemeMatchesApp).toBe(true);

    const deleted = createFactoryResetPreferences(current, { deleteItemFilters: true });
    expect(deleted.itemFilterGroups).toEqual(defaultPreferences.itemFilterGroups);
    expect(deleted.customItemFilterSounds).toEqual([sound]);
  });

  test("fixed run-saving defaults are non-configurable", () => {
    expect(DEFAULT_RUN_ARCHIVE_PREFERENCES).toEqual({ skipEmptyRuns: true, minDurationMinutes: 0 });
  });
});
