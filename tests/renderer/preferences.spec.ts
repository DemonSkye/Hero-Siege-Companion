import { beforeEach, describe, expect, test } from "vitest";

import { useAppPreferences } from "../../src/renderer/src/lib/app-preferences";
import {
  ACTIVE_ITEM_CATALOG_BUILD,
  createItemCatalogResolver,
  type ItemCatalogArtifact,
} from "../../src/shared/item-catalog";
import {
  activeItemResearchEntries,
  classifyItemResearchFields,
  createItemResearchExportPayload,
  isGeneratedNormalItemResearchEntry,
  isItemResearchCandidate,
  isKnownItemResearchName,
  itemResearchSignature,
  normalizeItemResearchEntries,
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
  normalizeShoppingList,
  savePreferences,
} from "../../src/renderer/src/lib/preferences";
import { defaultPostRunReportConfig, withPostRunReportSummaryItems, withoutPostRunReportItemFilterGroup } from "../../src/renderer/src/lib/report-config";
import {
  DEFAULT_THEME_ACCENTS,
  DEFAULT_THEME_FOREGROUND_FILLS,
  DEFAULT_THEME_TEXTURES,
  THEME_BACKGROUND_TEXTURE_OPTIONS,
  THEME_OPTIONS,
  createThemeExportPayload,
  createThemeTemplatePayload,
  effectiveThemeForegroundFill,
  effectiveThemeTexture,
  importThemePayload,
  normalizeThemeForegroundFill,
  normalizeThemeId,
} from "../../src/renderer/src/lib/themes";
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
    expect(defaultPreferences).toMatchObject({
      alwaysOnTop: false,
      lockCompactLocation: true,
      hideSocketables: true,
      hideKeys: true,
      hideMaterials: true,
      themeId: "voidglass",
      compactThemeId: "voidglass",
      compactThemeMatchesApp: true,
      themeTextures: {},
      compactThemeTextures: {},
      themeForegroundFills: {},
      postRunReport: defaultPostRunReportConfig,
    });

    window.localStorage.setItem("hero-siege-companion:preferences:v1", "{not-json");
    expect(loadPreferences()).toMatchObject(defaultPreferences);
  });

  test("watches persisted current-setting refs for automatic saves", () => {
    const preferences = useAppPreferences();
    const persistedPreferenceRefs = {
      hideSocketables: preferences.hideSocketables,
      hideKeys: preferences.hideKeys,
      hideMaterials: preferences.hideMaterials,
      hideUnfilteredTimelineItems: preferences.hideUnfilteredTimelineItems,
      timelineType: preferences.timelineType,
      gameExecutablePath: preferences.gameExecutablePath,
      launchThroughSteam: preferences.launchThroughSteam,
      themeId: preferences.themeId,
      compactThemeId: preferences.compactThemeId,
      themeCustomMode: preferences.themeCustomMode,
      compactThemeCustomMode: preferences.compactThemeCustomMode,
      compactThemeMatchesApp: preferences.compactThemeMatchesApp,
      themeAccents: preferences.themeAccents,
      themeTextures: preferences.themeTextures,
      compactThemeTextures: preferences.compactThemeTextures,
      themeForegroundFills: preferences.themeForegroundFills,
      compactThemeForegroundFills: preferences.compactThemeForegroundFills,
      themeTokenMaps: preferences.themeTokenMaps,
      itemFilterGroups: preferences.itemFilterGroups,
      itemFilterMuted: preferences.itemFilterMuted,
      customItemFilterSounds: preferences.customItemFilterSounds,
      postRunReport: preferences.postRunReport,
      compactRunTiles: preferences.compactRunTiles,
      hiddenDashboardPanels: preferences.hiddenDashboardPanels,
      itemResearchEntries: preferences.itemResearchEntries,
    };
    const watchedRefs = new Set(preferences.preferenceWatchSources);

    expect(preferences.preferenceWatchSources).not.toContain(preferences.logLimit);
    expect(preferences.preferenceWatchSources).not.toContain(preferences.showCaptureDetails);
    expect(preferences.preferenceWatchSources).toContain(preferences.gameExecutablePath);
    expect(preferences.preferenceWatchSources).toContain(preferences.launchThroughSteam);
    expect(watchedRefs.size).toBe(preferences.preferenceWatchSources.length);
    expect(preferences.preferenceWatchSources).toHaveLength(Object.values(persistedPreferenceRefs).length);
    for (const ref of Object.values(persistedPreferenceRefs)) expect(watchedRefs.has(ref)).toBe(true);
  });

  test("keeps SZ Refresh and retired main controls out of portable backups", () => {
    const payload = createConfigurationExportPayload(defaultPreferences);
    expect(payload).not.toHaveProperty("satanicZoneRefreshPreferences");
    expect(payload).not.toHaveProperty("runArchivePreferences");
    expect(payload).not.toHaveProperty("capturePreferences");
    expect(payload.uiPreferences).not.toHaveProperty("satanicZoneRefreshEnabled");
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
        themeTextures: { dark: "lost-texture", cyberpunk: "neon-grid", light: "brushed-metal" },
        compactThemeTextures: { cyberpunk: "carbon-fiber", demonsteel: "brimstone", light: "url(javascript:bad)" },
        themeForegroundFills: { cyberpunk: 20, light: "88", dark: "nope" },
        compactThemeForegroundFills: { demonsteel: 101, cyberpunk: 66 },
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
    expect(preferences.timelineLimit).toBe(defaultPreferences.timelineLimit);
    expect(preferences.timelineType).toBe(defaultPreferences.timelineType);
    expect(preferences.shoppingListItems).toEqual(["Copper Ore", "Ruby"]);
    expect(preferences.gameExecutablePath).toBe("");
    expect(preferences.launchThroughSteam).toBe(false);
    expect(preferences.themeId).toBe(defaultPreferences.themeId);
    expect(preferences.compactThemeId).toBe("cyberpunk");
    expect(preferences.themeCustomMode).toBe(false);
    expect(preferences.compactThemeCustomMode).toBe(true);
    expect(preferences.compactThemeMatchesApp).toBe(false);
    expect(preferences.themeAccents).toEqual({ ...DEFAULT_THEME_ACCENTS, cyberpunk: "#ff3151", light: "#ffffff" });
    expect(preferences.themeTextures).toEqual({ cyberpunk: "neon-grid", light: "brushed-metal" });
    expect(preferences.compactThemeTextures).toEqual({ demonsteel: "brimstone", cyberpunk: "carbon-fiber" });
    expect(preferences.themeForegroundFills).toEqual({ cyberpunk: 25, light: 88 });
    expect(preferences.compactThemeForegroundFills).toEqual({ demonsteel: 100, cyberpunk: 66 });
    expect(preferences.themeTokenMaps).toEqual({ cyberpunk: { border: "rgba(0, 240, 255, 0.48)", buttonPrimary: "#fff200" } });
    expect(preferences.customItemFilterSounds).toHaveLength(1);
    expect(preferences.itemFilterGroups[0]).toMatchObject({ id: "x", name: "Drops", soundId: "crystal-tink", volume: 100 });
    expect(preferences.itemFilterMuted).toBe(true);
    expect(preferences.postRunReport).toEqual({
      summaryItems: ["metric:gold", "metric:materials", "rarity:Satanic", "group:legacy-focus-items"],
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
    expect(preferences.developerItemResearchEnabled).toBe(false);
    expect(preferences.unknownItemAudioPrompt).toBe(false);
    expect(preferences.itemResearchEntries[0]).toMatchObject({
      signature: "unknown:4:55:0:0:gloves #55",
      label: "Gloves #55",
      classification: "unknown-normal",
      count: 2,
    });
  });

  test("preserves empty Past Runs report sections", () => {
    savePreferences({
      ...defaultPreferences,
      postRunReport: {
        ...defaultPostRunReportConfig,
        summaryItems: [],
        summaryMetrics: [],
        dropRarities: [],
        resourceDrawers: [],
      },
    });

    expect(loadPreferences().postRunReport).toMatchObject({
      summaryItems: [],
      summaryMetrics: [],
      dropRarities: [],
      resourceDrawers: [],
    });
  });

  test("keeps legacy custom report groups selected when the summary row is full", () => {
    window.localStorage.setItem(
      "hero-siege-companion:preferences:v1",
      JSON.stringify({
        postRunReport: {
          summaryMetrics: ["gold", "xp", "kills", "keys", "ores", "materials", "mfDrops"],
          dropRarities: ["Set", "Satanic", "Heroic", "Angelic"],
          trackedItems: ["Gaze of the Void"],
          itemFilterGroupIds: ["merc-items"],
        },
      }),
    );

    const report = loadPreferences().postRunReport;

    expect(report.summaryItems).toEqual([
      "metric:gold",
      "metric:xp",
      "metric:kills",
      "metric:keys",
      "metric:ores",
      "metric:materials",
      "group:legacy-focus-items",
      "filter:merc-items",
    ]);
    expect(report.itemGroups[0]).toMatchObject({
      id: "legacy-focus-items",
      items: ["Gaze of the Void"],
    });
    expect(report.itemFilterGroupIds).toEqual(["merc-items"]);
  });

  test("preserves legacy default report rarity and resource selections", () => {
    window.localStorage.setItem(
      "hero-siege-companion:preferences:v1",
      JSON.stringify({
        postRunReport: {
          summaryMetrics: ["gold", "xp", "kills", "keys", "ores", "materials", "mfDrops"],
          dropRarities: ["Set", "Satanic", "Heroic", "Angelic"],
          resourceDrawers: ["materials", "keys", "ores"],
          topDropLimit: 8,
        },
      }),
    );

    const report = loadPreferences().postRunReport;

    expect(report.summaryItems).toEqual([
      "metric:gold",
      "metric:xp",
      "metric:kills",
      "metric:keys",
      "metric:ores",
      "metric:materials",
      "metric:mfDrops",
      "rarity:Satanic",
    ]);
    expect(report.summaryItems).not.toContain("rarity:Set");
    expect(report.dropRarities).toEqual(["Set", "Satanic", "Heroic", "Angelic"]);
    expect(report.resourceDrawers).toEqual(["materials", "keys", "ores"]);
  });

  test("keeps legacy resource drawers that were not summary metrics", () => {
    window.localStorage.setItem(
      "hero-siege-companion:preferences:v1",
      JSON.stringify({
        postRunReport: {
          summaryMetrics: ["gold"],
          dropRarities: ["Satanic"],
          resourceDrawers: ["materials"],
        },
      }),
    );

    const report = loadPreferences().postRunReport;

    expect(report.summaryItems).toEqual(["metric:gold", "metric:materials", "rarity:Satanic"]);
    expect(report.summaryMetrics).toEqual(["gold"]);
    expect(report.resourceDrawers).toEqual(["materials"]);
  });

  test("removes deleted Item Filter groups from report summary references", () => {
    const report = withPostRunReportSummaryItems(
      {
        ...defaultPostRunReportConfig,
        itemFilterGroupIds: ["deleted-filter"],
      },
      ["metric:gold", "filter:deleted-filter", "rarity:Satanic"],
    );

    expect(withoutPostRunReportItemFilterGroup(report, "deleted-filter")).toMatchObject({
      summaryItems: ["metric:gold", "rarity:Satanic"],
      itemFilterGroupIds: [],
    });
  });

  test("saves preferences without throwing and keeps shopping list helpers bounded", () => {
    savePreferences({
      ...defaultPreferences,
      logLimit: 50,
      timelineType: "item-filter:boss-drops",
      shoppingListItems: ["Jade"],
      postRunReport: defaultPostRunReportConfig,
    });

    expect(loadPreferences().logLimit).toBe(defaultPreferences.logLimit);
    expect(loadPreferences().schemaVersion).toBe(UI_PREFERENCES_SCHEMA_VERSION);
    expect(loadPreferences().timelineType).toBe("item-filter:boss-drops");
    expect(loadPreferences().shoppingListItems).toEqual(["Jade"]);
    expect(normalizeShoppingList(["Ruby", "Ruby", "", "Jade"])).toEqual(["Ruby", "Jade"]);
  });

  test("persists an intentionally empty Filter Stack without restoring the sample group", () => {
    expect(savePreferences({ ...defaultPreferences, itemFilterGroups: [] })).toBe(true);

    expect(loadPreferences().itemFilterGroups).toEqual([]);
  });

  test("treats generic item labels as research candidates and exports shareable research JSON", () => {
    const catalog = itemResearchCatalogFixture();
    const genericCollectible = itemTimelineEntry({ label: "Collectible #24", rarity: "Superior", repository: "normal", type: 13, id: 24, fingerprint: "collectible-24" });
    const genericWeapon = itemTimelineEntry({ label: "Chainsaw #35 - mfDrop=1 - Weapon - 10-3909410-65295343278200001-3", rarity: "Superior", type: 3, id: 35, weaponType: 7, fingerprint: "chainsaw-35" });
    const generatedPlaceholder = itemTimelineEntry({ label: "Weapon - Seed 123456", rarity: "Unknown", type: 3, id: 0, fingerprint: "generated-0" });
    const generatedKnownMissingIcon = itemTimelineEntry({ label: "Weapon - Seed 123456", rarity: "Unknown", type: 1, id: 100, fingerprint: "generated-known-100" });
    const stackItem = itemTimelineEntry({ label: "Key #77", rarity: "Superior", repository: "normal", type: 12, id: 77, fingerprint: "key-77" });
    const knownMissingIcon = itemTimelineEntry({ label: "Sharpshooter's Cloak", rarity: "Satanic", type: 1, id: 100, localizationId: "armors_sharpshooters_cloak", fingerprint: "cloak-100" });
    const knownCollectible = itemTimelineEntry({ label: "Ruby", rarity: "Superior", repository: "normal", type: 13, id: 19, localizationId: "ruby" });
    const genericRelic = itemTimelineEntry({ label: "Relic #155", rarity: "Unknown", type: 16, id: 155, fingerprint: "relic-155" });
    const generatedNormalCharm = itemTimelineEntry({ label: "Charm #33", rarity: "Unknown", repository: "normal", type: 10, id: 33, fingerprint: "generated-charm-33" });
    const legacyGeneratedCharm = itemTimelineEntry({ label: "Charm #33", rarity: "Unknown", repository: "unknown", type: 10, id: 33, fingerprint: "legacy-generated-charm-33" });
    const fixedCharmCollision = itemTimelineEntry({ label: "Charm #33", rarity: "Unknown", repository: "unique", type: 10, id: 33, fingerprint: "fixed-charm-33" });
    const zeroHelmet = itemTimelineEntry({ label: "Helmet #0", rarity: "Unknown", repository: "normal", type: 0, id: 0 });
    const unknownType = itemTimelineEntry({ label: "Type 17 #999", rarity: "Unknown", repository: "unique", type: 17, id: 999 });
    const unknownWeaponSubtype = itemTimelineEntry({ label: "Weapon Type 99 #0", rarity: "Unknown", repository: "unique", type: 3, id: 0, weaponType: 99 });
    const unknownRuneword = itemTimelineEntry({ label: "Gloves #96", rarity: "Unknown", repository: "runeword", type: 4, id: 96 });

    expect(isItemResearchCandidate(genericCollectible, catalog)).toBe(true);
    expect(isItemResearchCandidate(genericWeapon, catalog)).toBe(true);
    expect(isItemResearchCandidate(generatedPlaceholder, catalog)).toBe(true);
    expect(isItemResearchCandidate(stackItem, catalog)).toBe(true);
    expect(isItemResearchCandidate(knownMissingIcon, catalog)).toBe(false);
    expect(isItemResearchCandidate(knownCollectible, catalog)).toBe(false);
    expect(isItemResearchCandidate(genericRelic, catalog)).toBe(true);
    expect(isItemResearchCandidate(generatedNormalCharm, catalog)).toBe(false);
    // Live rows without repository evidence stay fail-closed and researchable.
    expect(isItemResearchCandidate(legacyGeneratedCharm, catalog)).toBe(true);
    expect(isItemResearchCandidate(fixedCharmCollision, catalog)).toBe(true);
    expect(isItemResearchCandidate(zeroHelmet, catalog)).toBe(false);
    expect(isItemResearchCandidate(unknownType, catalog)).toBe(true);
    expect(isItemResearchCandidate(unknownWeaponSubtype, catalog)).toBe(true);
    expect(isItemResearchCandidate(unknownRuneword, catalog)).toBe(true);
    expect(classifyItemResearchFields(genericCollectible)).toBe("material-collectible");
    expect(classifyItemResearchFields(genericWeapon)).toBe("unknown-normal");
    expect(classifyItemResearchFields(generatedPlaceholder)).toBe("generated-placeholder");
    expect(classifyItemResearchFields(generatedKnownMissingIcon)).toBe("generated-placeholder");
    expect(classifyItemResearchFields(stackItem)).toBe("stack-item");
    expect(classifyItemResearchFields(knownMissingIcon)).toBe("known-missing-icon");
    expect(activeItemResearchEntries(upsertItemResearchEntry([], genericWeapon), catalog)).toHaveLength(1);
    expect(activeItemResearchEntries(upsertItemResearchEntry([], knownMissingIcon), catalog)).toHaveLength(0);
    expect(activeItemResearchEntries(upsertItemResearchEntry([], generatedNormalCharm), catalog)).toHaveLength(0);
    expect(activeItemResearchEntries(upsertItemResearchEntry([], legacyGeneratedCharm), catalog)).toHaveLength(0);

    const legacyGeneratedHelmet = normalizeItemResearchEntries([{
      signature: "0:999:0:helmet #999",
      label: "Helmet #999",
      type: 0,
      id: 999,
      dropQuality: 0,
    }])[0];
    expect(legacyGeneratedHelmet).toMatchObject({ repository: "unknown", classification: "unknown-normal" });
    expect(isGeneratedNormalItemResearchEntry(legacyGeneratedHelmet, catalog)).toBe(true);
    expect(activeItemResearchEntries([legacyGeneratedHelmet], catalog)).toHaveLength(0);
    expect(isGeneratedNormalItemResearchEntry({
      repository: "normal",
      type: 4,
      id: 50,
      weaponType: 0,
      classification: "known-missing-icon",
    }, catalog)).toBe(false);

    for (const id of [33, 34, 35, 999]) {
      expect(isItemResearchCandidate(itemTimelineEntry({
        label: `Charm #${id}`,
        repository: "normal",
        type: 10,
        id,
      }), catalog)).toBe(false);
    }
    expect(isItemResearchCandidate(itemTimelineEntry({
      label: "Charm #90",
      repository: "unique",
      type: 10,
      id: 90,
    }), catalog)).toBe(true);

    const signature = itemResearchSignature(genericCollectible);
    const entries = upsertItemResearchEntry([], genericCollectible).map((entry): ItemResearchEntry =>
      entry.signature === signature ? { ...entry, resolvedName: "Damien's Eye", notes: "Confirmed from in-game drop." } : entry,
    );
    const payload = createItemResearchExportPayload(entries);
    const mixedEntries = [...entries, ...upsertItemResearchEntry([], genericWeapon)];

    expect(payload.kind).toBe("item-research");
    expect(payload.version).toBe(2);
    expect(payload.scope).toBe("all");
    expect(payload.summary).toMatchObject({ total: 1, resolved: 1, unresolved: 0 });
    expect(payload.entries[0]).toMatchObject({
      signature,
      label: "Collectible #24",
      resolvedName: "Damien's Eye",
      resolvedNameKey: "damiens eye",
      type: 13,
      id: 24,
      repository: "normal",
      weaponType: 0,
      classification: "material-collectible",
    });
    expect(payload.summary.classifications["material-collectible"]).toBe(1);
    expect(createItemResearchExportPayload(mixedEntries, { scope: "resolved" }).summary).toMatchObject({ total: 1, resolved: 1, unresolved: 0 });
    expect(createItemResearchExportPayload(mixedEntries, { scope: "unresolved" }).summary).toMatchObject({ total: 1, resolved: 0, unresolved: 1 });
    expect(isKnownItemResearchName("Sash of the Magi")).toBe(true);
    expect(isKnownItemResearchName("Mystery Blade")).toBe(false);
    expect(payload.shareHint).toContain("gist");
  });

  test("keeps repository and weapon subtype distinct across research persistence", () => {
    const catalog = itemResearchCatalogFixture();
    const sword = itemTimelineEntry({
      repository: "unique",
      type: 3,
      id: 35,
      weaponType: 1,
      label: "Sword #35",
      localizationId: "research-sword",
      fingerprint: "sword-35",
    });
    const chainsaw = itemTimelineEntry({
      repository: "unique",
      type: 3,
      id: 35,
      weaponType: 7,
      label: "Chainsaw #35",
      fingerprint: "chainsaw-35",
    });
    const normalSword = itemTimelineEntry({
      repository: "normal",
      type: 3,
      id: 35,
      weaponType: 1,
      label: "Sword #35",
      fingerprint: "normal-sword-35",
    });

    expect(isItemResearchCandidate(normalSword, catalog)).toBe(false);
    expect(new Set([sword, chainsaw, normalSword].map(itemResearchSignature)).size).toBe(3);
    const entries = [sword, chainsaw, normalSword].reduce(upsertItemResearchEntry, [] as ItemResearchEntry[]);
    expect(entries).toHaveLength(3);
    expect(createItemResearchExportPayload(entries).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ repository: "unique", type: 3, id: 35, weaponType: 1, localizationId: "research-sword" }),
      expect.objectContaining({ repository: "unique", type: 3, id: 35, weaponType: 7 }),
      expect.objectContaining({ repository: "normal", type: 3, id: 35, weaponType: 1 }),
    ]));

    expect(normalizeItemResearchEntries([{
      signature: "3:35:0:weapon #35",
      label: "Weapon #35",
      type: 3,
      id: 35,
      dropQuality: 0,
    }])[0]).toMatchObject({
      signature: "unknown:3:35:0:0:weapon #35",
      repository: "unknown",
      weaponType: 0,
    });

    expect(normalizeItemResearchEntries([{
      signature: "legacy-missing-icon",
      label: "Chest #100",
      repository: "unique",
      type: 1,
      id: 100,
      weaponType: 0,
      dropQuality: 0,
      classification: "invalid",
    }])[0]).toMatchObject({
      repository: "unique",
      type: 1,
      id: 100,
      classification: "known-missing-icon",
    });
  });

  test("normalizes item research names for uncertain casing before export", () => {
    const genericCollectible = itemTimelineEntry({ label: "Collectible #24", rarity: "Superior", repository: "normal", type: 13, id: 24, fingerprint: "collectible-24" });
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
    const accents = { ...DEFAULT_THEME_ACCENTS, voidglass: "#69e6d0" };
    const payload = createThemeExportPayload(
      "voidglass",
      accents,
      { voidglass: { border: "rgba(105, 230, 208, 0.44)" } },
      { voidglass: "carbon-fiber" },
      { voidglass: 58 },
    );
    const imported = importThemePayload(JSON.stringify(payload), "dark", DEFAULT_THEME_ACCENTS);

    expect(payload).toMatchObject({
      kind: "theme",
      themeId: "voidglass",
      accent: "#69e6d0",
      texture: "carbon-fiber",
      foregroundFill: 58,
      tokens: { border: "rgba(105, 230, 208, 0.44)" },
    });
    expect(imported.themeId).toBe("voidglass");
    expect(imported.themeAccents.voidglass).toBe("#69e6d0");
    expect(imported.themeTextureMaps.voidglass).toBe("carbon-fiber");
    expect(imported.themeForegroundFillMaps.voidglass).toBe(58);
    expect(imported.themeTokenMaps.voidglass).toEqual({ border: "rgba(105, 230, 208, 0.44)" });
  });

  test("exports an editable starter theme template", () => {
    const payload = createThemeTemplatePayload("cyberpunk");
    const imported = importThemePayload(JSON.stringify(payload), "dark", DEFAULT_THEME_ACCENTS);

    expect(payload).toMatchObject({
      kind: "theme",
      template: true,
      themeId: "cyberpunk",
      accent: DEFAULT_THEME_ACCENTS.cyberpunk,
      texture: DEFAULT_THEME_TEXTURES.cyberpunk,
      foregroundFill: DEFAULT_THEME_FOREGROUND_FILLS.cyberpunk,
    });
    expect(payload.editableFields.join(" ")).toContain("tokens overrides app chrome CSS variables");
    expect(payload.editableFields.join(" ")).toContain("texture selects a built-in background texture");
    expect(payload.editableFields.join(" ")).toContain("foregroundFill controls main foreground material fill");
    expect(payload.tokenReference).toContainEqual({ key: "buttonPrimary", cssVar: "--button-primary", label: "Primary button" });
    expect(payload.tokens).toEqual({});
    expect(imported.themeId).toBe("cyberpunk");
    expect(imported.themeTextureMaps.cyberpunk).toBe(DEFAULT_THEME_TEXTURES.cyberpunk);
    expect(imported.themeForegroundFillMaps.cyberpunk).toBe(DEFAULT_THEME_FOREGROUND_FILLS.cyberpunk);
    expect(imported.themeTokenMaps.cyberpunk).toBeUndefined();
  });

  test("exposes the current theme set to theme normalization", () => {
    expect(THEME_OPTIONS.map((theme) => theme.id)).toEqual(["dark", "demonsteel", "voidglass", "reliquary", "cyberpunk", "light"]);
    expect(THEME_OPTIONS.find((theme) => theme.id === "light")?.label).toBe("Quicksilver");
    expect(DEFAULT_THEME_ACCENTS).toMatchObject({
      demonsteel: "#ff4b35",
      voidglass: "#69e6d0",
      reliquary: "#d8b45f",
      light: "#0071e3",
    });
    expect(DEFAULT_THEME_TEXTURES).toMatchObject({
      dark: "slate-grid",
      demonsteel: "brimstone",
      voidglass: "carbon-fiber",
      reliquary: "reliquary-inlay",
      cyberpunk: "neon-grid",
      light: "brushed-metal",
    });
    expect(DEFAULT_THEME_FOREGROUND_FILLS).toMatchObject({
      dark: 88,
      demonsteel: 72,
      voidglass: 58,
      reliquary: 74,
      cyberpunk: 68,
      light: 82,
    });
    expect(THEME_BACKGROUND_TEXTURE_OPTIONS.filter((texture) => texture.id !== "none")).toHaveLength(10);
    expect(effectiveThemeTexture("voidglass", {})).toBe("carbon-fiber");
    expect(effectiveThemeTexture("voidglass", { voidglass: "void-fracture" })).toBe("void-fracture");
    expect(effectiveThemeForegroundFill("voidglass", {})).toBe(58);
    expect(effectiveThemeForegroundFill("voidglass", { voidglass: 25 })).toBe(25);
    expect(normalizeThemeForegroundFill(9)).toBe(25);
    expect(normalizeThemeForegroundFill("101")).toBe(100);
    expect(normalizeThemeId("demonsteel")).toBe("demonsteel");
    expect(normalizeThemeId("voidglass")).toBe("voidglass");
    expect(normalizeThemeId("reliquary")).toBe("reliquary");
    expect(normalizeThemeId("lost")).toBe("voidglass");
  });

  test("exports and restores one complete backup regardless of retired scope options", () => {
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
          classification: "unknown-normal",
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
      themeTextures: { cyberpunk: "neon-grid" },
      compactThemeTextures: { light: "brushed-metal" },
      themeForegroundFills: { cyberpunk: 68 },
      compactThemeForegroundFills: { light: 82 },
      themeTokenMaps: { cyberpunk: { border: "rgba(0, 240, 255, 0.48)" } },
      itemFilterMuted: false,
      customItemFilterSounds: [{ id: "custom-sound:boss", name: "Boss Drop", fileName: "boss.wav", src: "file:///sounds/boss.wav" }],
      itemFilterGroups: [{ id: "boss", name: "Boss", enabled: true, soundId: "custom-sound:boss", volume: 70, cooldownMs: 1000, rarities: ["Heroic"], types: [], items: [] }],
      postRunReport: withPostRunReportSummaryItems(
        {
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
        },
        ["metric:gold", "rarity:Satanic", "group:bosses", "filter:boss"],
      ),
      itemResearchEntries: [],
    };

    const payload = createConfigurationExportPayload(imported);

    expect(payload.uiPreferences.itemFilterMuted).toBe(false);
    expect(payload.uiPreferences.customItemFilterSounds).toEqual([{ id: "custom-sound:boss", name: "Boss Drop", fileName: "boss.wav", src: "file:///sounds/boss.wav" }]);
    expect(payload.uiPreferences.schemaVersion).toBe(UI_PREFERENCES_SCHEMA_VERSION);
    expect(payload.uiPreferences.itemResearchEntries).toBeUndefined();
    expect(payload.uiPreferences.themeId).toBe("cyberpunk");
    expect(payload.uiPreferences.compactThemeId).toBe("light");
    expect(payload.uiPreferences.themeAccents?.cyberpunk).toBe("#ff3151");
    expect(payload.uiPreferences.themeTextures?.cyberpunk).toBe("neon-grid");
    expect(payload.uiPreferences.compactThemeTextures?.light).toBe("brushed-metal");
    expect(payload.uiPreferences.themeForegroundFills?.cyberpunk).toBe(68);
    expect(payload.uiPreferences.compactThemeForegroundFills?.light).toBe(82);
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

    const reportExcludedPayload = createConfigurationExportPayload(imported);
    expect(reportExcludedPayload.uiPreferences.postRunReport).toMatchObject({ topDropLimit: 5 });
    expect(reportExcludedPayload.uiPreferences.customItemFilterSounds).toEqual(imported.customItemFilterSounds);

    const result = importConfigurationPayload(payload, current);

    expect(result.uiPreferences.logLimit).toBe(defaultPreferences.logLimit);
    expect(result.uiPreferences.itemFilterMuted).toBe(false);
    expect(result.uiPreferences.customItemFilterSounds.map((sound) => sound.id)).toEqual(["custom-sound:boss"]);
    expect(result.uiPreferences.themeTextures.cyberpunk).toBe("neon-grid");
    expect(result.uiPreferences.compactThemeTextures.light).toBe("brushed-metal");
    expect(result.uiPreferences.themeForegroundFills.cyberpunk).toBe(68);
    expect(result.uiPreferences.compactThemeForegroundFills.light).toBe(82);
    expect(result.uiPreferences.postRunReport.topDropLimit).toBe(5);
    expect(result.uiPreferences.itemResearchEntries).toHaveLength(1);
  });
});

