import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { DEFAULT_ITEM_FILTER_GROUPS, normalizeItemFilterGroups, type ItemFilterGroup } from "./item-filters";
import { DEFAULT_SHOPPING_LIST } from "./item-options";

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
  itemFilterGroups: ItemFilterGroup[];
  itemFilterMuted: boolean;
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
  itemFilterGroups: DEFAULT_ITEM_FILTER_GROUPS,
  itemFilterMuted: false,
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

export function savePreferences(preferences: UiPreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences should never block the live tracker.
  }
}

function normalizePreferences(value: Partial<UiPreferences>): UiPreferences {
  const validLogLimit = LOG_LIMIT_OPTIONS.includes(Number(value.logLimit)) ? Number(value.logLimit) : defaultPreferences.logLimit;
  const validTimelineLimit = LOG_LIMIT_OPTIONS.includes(Number(value.timelineLimit))
    ? Number(value.timelineLimit)
    : defaultPreferences.timelineLimit;
  const validTimelineType =
    value.timelineType === "all" || Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAMES, Number(value.timelineType))
      ? String(value.timelineType)
      : defaultPreferences.timelineType;

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
    itemFilterGroups: normalizeItemFilterGroups(value.itemFilterGroups),
    itemFilterMuted: Boolean(value.itemFilterMuted),
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
