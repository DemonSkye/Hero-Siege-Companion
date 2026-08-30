import { ITEM_TYPE_NAMES } from "../../../shared/constants";
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
import {
  DEFAULT_THEME_ACCENTS,
  DEFAULT_THEME_ID,
  normalizeThemeAccents,
  normalizeThemeForegroundFillMap,
  normalizeThemeId,
  normalizeThemeTextureMap,
  normalizeThemeTokenMaps,
  themeHasCustomization,
  type ThemeAccentMap,
  type ThemeForegroundFillMap,
  type ThemeId,
  type ThemeTextureMap,
  type ThemeTokenMaps,
} from "./themes";

export interface UiPreferences {
  schemaVersion: number;
  logLimit: number;
  timelineLimit: number;
  showCaptureDetails: boolean;
  alwaysOnTop: boolean;
  lockCompactLocation: boolean;
  hideSocketables: boolean;
  hideKeys: boolean;
  hideMaterials: boolean;
  hideUnfilteredTimelineItems: boolean;
  timelineType: string;
  shoppingListItems: string[];
  gameExecutablePath: string;
  launchThroughSteam: boolean;
  themeId: ThemeId;
  compactThemeId: ThemeId;
  themeCustomMode: boolean;
  compactThemeCustomMode: boolean;
  compactThemeMatchesApp: boolean;
  themeAccents: ThemeAccentMap;
  themeTextures: ThemeTextureMap;
  compactThemeTextures: ThemeTextureMap;
  themeForegroundFills: ThemeForegroundFillMap;
  compactThemeForegroundFills: ThemeForegroundFillMap;
  themeTokenMaps: ThemeTokenMaps;
  itemFilterGroups: ItemFilterGroup[];
  itemFilterMuted: boolean;
  customItemFilterSounds: CustomItemFilterSound[];
  postRunReport: PostRunReportConfig;
  compactRunTiles: CompactRunTileConfig[];
  hiddenDashboardPanels: string[];
  developerItemResearchEnabled: boolean;
  unknownItemAudioPrompt: boolean;
  itemResearchEntries: ItemResearchEntry[];
}

export interface ConfigurationExportPayload {
  app: "hero-siege-companion";
  kind: "backup";
  version: 2;
  exportedAt: string;
  includes: {
    preferences: true;
    lootFilters: true;
    sounds: true;
    customThemes: true;
    layouts: true;
  };
  uiPreferences: Partial<UiPreferences>;
}

export interface ConfigurationImportResult {
  uiPreferences: UiPreferences;
}

export interface ConfigurationImportPreview {
  sourceVersion: number;
  settings: number;
  filterGroups: number;
  sounds: number;
  customThemes: number;
  compactTiles: number;
  legacyFormat: boolean;
}

type ConfigurationPayloadIdentity = {
  format: "backup-v2" | "configuration-v1" | "bare-preferences-v1";
  sourceVersion: 1 | 2;
  uiPreferences: Record<string, unknown>;
};

export const LOG_LIMIT_OPTIONS = [10, 20, 50, 100, 250, 500];
export const UI_PREFERENCES_SCHEMA_VERSION = 2;
const PREFERENCES_STORAGE_KEY = "hero-siege-companion:preferences:v1";

export const defaultPreferences: UiPreferences = {
  schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
  logLimit: 20,
  timelineLimit: 10,
  showCaptureDetails: false,
  alwaysOnTop: false,
  lockCompactLocation: true,
  hideSocketables: true,
  hideKeys: true,
  hideMaterials: true,
  hideUnfilteredTimelineItems: false,
  timelineType: "all",
  shoppingListItems: DEFAULT_SHOPPING_LIST,
  gameExecutablePath: "",
  launchThroughSteam: true,
  themeId: DEFAULT_THEME_ID,
  compactThemeId: DEFAULT_THEME_ID,
  themeCustomMode: false,
  compactThemeCustomMode: false,
  compactThemeMatchesApp: true,
  themeAccents: DEFAULT_THEME_ACCENTS,
  themeTextures: {},
  compactThemeTextures: {},
  themeForegroundFills: {},
  compactThemeForegroundFills: {},
  themeTokenMaps: {},
  itemFilterGroups: DEFAULT_ITEM_FILTER_GROUPS,
  itemFilterMuted: false,
  customItemFilterSounds: [],
  postRunReport: defaultPostRunReportConfig,
  compactRunTiles: defaultCompactRunTiles,
  hiddenDashboardPanels: [],
  developerItemResearchEnabled: false,
  unknownItemAudioPrompt: false,
  itemResearchEntries: [],
};

