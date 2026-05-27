import { ref, type Ref } from "vue";
import type { CapturePreferences, RunArchivePreferences } from "../../../shared/app-state";
import type { CompactRunTileConfig } from "./compact-tiles";
import type { CustomItemFilterSound, ItemFilterGroup } from "./item-filters";
import type { ItemResearchEntry } from "./item-research";
import { defaultPreferences, normalizeRunDurationMinutes, type ConfigurationTransferOptions, type UiPreferences } from "./preferences";
import { normalizePostRunReportConfig, type PostRunReportConfig } from "./report-config";
import { DEFAULT_THEME_ACCENTS, normalizeThemeAccent, type ThemeAccentMap, type ThemeId, type ThemeTokenMaps } from "./themes";

export interface AppPreferencesState {
  logLimit: Ref<number>;
  timelineLimit: Ref<number>;
  showCaptureDetails: Ref<boolean>;
  alwaysOnTop: Ref<boolean>;
  lockCompactLocation: Ref<boolean>;
  hideSocketables: Ref<boolean>;
  hideKeys: Ref<boolean>;
  hideMaterials: Ref<boolean>;
  timelineType: Ref<string>;
  gameExecutablePath: Ref<string>;
  launchThroughSteam: Ref<boolean>;
  themeId: Ref<ThemeId>;
  compactThemeId: Ref<ThemeId>;
  themeAccents: Ref<ThemeAccentMap>;
  themeTokenMaps: Ref<ThemeTokenMaps>;
  itemFilterGroups: Ref<ItemFilterGroup[]>;
  itemFilterMuted: Ref<boolean>;
  customItemFilterSounds: Ref<CustomItemFilterSound[]>;
  postRunReport: Ref<PostRunReportConfig>;
  compactRunTiles: Ref<CompactRunTileConfig[]>;
  developerItemResearchEnabled: Ref<boolean>;
  unknownItemAudioPrompt: Ref<boolean>;
  itemResearchEntries: Ref<ItemResearchEntry[]>;
  draftLogLimit: Ref<number>;
  draftTimelineLimit: Ref<number>;
  draftShowCaptureDetails: Ref<boolean>;
  draftAlwaysOnTop: Ref<boolean>;
  draftLockCompactLocation: Ref<boolean>;
  draftHideSocketables: Ref<boolean>;
  draftHideKeys: Ref<boolean>;
  draftHideMaterials: Ref<boolean>;
  draftDeveloperItemResearchEnabled: Ref<boolean>;
  draftUnknownItemAudioPrompt: Ref<boolean>;
  draftTimelineType: Ref<string>;
  draftGameExecutablePath: Ref<string>;
  draftLaunchThroughSteam: Ref<boolean>;
  draftThemeId: Ref<ThemeId>;
  draftCompactThemeId: Ref<ThemeId>;
  draftThemeAccents: Ref<ThemeAccentMap>;
  draftThemeTokenMaps: Ref<ThemeTokenMaps>;
  draftCreateDebugMode: Ref<boolean>;
  draftSkipEmptyRuns: Ref<boolean>;
  draftMinRunDurationMinutes: Ref<number>;
  configIncludeAppSettings: Ref<boolean>;
  configIncludeRunSaving: Ref<boolean>;
  configIncludeReportTracking: Ref<boolean>;
  configIncludeLootFilters: Ref<boolean>;
  configIncludeSounds: Ref<boolean>;
  configIncludeItemResearch: Ref<boolean>;
  preferenceWatchSources: Array<Ref<unknown>>;
  currentPreferences(shoppingListItems: string[]): UiPreferences;
  applyPreferences(preferences: UiPreferences): void;
  currentDraftPreferences(shoppingListItems: string[]): UiPreferences;
  loadDraftPreferences(preferences: UiPreferences, runArchivePreferences: RunArchivePreferences, capturePreferences: CapturePreferences): void;
  currentDraftRunArchivePreferences(): RunArchivePreferences;
  currentDraftCapturePreferences(): CapturePreferences;
  currentConfigurationTransferOptions(): ConfigurationTransferOptions;
  updateDraftThemeAccent(value: string, targetThemeId?: ThemeId): void;
  updatePostRunReportConfig(value: PostRunReportConfig): void;
}

