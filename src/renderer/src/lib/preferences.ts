import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import type { CapturePreferences, RunArchivePreferences } from "../../../shared/app-state";
import { defaultCompactRunTiles, normalizeCompactRunTiles, type CompactRunTileConfig } from "./compact-tiles";
import {
  DEFAULT_ITEM_FILTER_GROUPS,
  itemFilterIdFromTimelineValue,
  normalizeCustomItemFilterSounds,
  normalizeItemFilterGroups,
  type CustomItemFilterSound,
  type ItemFilterGroup,
} from "./item-filters";
import { DEFAULT_SHOPPING_LIST } from "./item-options";
import { normalizeItemResearchEntries, type ItemResearchEntry } from "./item-research";
import { defaultPostRunReportConfig, normalizePostRunReportConfig, type PostRunReportConfig } from "./report-config";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_ID, normalizeThemeAccents, normalizeThemeId, normalizeThemeTokenMaps, type ThemeAccentMap, type ThemeId, type ThemeTokenMaps } from "./themes";

export interface UiPreferences {
  logLimit: number;
  timelineLimit: number;
  showCaptureDetails: boolean;
  alwaysOnTop: boolean;
  lockCompactLocation: boolean;
  hideSocketables: boolean;
  hideKeys: boolean;
  hideMaterials: boolean;
  timelineType: string;
  shoppingListItems: string[];
  gameExecutablePath: string;
  launchThroughSteam: boolean;
  themeId: ThemeId;
  compactThemeId: ThemeId;
  themeAccents: ThemeAccentMap;
  themeTokenMaps: ThemeTokenMaps;
  itemFilterGroups: ItemFilterGroup[];
  itemFilterMuted: boolean;
  customItemFilterSounds: CustomItemFilterSound[];
  postRunReport: PostRunReportConfig;
  compactRunTiles: CompactRunTileConfig[];
  developerItemResearchEnabled: boolean;
  unknownItemAudioPrompt: boolean;
  itemResearchEntries: ItemResearchEntry[];
}

export interface ConfigurationTransferOptions {
  includeAppSettings: boolean;
  includeRunSaving: boolean;
  includeReportTracking: boolean;
  includeLootFilters: boolean;
  includeSounds: boolean;
  includeItemResearch: boolean;
}

export interface ConfigurationExportPayload {
  app: "hero-siege-companion";
  kind: "configuration";
  version: 1;
  exportedAt: string;
  includes: {
    appSettings: boolean;
    runSaving: boolean;
    reportTracking: boolean;
    lootFilters: boolean;
    sounds: boolean;
    itemResearch: boolean;
  };
  uiPreferences: Partial<UiPreferences>;
  runArchivePreferences?: RunArchivePreferences;
  capturePreferences?: CapturePreferences;
}

export interface ConfigurationImportResult {
  uiPreferences: UiPreferences;
  runArchivePreferences?: RunArchivePreferences;
  capturePreferences?: CapturePreferences;
}

export const LOG_LIMIT_OPTIONS = [10, 20, 50, 100, 250, 500];
const PREFERENCES_STORAGE_KEY = "hero-siege-companion:preferences:v1";

export const defaultPreferences: UiPreferences = {
  logLimit: 20,
  timelineLimit: 10,
  showCaptureDetails: false,
  alwaysOnTop: false,
  lockCompactLocation: false,
  hideSocketables: false,
  hideKeys: false,
  hideMaterials: false,
  timelineType: "all",
  shoppingListItems: DEFAULT_SHOPPING_LIST,
  gameExecutablePath: "",
  launchThroughSteam: true,
  themeId: DEFAULT_THEME_ID,
  compactThemeId: DEFAULT_THEME_ID,
  themeAccents: DEFAULT_THEME_ACCENTS,
  themeTokenMaps: {},
  itemFilterGroups: DEFAULT_ITEM_FILTER_GROUPS,
  itemFilterMuted: false,
  customItemFilterSounds: [],
  postRunReport: defaultPostRunReportConfig,
  compactRunTiles: defaultCompactRunTiles,
  developerItemResearchEnabled: false,
  unknownItemAudioPrompt: false,
  itemResearchEntries: [],
};