export function loadPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return normalizePreferences(defaultPreferences);
    return normalizePreferences(JSON.parse(raw) as Partial<UiPreferences>);
  } catch {
    return normalizePreferences(defaultPreferences);
  }
}

export function savePreferences(preferences: UiPreferences): boolean {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, serializeDurablePreferences(preferences));
    return true;
  } catch {
    // Preferences should never block the live tracker.
    return false;
  }
}

/**
 * Produces the canonical local-storage shape. Retired controls stay readable through
 * normalizePreferences() for migration, but they are never written back. Legacy
 * research survives only while there are still entries to export from Developers.
 */
export function serializeDurablePreferences(value: Partial<UiPreferences>): string {
  const preferences = normalizePreferences(value);
  const durablePreferences: Record<string, unknown> = {
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    hideSocketables: preferences.hideSocketables,
    hideKeys: preferences.hideKeys,
    hideMaterials: preferences.hideMaterials,
    hideUnfilteredTimelineItems: preferences.hideUnfilteredTimelineItems,
    timelineType: preferences.timelineType,
    shoppingListItems: preferences.shoppingListItems,
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
  };
  if (preferences.itemResearchEntries.length) {
    durablePreferences.itemResearchEntries = preferences.itemResearchEntries;
  }
  return JSON.stringify(durablePreferences);
}

export function createConfigurationExportPayload(
  uiPreferences: UiPreferences,
): ConfigurationExportPayload {
  const preferences = normalizePreferences(uiPreferences);
  const exportedUiPreferences: Partial<UiPreferences> = {
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    hideSocketables: preferences.hideSocketables,
    hideKeys: preferences.hideKeys,
    hideMaterials: preferences.hideMaterials,
    hideUnfilteredTimelineItems: preferences.hideUnfilteredTimelineItems,
    timelineType: preferences.timelineType,
    shoppingListItems: preferences.shoppingListItems,
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
  };

  return {
    app: "hero-siege-companion",
    kind: "backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    includes: {
      preferences: true,
      lootFilters: true,
      sounds: true,
      customThemes: true,
      layouts: true,
    },
    uiPreferences: exportedUiPreferences,
  };
}

export function importConfigurationPayload(
  rawPayload: string | unknown,
  currentPreferences: UiPreferences,
): ConfigurationImportResult {
  const identity = identifyConfigurationPayload(rawPayload);
  const rawUiPreferences = identity.uiPreferences;
  const nextUiPreferences: Partial<UiPreferences> = { ...currentPreferences };
  for (const key of RESTORABLE_PREFERENCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rawUiPreferences, key)) {
      Object.assign(nextUiPreferences, { [key]: rawUiPreferences[key] });
    }
  }
  nextUiPreferences.schemaVersion = identity.sourceVersion;
  nextUiPreferences.customItemFilterSounds = identity.format === "backup-v2"
    ? normalizeCustomItemFilterSounds(rawUiPreferences.customItemFilterSounds)
    : Object.prototype.hasOwnProperty.call(rawUiPreferences, "customItemFilterSounds")
      ? normalizeCustomItemFilterSounds(rawUiPreferences.customItemFilterSounds)
      : currentPreferences.customItemFilterSounds;
  nextUiPreferences.itemResearchEntries = currentPreferences.itemResearchEntries;
  nextUiPreferences.developerItemResearchEnabled = false;
  nextUiPreferences.unknownItemAudioPrompt = false;

  return {
    uiPreferences: normalizePreferences(nextUiPreferences),
  };
}