export function useAppPreferences(): AppPreferencesState {
  const logLimit = ref(20);
  const timelineLimit = ref(10);
  const showCaptureDetails = ref(false);
  const alwaysOnTop = ref(false);
  const lockCompactLocation = ref(false);
  const hideSocketables = ref(false);
  const hideKeys = ref(false);
  const hideMaterials = ref(false);
  const timelineType = ref("all");
  const gameExecutablePath = ref("");
  const launchThroughSteam = ref(true);
  const themeId = ref<ThemeId>("dark");
  const compactThemeId = ref<ThemeId>("dark");
  const themeAccents = ref<ThemeAccentMap>({ ...DEFAULT_THEME_ACCENTS });
  const themeTokenMaps = ref<ThemeTokenMaps>({});
  const itemFilterGroups = ref<ItemFilterGroup[]>([]);
  const itemFilterMuted = ref(false);
  const customItemFilterSounds = ref<CustomItemFilterSound[]>([]);
  const postRunReport = ref<PostRunReportConfig>(defaultPreferences.postRunReport);
  const compactRunTiles = ref<CompactRunTileConfig[]>(defaultPreferences.compactRunTiles);
  const developerItemResearchEnabled = ref(false);
  const unknownItemAudioPrompt = ref(false);
  const itemResearchEntries = ref<ItemResearchEntry[]>([]);

  const draftLogLimit = ref(20);
  const draftTimelineLimit = ref(10);
  const draftShowCaptureDetails = ref(false);
  const draftAlwaysOnTop = ref(false);
  const draftLockCompactLocation = ref(false);
  const draftHideSocketables = ref(false);
  const draftHideKeys = ref(false);
  const draftHideMaterials = ref(false);
  const draftDeveloperItemResearchEnabled = ref(false);
  const draftUnknownItemAudioPrompt = ref(false);
  const draftTimelineType = ref("all");
  const draftGameExecutablePath = ref("");
  const draftLaunchThroughSteam = ref(true);
  const draftThemeId = ref<ThemeId>("dark");
  const draftCompactThemeId = ref<ThemeId>("dark");
  const draftThemeAccents = ref<ThemeAccentMap>({ ...DEFAULT_THEME_ACCENTS });
  const draftThemeTokenMaps = ref<ThemeTokenMaps>({});
  const draftCreateDebugMode = ref(false);
  const draftSkipEmptyRuns = ref(false);
  const draftMinRunDurationMinutes = ref(0);

  const configIncludeAppSettings = ref(true);
  const configIncludeRunSaving = ref(true);
  const configIncludeReportTracking = ref(true);
  const configIncludeLootFilters = ref(true);
  const configIncludeSounds = ref(true);
  const configIncludeItemResearch = ref(false);

  const preferenceWatchSources: Array<Ref<unknown>> = [
    logLimit,
    timelineLimit,
    showCaptureDetails,
    hideSocketables,
    hideKeys,
    hideMaterials,
    timelineType,
    lockCompactLocation,
    themeId,
    compactThemeId,
    themeAccents,
    themeTokenMaps,
    itemFilterGroups,
    itemFilterMuted,
    customItemFilterSounds,
    postRunReport,
    compactRunTiles,
    developerItemResearchEnabled,
    unknownItemAudioPrompt,
    itemResearchEntries,
  ];

  function currentPreferences(shoppingListItems: string[]): UiPreferences {
    return {
      logLimit: logLimit.value,
      timelineLimit: timelineLimit.value,
      showCaptureDetails: showCaptureDetails.value,
      alwaysOnTop: alwaysOnTop.value,
      lockCompactLocation: lockCompactLocation.value,
      hideSocketables: hideSocketables.value,
      hideKeys: hideKeys.value,
      hideMaterials: hideMaterials.value,
      timelineType: timelineType.value,
      shoppingListItems,
      gameExecutablePath: gameExecutablePath.value,
      launchThroughSteam: launchThroughSteam.value,
      themeId: themeId.value,
      compactThemeId: compactThemeId.value,
      themeAccents: themeAccents.value,
      themeTokenMaps: themeTokenMaps.value,
      itemFilterGroups: itemFilterGroups.value,
      itemFilterMuted: itemFilterMuted.value,
      customItemFilterSounds: customItemFilterSounds.value,
      postRunReport: postRunReport.value,
      compactRunTiles: compactRunTiles.value,
      developerItemResearchEnabled: developerItemResearchEnabled.value,
      unknownItemAudioPrompt: unknownItemAudioPrompt.value,
      itemResearchEntries: itemResearchEntries.value,
    };
  }

  function applyPreferences(preferences: UiPreferences): void {
    logLimit.value = preferences.logLimit;
    timelineLimit.value = preferences.timelineLimit;
    showCaptureDetails.value = preferences.showCaptureDetails;
    alwaysOnTop.value = preferences.alwaysOnTop;
    lockCompactLocation.value = preferences.lockCompactLocation;
    hideSocketables.value = preferences.hideSocketables;
    hideKeys.value = preferences.hideKeys;
    hideMaterials.value = preferences.hideMaterials;
    timelineType.value = preferences.timelineType;
    gameExecutablePath.value = preferences.gameExecutablePath;
    launchThroughSteam.value = preferences.launchThroughSteam;
    themeId.value = preferences.themeId;
    compactThemeId.value = preferences.compactThemeId;
    themeAccents.value = preferences.themeAccents;
    themeTokenMaps.value = preferences.themeTokenMaps;
    itemFilterGroups.value = preferences.itemFilterGroups;
    itemFilterMuted.value = preferences.itemFilterMuted;
    customItemFilterSounds.value = preferences.customItemFilterSounds;
    postRunReport.value = preferences.postRunReport;
    compactRunTiles.value = preferences.compactRunTiles;
    developerItemResearchEnabled.value = preferences.developerItemResearchEnabled;
    unknownItemAudioPrompt.value = preferences.unknownItemAudioPrompt;
    itemResearchEntries.value = preferences.itemResearchEntries;
  }

  function currentDraftPreferences(shoppingListItems: string[]): UiPreferences {
    return {
      logLimit: draftLogLimit.value,
      timelineLimit: draftTimelineLimit.value,
      showCaptureDetails: draftShowCaptureDetails.value,
      alwaysOnTop: draftAlwaysOnTop.value,
      lockCompactLocation: draftLockCompactLocation.value,
      hideSocketables: draftHideSocketables.value,
      hideKeys: draftHideKeys.value,
      hideMaterials: draftHideMaterials.value,
      timelineType: draftTimelineType.value,
      shoppingListItems,
      gameExecutablePath: draftGameExecutablePath.value.trim(),
      launchThroughSteam: draftLaunchThroughSteam.value,
      themeId: draftThemeId.value,
      compactThemeId: draftCompactThemeId.value,
      themeAccents: draftThemeAccents.value,
      themeTokenMaps: draftThemeTokenMaps.value,
      itemFilterGroups: itemFilterGroups.value,
      itemFilterMuted: itemFilterMuted.value,
      customItemFilterSounds: customItemFilterSounds.value,
      postRunReport: postRunReport.value,
      compactRunTiles: compactRunTiles.value,
      developerItemResearchEnabled: draftDeveloperItemResearchEnabled.value,
      unknownItemAudioPrompt: draftDeveloperItemResearchEnabled.value && draftUnknownItemAudioPrompt.value,
      itemResearchEntries: itemResearchEntries.value,
    };
  }

  function loadDraftPreferences(
    preferences: UiPreferences,
    runArchivePreferences: RunArchivePreferences,
    capturePreferences: CapturePreferences,
  ): void {
    draftLogLimit.value = preferences.logLimit;
    draftTimelineLimit.value = preferences.timelineLimit;
    draftShowCaptureDetails.value = preferences.showCaptureDetails;
    draftAlwaysOnTop.value = preferences.alwaysOnTop;
    draftLockCompactLocation.value = preferences.lockCompactLocation;
    draftHideSocketables.value = preferences.hideSocketables;
    draftHideKeys.value = preferences.hideKeys;
    draftHideMaterials.value = preferences.hideMaterials;
    draftDeveloperItemResearchEnabled.value = preferences.developerItemResearchEnabled;
    draftUnknownItemAudioPrompt.value = preferences.unknownItemAudioPrompt;
    draftTimelineType.value = preferences.timelineType;
    draftGameExecutablePath.value = preferences.gameExecutablePath;
    draftLaunchThroughSteam.value = preferences.launchThroughSteam;
    draftThemeId.value = preferences.themeId;
    draftCompactThemeId.value = preferences.compactThemeId;
    draftThemeAccents.value = { ...preferences.themeAccents };
    draftThemeTokenMaps.value = { ...preferences.themeTokenMaps };
    draftCreateDebugMode.value = capturePreferences.createDebugMode;
    draftSkipEmptyRuns.value = runArchivePreferences.skipEmptyRuns;
    draftMinRunDurationMinutes.value = runArchivePreferences.minDurationMinutes;
  }

  function currentDraftRunArchivePreferences(): RunArchivePreferences {
    return {
      skipEmptyRuns: draftSkipEmptyRuns.value,
      minDurationMinutes: normalizeRunDurationMinutes(draftMinRunDurationMinutes.value),
    };
  }

  function currentDraftCapturePreferences(): CapturePreferences {
    return {
      createDebugMode: draftCreateDebugMode.value,
    };
  }

  function currentConfigurationTransferOptions(): ConfigurationTransferOptions {
    return {
      includeAppSettings: configIncludeAppSettings.value,
      includeRunSaving: configIncludeRunSaving.value,
      includeReportTracking: configIncludeReportTracking.value,
      includeLootFilters: configIncludeLootFilters.value,
      includeSounds: configIncludeSounds.value,
      includeItemResearch: configIncludeItemResearch.value,
    };
  }

  function updateDraftThemeAccent(value: string, targetThemeId = draftThemeId.value): void {
    const normalized = normalizeThemeAccent(value);
    if (!normalized) return;
    draftThemeAccents.value = { ...draftThemeAccents.value, [targetThemeId]: normalized };
  }

  function updatePostRunReportConfig(value: PostRunReportConfig): void {
    postRunReport.value = normalizePostRunReportConfig(value);
  }

  return {
    logLimit,
    timelineLimit,
    showCaptureDetails,
    alwaysOnTop,
    lockCompactLocation,
    hideSocketables,
    hideKeys,
    hideMaterials,
    timelineType,
    gameExecutablePath,
    launchThroughSteam,
    themeId,
    compactThemeId,
    themeAccents,
    themeTokenMaps,
    itemFilterGroups,
    itemFilterMuted,
    customItemFilterSounds,
    postRunReport,
    compactRunTiles,
    developerItemResearchEnabled,
    unknownItemAudioPrompt,
    itemResearchEntries,
    draftLogLimit,
    draftTimelineLimit,
    draftShowCaptureDetails,
    draftAlwaysOnTop,
    draftLockCompactLocation,
    draftHideSocketables,
    draftHideKeys,
    draftHideMaterials,
    draftDeveloperItemResearchEnabled,
    draftUnknownItemAudioPrompt,
    draftTimelineType,
    draftGameExecutablePath,
    draftLaunchThroughSteam,
    draftThemeId,
    draftCompactThemeId,
    draftThemeAccents,
    draftThemeTokenMaps,
    draftCreateDebugMode,
    draftSkipEmptyRuns,
    draftMinRunDurationMinutes,
    configIncludeAppSettings,
    configIncludeRunSaving,
    configIncludeReportTracking,
    configIncludeLootFilters,
    configIncludeSounds,
    configIncludeItemResearch,
    preferenceWatchSources,
    currentPreferences,
    applyPreferences,
    currentDraftPreferences,
    loadDraftPreferences,
    currentDraftRunArchivePreferences,
    currentDraftCapturePreferences,
    currentConfigurationTransferOptions,
    updateDraftThemeAccent,
    updatePostRunReportConfig,
  };
}
