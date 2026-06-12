import { ref, type Ref } from "vue";
import type { CapturePreferences, RunArchivePreferences } from "../../../shared/app-state";
import { DEFAULT_CAPTURE_PREFERENCES, DEFAULT_RUN_ARCHIVE_PREFERENCES } from "../../../shared/initial-state";
import type { CompactRunTileConfig } from "./compact-tiles";
import type { CustomItemFilterSound, ItemFilterGroup } from "./item-filters";
import type { ItemResearchEntry } from "./item-research";
import { defaultPreferences, normalizeRunDurationMinutes, type ConfigurationTransferOptions, type UiPreferences } from "./preferences";
import { normalizePostRunReportConfig, type PostRunReportConfig } from "./report-config";
import {
  DEFAULT_THEME_ACCENTS,
  normalizeThemeAccent,
  type ThemeAccentMap,
  type ThemeForegroundFillMap,
  type ThemeId,
  type ThemeTextureMap,
  type ThemeTokenMaps,
} from "./themes";

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
  themeTextures: Ref<ThemeTextureMap>;
  compactThemeTextures: Ref<ThemeTextureMap>;
  themeForegroundFills: Ref<ThemeForegroundFillMap>;
  compactThemeForegroundFills: Ref<ThemeForegroundFillMap>;
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
  draftThemeTextures: Ref<ThemeTextureMap>;
  draftCompactThemeTextures: Ref<ThemeTextureMap>;
  draftThemeForegroundFills: Ref<ThemeForegroundFillMap>;
  draftCompactThemeForegroundFills: Ref<ThemeForegroundFillMap>;
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
  const logLimit = ref(defaultPreferences.logLimit);
  const timelineLimit = ref(defaultPreferences.timelineLimit);
  const showCaptureDetails = ref(defaultPreferences.showCaptureDetails);
  const alwaysOnTop = ref(defaultPreferences.alwaysOnTop);
  const lockCompactLocation = ref(defaultPreferences.lockCompactLocation);
  const hideSocketables = ref(defaultPreferences.hideSocketables);
  const hideKeys = ref(defaultPreferences.hideKeys);
  const hideMaterials = ref(defaultPreferences.hideMaterials);
  const timelineType = ref(defaultPreferences.timelineType);
  const gameExecutablePath = ref(defaultPreferences.gameExecutablePath);
  const launchThroughSteam = ref(defaultPreferences.launchThroughSteam);
  const themeId = ref<ThemeId>(defaultPreferences.themeId);
  const compactThemeId = ref<ThemeId>(defaultPreferences.compactThemeId);
  const themeAccents = ref<ThemeAccentMap>({ ...DEFAULT_THEME_ACCENTS });
  const themeTextures = ref<ThemeTextureMap>({ ...defaultPreferences.themeTextures });
  const compactThemeTextures = ref<ThemeTextureMap>({ ...defaultPreferences.compactThemeTextures });
  const themeForegroundFills = ref<ThemeForegroundFillMap>({ ...defaultPreferences.themeForegroundFills });
  const compactThemeForegroundFills = ref<ThemeForegroundFillMap>({ ...defaultPreferences.compactThemeForegroundFills });
  const themeTokenMaps = ref<ThemeTokenMaps>({ ...defaultPreferences.themeTokenMaps });
  const itemFilterGroups = ref<ItemFilterGroup[]>([]);
  const itemFilterMuted = ref(false);
  const customItemFilterSounds = ref<CustomItemFilterSound[]>([]);
  const postRunReport = ref<PostRunReportConfig>(defaultPreferences.postRunReport);
  const compactRunTiles = ref<CompactRunTileConfig[]>(defaultPreferences.compactRunTiles);
  const developerItemResearchEnabled = ref(false);
  const unknownItemAudioPrompt = ref(false);
  const itemResearchEntries = ref<ItemResearchEntry[]>([]);

  const draftLogLimit = ref(defaultPreferences.logLimit);
  const draftTimelineLimit = ref(defaultPreferences.timelineLimit);
  const draftShowCaptureDetails = ref(defaultPreferences.showCaptureDetails);
  const draftAlwaysOnTop = ref(defaultPreferences.alwaysOnTop);
  const draftLockCompactLocation = ref(defaultPreferences.lockCompactLocation);
  const draftHideSocketables = ref(defaultPreferences.hideSocketables);
  const draftHideKeys = ref(defaultPreferences.hideKeys);
  const draftHideMaterials = ref(defaultPreferences.hideMaterials);
  const draftDeveloperItemResearchEnabled = ref(defaultPreferences.developerItemResearchEnabled);
  const draftUnknownItemAudioPrompt = ref(defaultPreferences.unknownItemAudioPrompt);
  const draftTimelineType = ref(defaultPreferences.timelineType);
  const draftGameExecutablePath = ref(defaultPreferences.gameExecutablePath);
  const draftLaunchThroughSteam = ref(defaultPreferences.launchThroughSteam);
  const draftThemeId = ref<ThemeId>(defaultPreferences.themeId);
  const draftCompactThemeId = ref<ThemeId>(defaultPreferences.compactThemeId);
  const draftThemeAccents = ref<ThemeAccentMap>({ ...DEFAULT_THEME_ACCENTS });
  const draftThemeTextures = ref<ThemeTextureMap>({ ...defaultPreferences.themeTextures });
  const draftCompactThemeTextures = ref<ThemeTextureMap>({ ...defaultPreferences.compactThemeTextures });
  const draftThemeForegroundFills = ref<ThemeForegroundFillMap>({ ...defaultPreferences.themeForegroundFills });
  const draftCompactThemeForegroundFills = ref<ThemeForegroundFillMap>({ ...defaultPreferences.compactThemeForegroundFills });
  const draftThemeTokenMaps = ref<ThemeTokenMaps>({ ...defaultPreferences.themeTokenMaps });
  const draftCreateDebugMode = ref(DEFAULT_CAPTURE_PREFERENCES.createDebugMode);
  const draftSkipEmptyRuns = ref(DEFAULT_RUN_ARCHIVE_PREFERENCES.skipEmptyRuns);
  const draftMinRunDurationMinutes = ref(DEFAULT_RUN_ARCHIVE_PREFERENCES.minDurationMinutes);

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
    themeTextures,
    compactThemeTextures,
    themeForegroundFills,
    compactThemeForegroundFills,
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
      themeTextures: themeTextures.value,
      compactThemeTextures: compactThemeTextures.value,
      themeForegroundFills: themeForegroundFills.value,
      compactThemeForegroundFills: compactThemeForegroundFills.value,
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
    themeTextures.value = preferences.themeTextures;
    compactThemeTextures.value = preferences.compactThemeTextures;
    themeForegroundFills.value = preferences.themeForegroundFills;
    compactThemeForegroundFills.value = preferences.compactThemeForegroundFills;
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
      themeTextures: draftThemeTextures.value,
      compactThemeTextures: draftCompactThemeTextures.value,
      themeForegroundFills: draftThemeForegroundFills.value,
      compactThemeForegroundFills: draftCompactThemeForegroundFills.value,
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
    draftThemeTextures.value = { ...preferences.themeTextures };
    draftCompactThemeTextures.value = { ...preferences.compactThemeTextures };
    draftThemeForegroundFills.value = { ...preferences.themeForegroundFills };
    draftCompactThemeForegroundFills.value = { ...preferences.compactThemeForegroundFills };
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
    themeTextures,
    compactThemeTextures,
    themeForegroundFills,
    compactThemeForegroundFills,
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
    draftThemeTextures,
    draftCompactThemeTextures,
    draftThemeForegroundFills,
    draftCompactThemeForegroundFills,
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