export function createConfigurationImportPreview(rawPayload: string | unknown): ConfigurationImportPreview {
  const identity = identifyConfigurationPayload(rawPayload);
  const rawUiPreferences = identity.uiPreferences;
  const accents = normalizeThemeAccents(rawUiPreferences.themeAccents);
  const tokens = normalizeThemeTokenMaps(rawUiPreferences.themeTokenMaps);
  const textures = normalizeThemeTextureMap(rawUiPreferences.themeTextures);
  const compactTextures = normalizeThemeTextureMap(rawUiPreferences.compactThemeTextures);
  const fills = normalizeThemeForegroundFillMap(rawUiPreferences.themeForegroundFills);
  const compactFills = normalizeThemeForegroundFillMap(rawUiPreferences.compactThemeForegroundFills);
  const customThemes = THEME_IDS.filter((themeId) => themeHasCustomization(themeId, accents, tokens, textures, fills)).length
    + THEME_IDS.filter((themeId) => themeHasCustomization(themeId, accents, tokens, compactTextures, compactFills)).length;
  return {
    sourceVersion: identity.sourceVersion,
    settings: ["launchThroughSteam", "gameExecutablePath", "themeId", "compactThemeId"]
      .filter((key) => Object.prototype.hasOwnProperty.call(rawUiPreferences, key)).length,
    filterGroups: Array.isArray(rawUiPreferences.itemFilterGroups) ? rawUiPreferences.itemFilterGroups.length : 0,
    sounds: Array.isArray(rawUiPreferences.customItemFilterSounds) ? rawUiPreferences.customItemFilterSounds.length : 0,
    customThemes,
    compactTiles: Array.isArray(rawUiPreferences.compactRunTiles) ? rawUiPreferences.compactRunTiles.length : 0,
    legacyFormat: identity.format !== "backup-v2",
  };
}

export function createFactoryResetPreferences(
  currentPreferences: UiPreferences,
  options: { deleteItemFilters?: boolean } = {},
): UiPreferences {
  const current = normalizePreferences(currentPreferences);
  const reset = normalizePreferences(defaultPreferences);
  return normalizePreferences({
    ...reset,
    itemFilterGroups: options.deleteItemFilters ? defaultPreferences.itemFilterGroups : current.itemFilterGroups,
    itemFilterMuted: options.deleteItemFilters ? defaultPreferences.itemFilterMuted : current.itemFilterMuted,
    customItemFilterSounds: current.customItemFilterSounds,
    itemResearchEntries: current.itemResearchEntries,
  });
}

const RESTORABLE_PREFERENCE_KEYS: Array<keyof UiPreferences> = [
  "hideSocketables",
  "hideKeys",
  "hideMaterials",
  "hideUnfilteredTimelineItems",
  "timelineType",
  "shoppingListItems",
  "gameExecutablePath",
  "launchThroughSteam",
  "themeId",
  "compactThemeId",
  "themeCustomMode",
  "compactThemeCustomMode",
  "compactThemeMatchesApp",
  "themeAccents",
  "themeTextures",
  "compactThemeTextures",
  "themeForegroundFills",
  "compactThemeForegroundFills",
  "themeTokenMaps",
  "itemFilterGroups",
  "itemFilterMuted",
  "postRunReport",
  "compactRunTiles",
  "hiddenDashboardPanels",
];

const THEME_IDS = Object.keys(DEFAULT_THEME_ACCENTS) as ThemeId[];

