import { beforeEach, describe, expect, test } from "vitest";

import {
  LOG_LIMIT_OPTIONS,
  createConfigurationExportPayload,
  defaultPreferences,
  importConfigurationPayload,
  loadPreferences,
  normalizeRunDurationMinutes,
  normalizeShoppingList,
  savePreferences,
} from "../../src/renderer/src/lib/preferences";
import { defaultPostRunReportConfig } from "../../src/renderer/src/lib/report-config";

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

    expect(preferences.logLimit).toBe(defaultPreferences.logLimit);
    expect(preferences.timelineLimit).toBe(LOG_LIMIT_OPTIONS[2]);
    expect(preferences.timelineType).toBe(defaultPreferences.timelineType);
    expect(preferences.shoppingListItems).toEqual(["Copper Ore", "Ruby"]);
    expect(preferences.gameExecutablePath).toBe("");
    expect(preferences.launchThroughSteam).toBe(false);
    expect(preferences.itemFilterGroups[0]).toMatchObject({ id: "x", name: "Drops", soundId: "crystal-tink", volume: 100 });
    expect(preferences.itemFilterMuted).toBe(true);
    expect(preferences.postRunReport).toEqual({
      summaryMetrics: ["gold", "materials"],
      dropRarities: ["Satanic"],
      resourceDrawers: ["materials"],
      topDropLimit: 10,
      trackedItems: [],
      itemGroups: [
        {
          id: "legacy-focus-items",
          name: "Focus Items",
          enabled: true,
          items: ["Sash of the Magi"],
        },
      ],
    });
    expect(preferences.developerItemResearchEnabled).toBe(true);
    expect(preferences.unknownItemAudioPrompt).toBe(true);
    expect(preferences.itemResearchEntries[0]).toMatchObject({ signature: "4:55:0:gloves #55", label: "Gloves #55", count: 2 });
  });

  test("saves preferences without throwing and keeps shopping list helpers bounded", () => {
    savePreferences({ ...defaultPreferences, logLimit: 50, shoppingListItems: ["Jade"], postRunReport: defaultPostRunReportConfig });

    expect(loadPreferences().logLimit).toBe(50);
    expect(loadPreferences().shoppingListItems).toEqual(["Jade"]);
    expect(normalizeShoppingList(["Ruby", "Ruby", "", "Jade"])).toEqual(["Ruby", "Jade"]);
    expect(normalizeRunDurationMinutes(-5)).toBe(0);
    expect(normalizeRunDurationMinutes(1445.8)).toBe(1440);
  });

  test("exports and imports configuration sections according to checkbox scope", () => {
    const current = {
      ...defaultPreferences,
      logLimit: 50,
      itemFilterMuted: true,
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
      itemFilterMuted: false,
      postRunReport: { ...defaultPostRunReportConfig, topDropLimit: 5 },
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
        includeItemResearch: false,
      },
    );

    expect(payload.uiPreferences.itemFilterMuted).toBeUndefined();
    expect(payload.uiPreferences.itemResearchEntries).toBeUndefined();
    expect(payload.uiPreferences.postRunReport).toMatchObject({ topDropLimit: 5 });

    const result = importConfigurationPayload(payload, current, {
      includeAppSettings: true,
      includeRunSaving: true,
      includeReportTracking: false,
      includeLootFilters: false,
      includeItemResearch: false,
    });

    expect(result.uiPreferences.logLimit).toBe(100);
    expect(result.uiPreferences.itemFilterMuted).toBe(true);
    expect(result.uiPreferences.postRunReport.topDropLimit).toBe(3);
    expect(result.uiPreferences.itemResearchEntries).toHaveLength(1);
    expect(result.runArchivePreferences).toEqual({ skipEmptyRuns: true, minDurationMinutes: 12 });
    expect(result.capturePreferences).toEqual({ createDebugMode: true });
  });
});