const APP_SETTING_KEYS: Array<keyof UiPreferences> = [
  "logLimit",
  "timelineLimit",
  "showCaptureDetails",
  "alwaysOnTop",
  "lockCompactLocation",
  "hideSocketables",
  "hideKeys",
  "hideMaterials",
  "timelineType",
  "shoppingListItems",
  "gameExecutablePath",
  "launchThroughSteam",
  "themeId",
  "compactThemeId",
  "themeAccents",
  "themeTokenMaps",
  "compactRunTiles",
  "developerItemResearchEnabled",
  "unknownItemAudioPrompt",
];

export function loadPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return normalizePreferences(defaultPreferences);
    return normalizePreferences(JSON.parse(raw) as Partial<UiPreferences>);
  } catch {
    return normalizePreferences(defaultPreferences);
  }
}

export function savePreferences(preferences: UiPreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences should never block the live tracker.
  }
}

export function createConfigurationExportPayload(
  uiPreferences: UiPreferences,
  runArchivePreferences: RunArchivePreferences,
  capturePreferences: CapturePreferences,
  options: ConfigurationTransferOptions,
): ConfigurationExportPayload {
  const exportedUiPreferences: Partial<UiPreferences> = { ...normalizePreferences(uiPreferences) };
  if (!options.includeAppSettings) {
    for (const key of APP_SETTING_KEYS) delete exportedUiPreferences[key];
  }
  if (!options.includeReportTracking) {
    delete exportedUiPreferences.postRunReport;
  }
  if (!options.includeLootFilters) {
    delete exportedUiPreferences.itemFilterGroups;
    delete exportedUiPreferences.itemFilterMuted;
  }
  if (!options.includeSounds) {
    delete exportedUiPreferences.customItemFilterSounds;
  }
  if (!options.includeItemResearch) {
    delete exportedUiPreferences.itemResearchEntries;
  }

  return {
    app: "hero-siege-companion",
    kind: "configuration",
    version: 1,
    exportedAt: new Date().toISOString(),
    includes: {
      appSettings: options.includeAppSettings,
      runSaving: options.includeRunSaving,
      reportTracking: options.includeReportTracking,
      lootFilters: options.includeLootFilters,
      sounds: options.includeSounds,
      itemResearch: options.includeItemResearch,
    },
    uiPreferences: exportedUiPreferences,
    runArchivePreferences: options.includeRunSaving ? normalizeRunArchivePreferences(runArchivePreferences) : undefined,
    capturePreferences: options.includeAppSettings ? normalizeCapturePreferences(capturePreferences) : undefined,
  };
}

export function importConfigurationPayload(
  rawPayload: string | unknown,
  currentPreferences: UiPreferences,
  options: ConfigurationTransferOptions,
): ConfigurationImportResult {
  const parsed = typeof rawPayload === "string" ? JSON.parse(rawPayload) as unknown : rawPayload;
  const payload = isRecord(parsed) ? parsed : {};
  const rawUiPreferences = isRecord(payload.uiPreferences) ? payload.uiPreferences : payload;
  const nextUiPreferences: Partial<UiPreferences> = { ...currentPreferences, ...rawUiPreferences };
  nextUiPreferences.customItemFilterSounds =
    options.includeSounds && Object.prototype.hasOwnProperty.call(rawUiPreferences, "customItemFilterSounds")
      ? mergeCustomItemFilterSounds(currentPreferences.customItemFilterSounds, rawUiPreferences.customItemFilterSounds)
      : currentPreferences.customItemFilterSounds;

  if (!options.includeAppSettings) {
    for (const key of APP_SETTING_KEYS) nextUiPreferences[key] = currentPreferences[key];
  }
  if (!options.includeReportTracking) {
    nextUiPreferences.postRunReport = currentPreferences.postRunReport;
  }
  if (!options.includeLootFilters) {
    nextUiPreferences.itemFilterGroups = currentPreferences.itemFilterGroups;
    nextUiPreferences.itemFilterMuted = currentPreferences.itemFilterMuted;
  }
  if (!options.includeItemResearch) {
    nextUiPreferences.itemResearchEntries = currentPreferences.itemResearchEntries;
  }

  return {
    uiPreferences: normalizePreferences(nextUiPreferences),
    runArchivePreferences:
      options.includeRunSaving && isRecord(payload.runArchivePreferences) ? normalizeRunArchivePreferences(payload.runArchivePreferences) : undefined,
    capturePreferences:
      options.includeAppSettings && isRecord(payload.capturePreferences) ? normalizeCapturePreferences(payload.capturePreferences) : undefined,
  };
}