export function normalizePreferences(value: Partial<UiPreferences>): UiPreferences {
  const sourceSchemaVersion = value.schemaVersion === undefined
    ? 1
    : Number(value.schemaVersion);
  const validTimelineType =
    value.timelineType === "all" ||
    Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAMES, Number(value.timelineType)) ||
    itemFilterIdFromTimelineValue(String(value.timelineType ?? ""))
      ? String(value.timelineType)
      : defaultPreferences.timelineType;
  const customItemFilterSounds = normalizeCustomItemFilterSounds(value.customItemFilterSounds);
  const themeId = normalizeThemeId(value.themeId);
  const compactThemeId = normalizeThemeId(value.compactThemeId ?? value.themeId);
  const themeAccents = normalizeThemeAccents(value.themeAccents);
  const themeTextures = normalizeThemeTextureMap(value.themeTextures);
  const compactThemeTextures = normalizeThemeTextureMap(value.compactThemeTextures);
  const themeForegroundFills = normalizeThemeForegroundFillMap(value.themeForegroundFills);
  const compactThemeForegroundFills = normalizeThemeForegroundFillMap(value.compactThemeForegroundFills);
  const themeTokenMaps = normalizeThemeTokenMaps(value.themeTokenMaps);
  const legacyPreferences = Number.isFinite(sourceSchemaVersion) && sourceSchemaVersion < UI_PREFERENCES_SCHEMA_VERSION;
  const appHasCustomTheme = themeHasCustomization(
    themeId,
    themeAccents,
    themeTokenMaps,
    themeTextures,
    themeForegroundFills,
  );
  const compactHasCustomTheme = themeHasCustomization(
    compactThemeId,
    themeAccents,
    themeTokenMaps,
    compactThemeTextures,
    compactThemeForegroundFills,
  );

  return {
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    logLimit: defaultPreferences.logLimit,
    timelineLimit: defaultPreferences.timelineLimit,
    showCaptureDetails: false,
    alwaysOnTop: false,
    lockCompactLocation: true,
    hideSocketables: Boolean(value.hideSocketables),
    hideKeys: Boolean(value.hideKeys),
    hideMaterials: Boolean(value.hideMaterials),
    hideUnfilteredTimelineItems: Boolean(value.hideUnfilteredTimelineItems),
    timelineType: validTimelineType,
    shoppingListItems: normalizeShoppingList(value.shoppingListItems),
    gameExecutablePath: typeof value.gameExecutablePath === "string" ? value.gameExecutablePath : defaultPreferences.gameExecutablePath,
    launchThroughSteam: value.launchThroughSteam === undefined ? defaultPreferences.launchThroughSteam : Boolean(value.launchThroughSteam),
    themeId,
    compactThemeId,
    themeCustomMode: appHasCustomTheme && (legacyPreferences || Boolean(value.themeCustomMode)),
    compactThemeCustomMode: compactHasCustomTheme && (legacyPreferences || Boolean(value.compactThemeCustomMode)),
    compactThemeMatchesApp: legacyPreferences
      ? false
      : value.compactThemeMatchesApp === undefined
        ? defaultPreferences.compactThemeMatchesApp
        : Boolean(value.compactThemeMatchesApp),
    themeAccents,
    themeTextures,
    compactThemeTextures,
    themeForegroundFills,
    compactThemeForegroundFills,
    themeTokenMaps,
    itemFilterGroups: normalizeItemFilterGroups(value.itemFilterGroups, customItemFilterSounds),
    itemFilterMuted: Boolean(value.itemFilterMuted),
    customItemFilterSounds,
    postRunReport: normalizePostRunReportConfig(value.postRunReport),
    compactRunTiles: normalizeCompactRunTiles(value.compactRunTiles),
    hiddenDashboardPanels: normalizeHiddenDashboardPanels(value.hiddenDashboardPanels),
    developerItemResearchEnabled: false,
    unknownItemAudioPrompt: false,
    itemResearchEntries: normalizeItemResearchEntries(value.itemResearchEntries),
  };
}

function normalizeHiddenDashboardPanels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String))).filter((panel) => panel === "item-timeline" || panel === "live-log");
}

export function normalizeShoppingList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : DEFAULT_SHOPPING_LIST;
  const normalized = values.map((item) => String(item).trim()).filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 100);
}

function identifyConfigurationPayload(rawPayload: string | unknown): ConfigurationPayloadIdentity {
  const parsed = typeof rawPayload === "string" ? JSON.parse(rawPayload) as unknown : rawPayload;
  if (!isRecord(parsed)) throw new Error("Configuration must be a JSON object.");

  const hasEnvelopeMarker = ["app", "kind", "version", "uiPreferences"]
    .some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  if (hasEnvelopeMarker) {
    if (parsed.app !== "hero-siege-companion" || !isRecord(parsed.uiPreferences)) {
      throw new Error("Configuration identity is not supported.");
    }
    if (parsed.kind === "backup" && parsed.version === 2) {
      return { format: "backup-v2", sourceVersion: 2, uiPreferences: parsed.uiPreferences };
    }
    if (parsed.kind === "configuration" && parsed.version === 1) {
      return { format: "configuration-v1", sourceVersion: 1, uiPreferences: parsed.uiPreferences };
    }
    throw new Error("Configuration kind or version is not supported.");
  }

  const schemaVersion = parsed.schemaVersion === undefined ? 1 : Number(parsed.schemaVersion);
  const hasKnownPreference = BARE_LEGACY_PREFERENCE_KEYS
    .some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  if (schemaVersion !== 1 || !hasKnownPreference) {
    throw new Error("Legacy preferences are not recognized.");
  }
  return { format: "bare-preferences-v1", sourceVersion: 1, uiPreferences: parsed };
}

const BARE_LEGACY_PREFERENCE_KEYS: Array<keyof UiPreferences> = [
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
  "themeTextures",
  "compactThemeTextures",
  "themeForegroundFills",
  "compactThemeForegroundFills",
  "themeTokenMaps",
  "itemFilterGroups",
  "itemFilterMuted",
  "customItemFilterSounds",
  "postRunReport",
  "compactRunTiles",
  "developerItemResearchEnabled",
  "unknownItemAudioPrompt",
  "itemResearchEntries",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