function itemResearchCatalogFixture() {
  const sourceRef = "fixture-catalog-source";
  const artifact: ItemCatalogArtifact = {
    schemaVersion: 1,
    catalogId: "item-research-policy-fixture",
    catalogStatus: "partial",
    provenance: {
      ...ACTIVE_ITEM_CATALOG_BUILD,
      source: "static-binary-analysis",
      extractorRevision: "item-research-test-v1",
      extractorSha256: "1".repeat(64),
      configSha256: "2".repeat(64),
      stringInitializerTsvSha256: "3".repeat(64),
      stringInitializerManifestSha256: "4".repeat(64),
      translationBundleSha256: "5".repeat(64),
    },
    coverage: { activeConstructorCount: 1, accountedConstructorCount: 1 },
    sources: [{
      id: sourceRef,
      definitionFunction: "fixture_item_catalog",
      bodySha256: "A".repeat(64),
      definitionCount: 6,
      status: "extracted",
    }],
    domains: [
      {
        id: "normal-charms",
        repository: "normal",
        type: 10,
        weaponType: 0,
        defaultIdentityMode: "seeded",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [
          { gameId: 33, identityMode: "seeded" },
          { gameId: 34, identityMode: "seeded" },
          { gameId: 35, identityMode: "seeded" },
        ],
      },
      {
        id: "normal-helmets",
        repository: "normal",
        type: 0,
        weaponType: 0,
        defaultIdentityMode: "seeded",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [],
      },
      {
        id: "normal-swords",
        repository: "normal",
        type: 3,
        weaponType: 1,
        defaultIdentityMode: "seeded",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [],
      },
      {
        id: "unique-charms",
        repository: "unique",
        type: 10,
        weaponType: 0,
        defaultIdentityMode: "fixed",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [{ gameId: 90, identityMode: "fixed" }],
      },
      {
        id: "normal-keys",
        repository: "normal",
        type: 12,
        weaponType: 0,
        defaultIdentityMode: "stack",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [{ gameId: 77, identityMode: "stack" }],
      },
      {
        id: "runewords",
        repository: "runeword",
        type: 3,
        weaponType: 0,
        defaultIdentityMode: "runeword",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [{ gameId: 96, identityMode: "runeword" }],
      },
    ],
    definitions: [{
      repository: "normal",
      type: 10,
      gameId: 33,
      weaponType: 0,
      identityMode: "seeded",
      baseLocalizationId: "large_charm",
      baseName: "Large Charm",
      provenanceRef: sourceRef,
    }],
    missing: [
      {
        repository: "normal",
        type: 10,
        gameId: 34,
        weaponType: 0,
        expectedIdentityMode: "seeded",
        reason: "fixture missing seeded row",
        sourceRefs: [sourceRef],
      },
      {
        repository: "unique",
        type: 10,
        gameId: 90,
        weaponType: 0,
        expectedIdentityMode: "fixed",
        reason: "fixture missing fixed row",
        sourceRefs: [sourceRef],
      },
      {
        repository: "normal",
        type: 12,
        gameId: 77,
        weaponType: 0,
        expectedIdentityMode: "stack",
        reason: "fixture missing stack row",
        sourceRefs: [sourceRef],
      },
      {
        repository: "runeword",
        type: 3,
        gameId: 96,
        weaponType: 0,
        expectedIdentityMode: "runeword",
        reason: "fixture missing runeword row",
        sourceRefs: [sourceRef],
      },
    ],
    quarantine: [{
      repository: "normal",
      type: 10,
      gameId: 35,
      weaponType: 0,
      expectedIdentityMode: "seeded",
      reason: "fixture same-mode collision",
      candidates: [
        { identityMode: "seeded", provenanceRef: sourceRef, baseLocalizationId: "large_charm_a", baseName: "Large Charm A" },
        { identityMode: "seeded", provenanceRef: sourceRef, baseLocalizationId: "large_charm_b", baseName: "Large Charm B" },
      ],
    }],
  };
  return createItemCatalogResolver(artifact);
}