function mergeCustomItemFilterSounds(current: CustomItemFilterSound[], imported: unknown): CustomItemFilterSound[] {
  const soundsById = new Map(current.map((sound) => [sound.id, sound]));
  for (const sound of normalizeCustomItemFilterSounds(imported)) soundsById.set(sound.id, sound);
  return normalizeCustomItemFilterSounds(Array.from(soundsById.values()));
}

export function normalizePreferences(value: Partial<UiPreferences>): UiPreferences {
  const validLogLimit = LOG_LIMIT_OPTIONS.includes(Number(value.logLimit)) ? Number(value.logLimit) : defaultPreferences.logLimit;
  const validTimelineLimit = LOG_LIMIT_OPTIONS.includes(Number(value.timelineLimit))
    ? Number(value.timelineLimit)
    : defaultPreferences.timelineLimit;
  const validTimelineType =
    value.timelineType === "all" ||
    Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAMES, Number(value.timelineType)) ||
    itemFilterIdFromTimelineValue(String(value.timelineType ?? ""))
      ? String(value.timelineType)
      : defaultPreferences.timelineType;
  const customItemFilterSounds = normalizeCustomItemFilterSounds(value.customItemFilterSounds);

  return {
    logLimit: validLogLimit,
    timelineLimit: validTimelineLimit,
    showCaptureDetails: Boolean(value.showCaptureDetails),
    alwaysOnTop: Boolean(value.alwaysOnTop),
    lockCompactLocation: Boolean(value.lockCompactLocation),
    hideSocketables: Boolean(value.hideSocketables),
    hideKeys: Boolean(value.hideKeys),
    hideMaterials: Boolean(value.hideMaterials),
    timelineType: validTimelineType,
    shoppingListItems: normalizeShoppingList(value.shoppingListItems),
    gameExecutablePath: typeof value.gameExecutablePath === "string" ? value.gameExecutablePath : defaultPreferences.gameExecutablePath,
    launchThroughSteam: value.launchThroughSteam === undefined ? defaultPreferences.launchThroughSteam : Boolean(value.launchThroughSteam),
    themeId: normalizeThemeId(value.themeId),
    compactThemeId: normalizeThemeId(value.compactThemeId ?? value.themeId),
    themeAccents: normalizeThemeAccents(value.themeAccents),
    themeTokenMaps: normalizeThemeTokenMaps(value.themeTokenMaps),
    itemFilterGroups: normalizeItemFilterGroups(value.itemFilterGroups, customItemFilterSounds),
    itemFilterMuted: Boolean(value.itemFilterMuted),
    customItemFilterSounds,
    postRunReport: normalizePostRunReportConfig(value.postRunReport),
    compactRunTiles: normalizeCompactRunTiles(value.compactRunTiles),
    developerItemResearchEnabled: Boolean(value.developerItemResearchEnabled),
    unknownItemAudioPrompt: Boolean(value.unknownItemAudioPrompt),
    itemResearchEntries: normalizeItemResearchEntries(value.itemResearchEntries),
  };
}

export function normalizeShoppingList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : DEFAULT_SHOPPING_LIST;
  const normalized = values.map((item) => String(item).trim()).filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 100);
}

export function normalizeRunDurationMinutes(value: number): number {
  const minutes = Number(value);
  return Number.isFinite(minutes) ? Math.max(0, Math.min(1440, Math.trunc(minutes))) : 0;
}

export function normalizeRunArchivePreferences(value: unknown): RunArchivePreferences {
  const preferences = isRecord(value) ? value : {};
  return {
    skipEmptyRuns: Boolean(preferences.skipEmptyRuns),
    minDurationMinutes: normalizeRunDurationMinutes(Number(preferences.minDurationMinutes)),
  };
}

export function normalizeCapturePreferences(value: unknown): CapturePreferences {
  const preferences = isRecord(value) ? value : {};
  return {
    createDebugMode: Boolean(preferences.createDebugMode),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
