import { beforeEach, describe, expect, test } from "vitest";

import {
  createItemResearchExportPayload,
  isItemResearchCandidate,
  itemResearchSignature,
  normalizeResearchItemName,
  upsertItemResearchEntry,
  type ItemResearchEntry,
} from "../../src/renderer/src/lib/item-research";
import {
  LOG_LIMIT_OPTIONS,
  UI_PREFERENCES_SCHEMA_VERSION,
  createConfigurationExportPayload,
  defaultPreferences,
  importConfigurationPayload,
  loadPreferences,
  normalizeRunDurationMinutes,
  normalizeShoppingList,
  savePreferences,
} from "../../src/renderer/src/lib/preferences";
import { defaultPostRunReportConfig } from "../../src/renderer/src/lib/report-config";
import { DEFAULT_THEME_ACCENTS, createThemeExportPayload, importThemePayload } from "../../src/renderer/src/lib/themes";
import { itemTimelineEntry } from "./fixtures";

describe("renderer preferences persistence", () => {
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

  test("loads defaults when local storage is missing or corrupt", () => {
    expect(loadPreferences()).toMatchObject(defaultPreferences);
    expect(loadPreferences().schemaVersion).toBe(UI_PREFERENCES_SCHEMA_VERSION);

    window.localStorage.setItem("hero-siege-companion:preferences:v1", "{not-json");
    expect(loadPreferences()).toMatchObject(defaultPreferences);
  });

  test("normalizes old or hostile preference values before the UI consumes them", () => {
    window.localStorage.setItem(
      "hero-siege-companion:preferences:v1",
      JSON.stringify({
        logLimit: 12345,
        timelineLimit: LOG_LIMIT_OPTIONS[2],
        showCaptureDetails: 1,
        alwaysOnTop: "",
        lockCompactLocation: true,
        hideSocketables: true,
        hideKeys: false,
        hideMaterials: true,
        timelineType: "999",
        shoppingListItems: ["Copper Ore", "Copper Ore", "", "Ruby"],
        gameExecutablePath: 42,
        launchThroughSteam: false,
        themeId: "lost",
        compactThemeId: "cyberpunk",
        themeAccents: { dark: "#bad", cyberpunk: "#FF3151", light: "#ffffff" },
        themeTokenMaps: {
          cyberpunk: {
            border: "rgba(0, 240, 255, 0.48)",
            buttonPrimary: "#FFF200",
            satanic: "#ffffff",
            broken: "url(javascript:bad)",
          },
        },
        customItemFilterSounds: [{ id: "custom-sound:boss", name: "Boss Drop", fileName: "boss.wav", src: "file:///sounds/boss.wav" }],
        itemFilterGroups: [{ id: "x", name: "Drops", soundId: "missing", volume: 500 }],
        itemFilterMuted: 1,
        postRunReport: {
          summaryMetrics: ["gold", "materials", "bad"],
          dropRarities: ["Satanic", "Nope"],
          resourceDrawers: ["materials"],
          topDropLimit: 10,
          trackedItems: ["Sash of the Magi", "Sash of the Magi", ""],
        },
        developerItemResearchEnabled: 1,
        unknownItemAudioPrompt: 1,
        itemResearchEntries: [
          {
            signature: "4:55:0:gloves #55",
            label: "Gloves #55",
            rarity: "Satanic",
            type: 4,
            id: 55,
            count: 2,
          },
        ],
      }),
    );

    const preferences = loadPreferences();

    expect(preferences.schemaVersion).toBe(UI_PREFERENCES_SCHEMA_VERSION);
    expect(preferences.logLimit).toBe(defaultPreferences.logLimit);
    expect(preferences.timelineLimit).toBe(LOG_LIMIT_OPTIONS[2]);
    expect(preferences.timelineType).toBe(defaultPreferences.timelineType);
    expect(preferences.shoppingListItems).toEqual(["Copper Ore", "Ruby"]);
    expect(preferences.gameExecutablePath).toBe("");
    expect(preferences.launchThroughSteam).toBe(false);
    expect(preferences.themeId).toBe(defaultPreferences.themeId);
    expect(preferences.compactThemeId).toBe("cyberpunk");
    expect(preferences.themeAccents).toEqual({ ...DEFAULT_THEME_ACCENTS, cyberpunk: "#ff3151", light: "#ffffff" });
    expect(preferences.themeTokenMaps).toEqual({ cyberpunk: { border: "rgba(0, 240, 255, 0.48)", buttonPrimary: "#fff200" } });
    expect(preferences.customItemFilterSounds).toHaveLength(1);
    expect(preferences.itemFilterGroups[0]).toMatchObject({ id: "x", name: "Drops", soundId: "crystal-tink", volume: 100 });
    expect(preferences.itemFilterMuted).toBe(true);
    expect(preferences.postRunReport).toEqual({
      summaryMetrics: ["gold", "materials"],
      dropRarities: ["Satanic"],
      resourceDrawers: ["materials"],
      topDropLimit: 10,
      trackedItems: [],
      itemFilterGroupIds: [],
      itemGroups: [
        {
          id: "legacy-focus-items",
          name: "Focus Items",
          enabled: true,
          rarities: [],
          types: [],
          items: ["Sash of the Magi"],
        },
      ],
    });
    expect(preferences.developerItemResearchEnabled).toBe(true);
    expect(preferences.unknownItemAudioPrompt).toBe(true);
    expect(preferences.itemResearchEntries[0]).toMatchObject({ signature: "4:55:0:gloves #55", label: "Gloves #55", count: 2 });
  });

  test("saves preferences without throwing and keeps shopping list helpers bounded", () => {
    savePreferences({
      ...defaultPreferences,
      logLimit: 50,
      timelineType: "item-filter:boss-drops",
      shoppingListItems: ["Jade"],
      postRunReport: defaultPostRunReportConfig,
    });

    expect(loadPreferences().logLimit).toBe(50);
    expect(loadPreferences().schemaVersion).toBe(UI_PREFERENCES_SCHEMA_VERSION);
    expect(loadPreferences().timelineType).toBe("item-filter:boss-drops");
    expect(loadPreferences().shoppingListItems).toEqual(["Jade"]);
    expect(normalizeShoppingList(["Ruby", "Ruby", "", "Jade"])).toEqual(["Ruby", "Jade"]);
    expect(normalizeRunDurationMinutes(-5)).toBe(0);
    expect(normalizeRunDurationMinutes(1445.8)).toBe(1440);
  });

  test("treats generic item labels as research candidates and exports shareable research JSON", () => {
    const genericCollectible = itemTimelineEntry({ label: "Collectible #24", rarity: "Superior", type: 13, id: 24, fingerprint: "collectible-24" });
    const genericWeapon = itemTimelineEntry({ label: "Chainsaw #10 - mfDrop=1 - Weapon - 10-3909410-65295343278200001-3", rarity: "Superior", type: 3, id: 10, fingerprint: "chainsaw-10" });
    const knownCollectible = itemTimelineEntry({ label: "Ruby", rarity: "Superior", type: 13, id: 19, localizationId: "ruby" });

    expect(isItemResearchCandidate(genericCollectible)).toBe(true);
    expect(isItemResearchCandidate(genericWeapon)).toBe(true);
    expect(isItemResearchCandidate(knownCollectible)).toBe(false);

    const signature = itemResearchSignature(genericCollectible);
    const entries = upsertItemResearchEntry([], genericCollectible).map((entry): ItemResearchEntry =>
      entry.signature === signature ? { ...entry, resolvedName: "Damien's Eye", notes: "Confirmed from in-game drop." } : entry,
    );
    const payload = createItemResearchExportPayload(entries);

    expect(payload.kind).toBe("item-research");
    expect(payload.summary).toMatchObject({ total: 1, resolved: 1, unresolved: 0 });
    expect(payload.entries[0]).toMatchObject({
      signature,
      label: "Collectible #24",
      resolvedName: "Damien's Eye",
      resolvedNameKey: "damiens eye",
      type: 13,
      id: 24,
    });
    expect(payload.shareHint).toContain("gist");
  });

  test("normalizes item research names for uncertain casing before export", () => {
    const genericCollectible = itemTimelineEntry({ label: "Collectible #24", rarity: "Superior", type: 13, id: 24, fingerprint: "collectible-24" });
    const signature = itemResearchSignature(genericCollectible);

    expect(normalizeResearchItemName("THE WHEEL OF FORTUNE")).toBe("The Wheel of Fortune");
    expect(normalizeResearchItemName("KING'S GARDEN IV")).toBe("King's Garden IV");

    const entries = upsertItemResearchEntry([], genericCollectible).map((entry): ItemResearchEntry =>
      entry.signature === signature ? { ...entry, resolvedName: "THE WHEEL OF FORTUNE" } : entry,
    );
    const payload = createItemResearchExportPayload(entries);

    expect(payload.entries[0]).toMatchObject({
      resolvedName: "The Wheel of Fortune",
      resolvedNameKey: "the wheel of fortune",
    });
  });

  test("exports and imports shareable theme JSON", () => {
    const accents = { ...DEFAULT_THEME_ACCENTS, cyberpunk: "#00f0ff" };
    const payload = createThemeExportPayload("cyberpunk", accents, { cyberpunk: { border: "rgba(0, 240, 255, 0.48)" } });
    const imported = importThemePayload(JSON.stringify(payload), "dark", DEFAULT_THEME_ACCENTS);

    expect(payload).toMatchObject({ kind: "theme", themeId: "cyberpunk", accent: "#00f0ff", tokens: { border: "rgba(0, 240, 255, 0.48)" } });
    expect(imported.themeId).toBe("cyberpunk");
    expect(imported.themeAccents.cyberpunk).toBe("#00f0ff");
    expect(imported.themeTokenMaps.cyberpunk).toEqual({ border: "rgba(0, 240, 255, 0.48)" });
  });

  test("exports and imports configuration sections according to checkbox scope", () => {
    const current = {
      ...defaultPreferences,
      logLimit: 50,
      customItemFilterSounds: [{ id: "custom-sound:alert", name: "Alert", fileName: "alert.wav", src: "file:///sounds/alert.wav" }],
      itemFilterMuted: true,
      itemFilterGroups: [{ id: "x", name: "Drops", enabled: true, soundId: "custom-sound:alert", volume: 70, cooldownMs: 1000, rarities: [], types: [], items: [] }],
      postRunReport: { ...defaultPostRunReportConfig, topDropLimit: 3 },
      itemResearchEntries: [
        {
          signature: "4:55:0:gloves #55",
          label: "Gloves #55",
          rarity: "Satanic",
          type: 4,
          id: 55,
          dropQuality: 0,
          count: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
          resolvedName: "",
          notes: "",
          ignored: false,
        },
      ],
    };
    const imported = {
      ...defaultPreferences,
      logLimit: 100,
      themeId: "cyberpunk",
      compactThemeId: "light",
      themeAccents: { ...DEFAULT_THEME_ACCENTS, cyberpunk: "#ff3151" },
      themeTokenMaps: { cyberpunk: { border: "rgba(0, 240, 255, 0.48)" } },
      itemFilterMuted: false,
      customItemFilterSounds: [{ id: "custom-sound:boss", name: "Boss Drop", fileName: "boss.wav", src: "file:///sounds/boss.wav" }],
      itemFilterGroups: [{ id: "boss", name: "Boss", enabled: true, soundId: "custom-sound:boss", volume: 70, cooldownMs: 1000, rarities: ["Heroic"], types: [], items: [] }],
      postRunReport: {
        ...defaultPostRunReportConfig,
        topDropLimit: 5,
        itemGroups: [
          {
            id: "bosses",
            name: "Bosses",
            enabled: true,
            rarities: ["Satanic"],
            types: [7],
            items: ["Battle Worn Gauntlets"],
          },
          {
            id: "disabled",
            name: "Disabled",
            enabled: false,
            rarities: ["Heroic"],
            types: [],
            items: ["Ignored Heroic"],
          },
        ],
        itemFilterGroupIds: ["boss"],
      },
      itemResearchEntries: [],
    };

    const payload = createConfigurationExportPayload(
      imported,
      { skipEmptyRuns: true, minDurationMinutes: 12 },
      { createDebugMode: true },
      {
        includeAppSettings: true,
        includeRunSaving: true,
        includeReportTracking: true,
        includeLootFilters: false,
        includeSounds: true,
        includeItemResearch: false,
      },
    );

    expect(payload.uiPreferences.itemFilterMuted).toBeUndefined();
    expect(payload.uiPreferences.customItemFilterSounds).toEqual([{ id: "custom-sound:boss", name: "Boss Drop", fileName: "boss.wav", src: "file:///sounds/boss.wav" }]);
    expect(payload.uiPreferences.schemaVersion).toBe(UI_PREFERENCES_SCHEMA_VERSION);
    expect(payload.uiPreferences.itemResearchEntries).toBeUndefined();
    expect(payload.uiPreferences.themeId).toBe("cyberpunk");
    expect(payload.uiPreferences.compactThemeId).toBe("light");
    expect(payload.uiPreferences.themeAccents?.cyberpunk).toBe("#ff3151");
    expect(payload.uiPreferences.themeTokenMaps?.cyberpunk).toEqual({ border: "rgba(0, 240, 255, 0.48)" });
    expect(payload.uiPreferences.postRunReport).toMatchObject({ topDropLimit: 5 });
    expect(payload.uiPreferences.postRunReport?.itemGroups).toEqual([
      {
        id: "bosses",
        name: "Bosses",
        enabled: true,
        rarities: ["Satanic"],
        types: [7],
        items: ["Battle Worn Gauntlets"],
      },
      {
        id: "disabled",
        name: "Disabled",
        enabled: false,
        rarities: ["Heroic"],
        types: [],
        items: ["Ignored Heroic"],
      },
    ]);
    expect(payload.uiPreferences.postRunReport?.itemFilterGroupIds).toEqual(["boss"]);

    const reportExcludedPayload = createConfigurationExportPayload(
      imported,
      { skipEmptyRuns: true, minDurationMinutes: 12 },
      { createDebugMode: true },
      {
        includeAppSettings: true,
        includeRunSaving: true,
        includeReportTracking: false,
        includeLootFilters: false,
        includeSounds: false,
        includeItemResearch: false,
      },
    );
    expect(reportExcludedPayload.uiPreferences.postRunReport).toBeUndefined();
    expect(reportExcludedPayload.uiPreferences.customItemFilterSounds).toBeUndefined();

    const result = importConfigurationPayload(payload, current, {
      includeAppSettings: true,
      includeRunSaving: true,
      includeReportTracking: false,
      includeLootFilters: false,
      includeSounds: true,
      includeItemResearch: false,
    });

    expect(result.uiPreferences.logLimit).toBe(100);
    expect(result.uiPreferences.itemFilterMuted).toBe(true);
    expect(result.uiPreferences.customItemFilterSounds.map((sound) => sound.id)).toEqual(["custom-sound:alert", "custom-sound:boss"]);
    expect(result.uiPreferences.postRunReport.topDropLimit).toBe(3);
    expect(result.uiPreferences.itemResearchEntries).toHaveLength(1);
    expect(result.runArchivePreferences).toEqual({ skipEmptyRuns: true, minDurationMinutes: 12 });
    expect(result.capturePreferences).toEqual({ createDebugMode: true });
  });
});
