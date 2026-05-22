<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { CapturePreferences, CompanionState, LogEntry, RunArchivePreferences } from "../../shared/app-state";
import { ITEM_TYPE_NAMES, MATERIAL_LIKE_TIMELINE_TYPES } from "../../shared/constants";
import { allItemIconNames, lookupItemIconFile } from "../../shared/item-icons";
import { allItemTranslations, type ItemTranslation } from "../../shared/item-lookup";
import { allStackItemTranslations } from "../../shared/stack-item-lookup";
import { createInitialStats, type ItemDropCounter, type ItemTimelineEntry, type PastRunSummary, type ResourceCounter } from "../../shared/stats";

const state = ref<CompanionState>({
  captureRunning: false,
  captureStatus: "idle",
  captureError: null,
  connections: [],
  health: {
    npcapService: "Unknown",
    winPcapCompatible: false,
    adminOnly: false,
    device: null,
    filter: "",
    packetsSeen: 0,
    payloadsAssembled: 0,
    messagesDecoded: 0,
    parsedEvents: 0,
    parserErrors: 0,
    parserRestarts: 0,
    lastParserError: null,
  },
  stats: createInitialStats(),
  pastRuns: [],
  runArchivePreferences: {
    skipEmptyRuns: false,
    minDurationMinutes: 0,
  },
  capturePreferences: {
    createDebugMode: false,
  },
  logs: [],
});

const now = ref(Date.now());
let unsubscribe: (() => void) | null = null;
let clock: number | null = null;
const logLimit = ref(20);
const logLimitOptions = [10, 20, 50, 100, 250, 500];
const timelineLimit = ref(10);
const showCaptureDetails = ref(false);
const showSettings = ref(false);
const showCompactShopping = ref(false);
const alwaysOnTop = ref(false);
const compactMode = ref(false);
const lockCompactLocation = ref(false);
const hideSocketables = ref(false);
const hideKeys = ref(false);
const hideMaterials = ref(false);
const timelineType = ref("all");
const gameExecutablePath = ref("");
const launchThroughSteam = ref(true);
const activeTab = ref<"live" | "past" | "filter">("live");
const appVersion = "0.0.9";
const expandedLogIds = ref<Set<string>>(new Set());
const draftLogLimit = ref(20);
const draftTimelineLimit = ref(10);
const draftShowCaptureDetails = ref(false);
const draftAlwaysOnTop = ref(false);
const draftLockCompactLocation = ref(false);
const draftHideSocketables = ref(false);
const draftHideKeys = ref(false);
const draftHideMaterials = ref(false);
const draftTimelineType = ref("all");
const draftGameExecutablePath = ref("");
const draftLaunchThroughSteam = ref(true);
const draftCreateDebugMode = ref(false);
const draftSkipEmptyRuns = ref(false);
const draftMinRunDurationMinutes = ref(0);
const shoppingListItems = ref<string[]>([]);
const shoppingDraftItem = ref("");
const itemFilterGroups = ref<ItemFilterGroup[]>([]);
const itemFilterMuted = ref(false);
const itemFilterDraftItem = ref("");
const itemFilterDraftGroupName = ref("");
const activeItemFilterGroupId = ref("");
const lastItemFilterMatch = ref<ItemFilterMatch | null>(null);
const activeShoppingIndex = ref(0);
const copiedShoppingItem = ref("");
const expandedDropRarity = ref<string | null>(null);
const expandedPastRunDropKey = ref<string | null>(null);
let toastTimer: number | null = null;
const PREFERENCES_STORAGE_KEY = "hero-siege-companion:preferences:v1";
const DEFAULT_SHOPPING_LIST = ["Copper Ore", "Iron Ore", "Gold Ore", "Ruby", "Jade", "Tarethium Ore"];
const SHOPPING_SUGGESTION_LIMIT = 8;
const ITEM_FILTER_SUGGESTION_LIMIT = 12;
const TRACKED_RARITY_ORDER = ["Set", "Satanic", "Heroic", "Angelic"];
const ITEM_FILTER_RARITIES = ["Set", "Satanic", "Heroic", "Angelic", "Unholy", "Runeword"];
const ITEM_FILTER_SOUNDS = [
  { id: "crystal-tink", name: "Crystal Tink" },
  { id: "coin-ping", name: "Coin Ping" },
  { id: "bell-chime", name: "Bell Chime" },
  { id: "rune-spark", name: "Rune Spark" },
  { id: "deep-gong", name: "Deep Gong" },
  { id: "soft-pop", name: "Soft Pop" },
  { id: "bright-cascade", name: "Bright Cascade" },
  { id: "low-pulse", name: "Low Pulse" },
] as const;
const DEFAULT_ITEM_FILTER_GROUPS: ItemFilterGroup[] = [
  {
    id: "sample-group",
    name: "Sample Group",
    enabled: true,
    soundId: "crystal-tink",
    volume: 70,
    cooldownMs: 1200,
    rarities: ["Heroic"],
    types: [],
    items: [],
  },
];
const itemFilterSeenTimelineKeys = new Set<string>();
const itemFilterLastPlayedAt = new Map<string, number>();
let audioContext: AudioContext | null = null;
const itemNameOptions = itemNameOptionList();
const itemNameOptionByNormalizedName = new Map(itemNameOptions.map((option) => [normalizeLookupText(option.name), option]));
const shoppingAutocompleteNames = itemNameOptions.map((option) => option.name);
const itemIconImages = import.meta.glob("../../../img/items/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const oreImages: Record<string, string> = {
  "Copper Ore": new URL("../../../img/Material_Copper_Ore.webp", import.meta.url).href,
  "Iron Ore": new URL("../../../img/Material_Iron_Ore.webp", import.meta.url).href,
  "Gold Ore": new URL("../../../img/Material_Gold_Ore.webp", import.meta.url).href,
  Ruby: new URL("../../../img/Material_Ruby_Ore.webp", import.meta.url).href,
  Jade: new URL("../../../img/Material_Jade_Ore.webp", import.meta.url).href,
  "Tarethium Ore": new URL("../../../img/Material_Tarethium_Ore.png", import.meta.url).href,
};
const keyImages: Record<string, string> = {
  "Crystal Key": new URL("../../../img/keys/Keys_Crystal_Key.png", import.meta.url).href,
  "Bifröst Key": new URL("../../../img/keys/Keys_Bifr_st_Key.png", import.meta.url).href,
  "Smelly Cheese": new URL("../../../img/keys/Keys_Smelly_Cheese.png", import.meta.url).href,
  "Cellar Key": new URL("../../../img/keys/Keys_Cellar_Key.png", import.meta.url).href,
  "Tower Key": new URL("../../../img/keys/Keys_Tower_Key.png", import.meta.url).href,
  "Frosted Key": new URL("../../../img/keys/Keys_Frosted_Key.png", import.meta.url).href,
  "Copper Key": new URL("../../../img/keys/Keys_Copper_Key.png", import.meta.url).href,
  "Mystic Key": new URL("../../../img/keys/Keys_Mystic_Key.png", import.meta.url).href,
  "Rusted Key": new URL("../../../img/keys/Keys_Rusted_Key.png", import.meta.url).href,
  "Shovel Key": new URL("../../../img/keys/Keys_Shovel_Key.png", import.meta.url).href,
  "Ancient Key": new URL("../../../img/keys/Keys_Ancient_Key.png", import.meta.url).href,
  "Tomb Key": new URL("../../../img/keys/Keys_Tomb_Key.png", import.meta.url).href,
  "Devil's Key": new URL("../../../img/keys/Keys_Devils_Key.png", import.meta.url).href,
  Pickaxe: new URL("../../../img/keys/Keys_Pickaxe_Key.png", import.meta.url).href,
  "Battle Key": new URL("../../../img/keys/Keys_Battle_Key.png", import.meta.url).href,
  "Garden Key": new URL("../../../img/keys/Keys_Garden_Key.png", import.meta.url).href,
  "Golden Key": new URL("../../../img/keys/Keys_Golden_Key.png", import.meta.url).href,
  "Axe Key": new URL("../../../img/keys/Keys_Axe_Key.png", import.meta.url).href,
  "Valor Key": new URL("../../../img/keys/Keys_Valor_Key.png", import.meta.url).href,
  "Naga Scale Key": new URL("../../../img/keys/Keys_Naga_Scale_Key.png", import.meta.url).href,
  "Magma Key": new URL("../../../img/keys/Keys_Magma_Key.png", import.meta.url).href,
  "Helflame Torch": new URL("../../../img/keys/Keys_Helflame_Torch.png", import.meta.url).href,
  "Warp Key": new URL("../../../img/keys/Keys_Warp_Key.png", import.meta.url).href,
  "Storage Key": new URL("../../../img/keys/Keys_Storage_Key.png", import.meta.url).href,
};

interface UiPreferences {
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

interface ItemFilterSpecificItem {
  name: string;
  soundId: string;
  typeLabel: string;
}

interface ItemFilterGroup {
  id: string;
  name: string;
  enabled: boolean;
  soundId: string;
  volume: number;
  cooldownMs: number;
  rarities: string[];
  types: number[];
  items: ItemFilterSpecificItem[];
}

interface ItemFilterMatch {
  itemLabel: string;
  groupName: string;
  soundName: string;
  createdAt: number;
}

interface PastRunAggregate {
  runCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  totalGold: number;
  totalXp: number;
  goldPerHour: number;
  xpPerHour: number;
  bestGoldPerHour: number;
  bestXpPerHour: number;
  totalKeys: number;
  totalOres: number;
  totalMfDrops: number;
  drops: Array<{ rarity: string; total: number; mf: number; unique: number }>;
  topDrops: ItemDropCounter[];
}

const defaultPreferences: UiPreferences = {
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

const itemTypeOptions = computed(() =>
  Object.entries(ITEM_TYPE_NAMES)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

function itemNameOptionList(): Array<{ name: string; typeLabel: string; sortName: string }> {
  const options = new Map<string, { name: string; typeLabel: string; sortName: string }>();
  const addOption = (name: string, typeLabel: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = normalizeLookupText(trimmed);
    const existing = options.get(key);
    if (!existing || typeLabel !== "Item") {
      options.set(key, { name: trimmed, typeLabel, sortName: normalizeSortText(trimmed) });
    }
  };

  for (const name of DEFAULT_SHOPPING_LIST) addOption(name, inferredItemTypeLabel(name));
  for (const item of allStackItemTranslations()) addOption(item.name, itemTypeLabelFromTranslation(item));
  for (const item of allItemTranslations()) addOption(item.name, itemTypeLabelFromTranslation(item));
  for (const name of allItemIconNames()) addOption(name, inferredItemTypeLabel(name));

  return Array.from(options.values()).sort((a, b) => a.typeLabel.localeCompare(b.typeLabel) || a.sortName.localeCompare(b.sortName));
}

function itemTypeLabelFromTranslation(item: ItemTranslation): string {
  return ITEM_TYPE_NAMES[item.type] ?? "Item";
}

function inferredItemTypeLabel(name: string): string {
  const normalized = normalizeLookupText(name);
  if (normalized.includes("key")) return "Key";
  if (normalized.includes("ore") || ["ruby", "jade"].includes(normalized)) return "Material";
  return "Item";
}

function normalizeLookupText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeSortText(value: string): string {
  return normalizeLookupText(value).replace(/^(?:the|a|an) /, "");
}

const captureStatusLabel = computed(() => {
  if (state.value.captureStatus === "running") return "Capturing";
  if (state.value.captureStatus === "waiting") return "Waiting for Hero Siege";
  if (state.value.captureStatus === "error") return "Needs attention";
  return "Idle";
});

const sessionDuration = computed(() => formatDuration(now.value - state.value.stats.sessionStartedAt));
const currentGoldLabel = computed(() => (state.value.stats.seasonMode ? formatNumber(state.value.stats.totalGold) : "pending"));
const nextZoneAt = computed(() => {
  const date = new Date(now.value);
  const minutes = date.getMinutes();
  const nextMinute = minutes < 30 ? 30 : 60;
  const next = new Date(date);
  next.setMinutes(nextMinute, 0, 0);
  return next;
});
const zoneCountdown = computed(() => formatDuration(Math.max(nextZoneAt.value.getTime() - now.value, 0)));
const zoneResetLabel = computed(() => nextZoneAt.value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
const compactClock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
const keyDropTotal = computed(() => resourceRecordTotal(state.value.stats.keys));
const oreDropTotal = computed(() => resourceRecordTotal(state.value.stats.ores));
const trackedItems = computed(() => {
  return TRACKED_RARITY_ORDER.map((rarity) => ({
    rarity,
    total: state.value.stats.items[rarity]?.total ?? 0,
    mf: state.value.stats.items[rarity]?.mf ?? 0,
    perHour: state.value.stats.itemsPerHour[rarity] ?? 0,
    drops: itemDropBreakdown(rarity),
  }));
});
const compactTrackedItems = computed(() => trackedItems.value.filter((item) => item.total > 0 || ["Set", "Satanic", "Heroic", "Angelic"].includes(item.rarity)));
const filteredItemTimeline = computed(() =>
  state.value.stats.itemTimeline.filter((item) => {
    if (hideKeys.value && item.type === 12) return false;
    if (hideMaterials.value && MATERIAL_LIKE_TIMELINE_TYPES.has(item.type)) return false;
    if (hideSocketables.value && item.type === 15) return false;
    if (timelineType.value !== "all" && item.type !== Number(timelineType.value)) return false;
    return true;
  }),
);
const visibleItemTimeline = computed(() => filteredItemTimeline.value.slice(0, timelineLimit.value));
const recentLogs = computed(() => state.value.logs.slice(0, logLimit.value));
const pastRuns = computed(() => state.value.pastRuns ?? []);
const allRunAggregate = computed(() => aggregatePastRuns(pastRuns.value));
const recentRunAggregate = computed(() => aggregatePastRuns(pastRuns.value.slice(0, 10)));
const aggregatePanels = computed(() => [
  { key: "all", title: "All Runs", subtitle: `${allRunAggregate.value.runCount} saved`, aggregate: allRunAggregate.value },
  { key: "recent", title: "Last 10 Runs", subtitle: `${recentRunAggregate.value.runCount} included`, aggregate: recentRunAggregate.value },
]);
const activeShoppingItem = computed(() => shoppingListItems.value[activeShoppingIndex.value] ?? shoppingListItems.value[0] ?? "");
const activeItemFilterGroups = computed(() => itemFilterGroups.value.filter((group) => group.enabled));
const watchedItemCount = computed(() => itemFilterGroups.value.reduce((total, group) => total + new Set(group.items.map((item) => normalizeLookupText(item.name))).size, 0));
const selectedItemFilterGroup = computed(() => itemFilterGroups.value.find((group) => group.id === activeItemFilterGroupId.value) ?? itemFilterGroups.value[0] ?? null);
const selectedItemFilterGroupedItems = computed(() => itemFilterGroupedItems(selectedItemFilterGroup.value));
const shoppingSuggestions = computed(() => {
  const query = shoppingDraftItem.value.trim().toLowerCase();
  const existing = new Set(shoppingListItems.value.map((item) => item.toLowerCase()));
  if (!query) return shoppingAutocompleteNames.filter((name) => !existing.has(name.toLowerCase())).slice(0, SHOPPING_SUGGESTION_LIMIT);
  return shoppingAutocompleteNames
    .filter((name) => !existing.has(name.toLowerCase()) && name.toLowerCase().includes(query))
    .slice(0, SHOPPING_SUGGESTION_LIMIT);
});
const itemFilterSuggestions = computed(() => {
  const query = normalizeLookupText(itemFilterDraftItem.value);
  if (query.length < 3) return [];
  const existing = new Set((selectedItemFilterGroup.value?.items ?? []).map((item) => normalizeLookupText(item.name)));
  return shoppingAutocompleteNames
    .filter((name) => !existing.has(normalizeLookupText(name)) && normalizeLookupText(name).includes(query))
    .slice(0, ITEM_FILTER_SUGGESTION_LIMIT);
});

onMounted(async () => {
  applyPreferences(loadPreferences());
  await syncWindowMode();
  state.value = await window.heroSiegeCompanion.getState();
  initializeItemFilterSeenItems(state.value.stats.itemTimeline);
  unsubscribe = window.heroSiegeCompanion.onStateUpdated((nextState) => {
    processItemFilterTimeline(nextState.stats.itemTimeline);
    state.value = nextState;
  });
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

watch([logLimit, timelineLimit, showCaptureDetails, hideSocketables, hideKeys, hideMaterials, timelineType, lockCompactLocation, shoppingListItems, itemFilterGroups, itemFilterMuted], () => {
  savePreferences(currentPreferences());
  clampActiveShoppingIndex();
  clampActiveItemFilterGroup();
}, { deep: true });

watch(compactMode, (enabled) => {
  if (!enabled) showCompactShopping.value = false;
});

onUnmounted(() => {
  unsubscribe?.();
  if (clock) window.clearInterval(clock);
  if (toastTimer) window.clearTimeout(toastTimer);
});

async function toggleCapture() {
  state.value = state.value.captureRunning
    ? await window.heroSiegeCompanion.stopCapture()
    : await window.heroSiegeCompanion.launchGameOrCapture({
        executablePath: currentPreferences().gameExecutablePath,
        launchThroughSteam: currentPreferences().launchThroughSteam,
      });
}

async function resetStats() {
  const previousRunCount = pastRuns.value.length;
  state.value = await window.heroSiegeCompanion.resetStats();
  if ((state.value.pastRuns?.length ?? 0) > previousRunCount) activeTab.value = "past";
}

async function minimizeWindow() {
  await window.heroSiegeCompanion.minimizeWindow();
}

async function toggleMaximizeWindow() {
  await window.heroSiegeCompanion.toggleMaximizeWindow();
}

async function closeWindow() {
  await window.heroSiegeCompanion.closeWindow();
}

function openSettings() {
  loadDraftPreferences(currentPreferences());
  showSettings.value = true;
}

function closeSettings() {
  showSettings.value = false;
}

function resetDraftPreferences() {
  loadDraftPreferences(defaultPreferences);
  draftCreateDebugMode.value = false;
}

async function applyDraftPreferences() {
  applyPreferences(currentDraftPreferences());
  savePreferences(currentPreferences());
  state.value = await window.heroSiegeCompanion.setRunArchivePreferences(currentDraftRunArchivePreferences());
  state.value = await window.heroSiegeCompanion.setCapturePreferences(currentDraftCapturePreferences());
  showSettings.value = false;
  await syncWindowMode();
}

async function toggleCompactMode() {
  compactMode.value = !compactMode.value;
  if (compactMode.value) showSettings.value = false;
  await syncWindowMode();
}

function currentPreferences(): UiPreferences {
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
    shoppingListItems: shoppingListItems.value,
    gameExecutablePath: gameExecutablePath.value,
    launchThroughSteam: launchThroughSteam.value,
    itemFilterGroups: itemFilterGroups.value,
    itemFilterMuted: itemFilterMuted.value,
  };
}

function applyPreferences(preferences: UiPreferences) {
  logLimit.value = preferences.logLimit;
  timelineLimit.value = preferences.timelineLimit;
  showCaptureDetails.value = preferences.showCaptureDetails;
  alwaysOnTop.value = preferences.alwaysOnTop;
  lockCompactLocation.value = preferences.lockCompactLocation;
  hideSocketables.value = preferences.hideSocketables;
  hideKeys.value = preferences.hideKeys;
  hideMaterials.value = preferences.hideMaterials;
  timelineType.value = preferences.timelineType;
  shoppingListItems.value = preferences.shoppingListItems;
  gameExecutablePath.value = preferences.gameExecutablePath;
  launchThroughSteam.value = preferences.launchThroughSteam;
  itemFilterGroups.value = preferences.itemFilterGroups;
  itemFilterMuted.value = preferences.itemFilterMuted;
  clampActiveShoppingIndex();
  clampActiveItemFilterGroup();
}

function currentDraftPreferences(): UiPreferences {
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
    shoppingListItems: shoppingListItems.value,
    gameExecutablePath: draftGameExecutablePath.value.trim(),
    launchThroughSteam: draftLaunchThroughSteam.value,
    itemFilterGroups: itemFilterGroups.value,
    itemFilterMuted: itemFilterMuted.value,
  };
}

function loadDraftPreferences(preferences: UiPreferences) {
  draftLogLimit.value = preferences.logLimit;
  draftTimelineLimit.value = preferences.timelineLimit;
  draftShowCaptureDetails.value = preferences.showCaptureDetails;
  draftAlwaysOnTop.value = preferences.alwaysOnTop;
  draftLockCompactLocation.value = preferences.lockCompactLocation;
  draftHideSocketables.value = preferences.hideSocketables;
  draftHideKeys.value = preferences.hideKeys;
  draftHideMaterials.value = preferences.hideMaterials;
  draftTimelineType.value = preferences.timelineType;
  draftGameExecutablePath.value = preferences.gameExecutablePath;
  draftLaunchThroughSteam.value = preferences.launchThroughSteam;
  draftCreateDebugMode.value = state.value.capturePreferences.createDebugMode;
  draftSkipEmptyRuns.value = state.value.runArchivePreferences.skipEmptyRuns;
  draftMinRunDurationMinutes.value = state.value.runArchivePreferences.minDurationMinutes;
}

function loadPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return normalizePreferences(defaultPreferences);
    return normalizePreferences(JSON.parse(raw) as Partial<UiPreferences>);
  } catch {
    return normalizePreferences(defaultPreferences);
  }
}

function savePreferences(preferences: UiPreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences should never block the live tracker.
  }
}

function normalizePreferences(value: Partial<UiPreferences>): UiPreferences {
  const validLogLimit = logLimitOptions.includes(Number(value.logLimit)) ? Number(value.logLimit) : defaultPreferences.logLimit;
  const validTimelineLimit = logLimitOptions.includes(Number(value.timelineLimit))
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

function normalizeRunDurationMinutes(value: number): number {
  const minutes = Number(value);
  return Number.isFinite(minutes) ? Math.max(0, Math.min(1440, Math.trunc(minutes))) : 0;
}

async function chooseGameExecutable() {
  const selected = await window.heroSiegeCompanion.chooseGameExecutable();
  if (!selected) return;
  draftGameExecutablePath.value = selected;
}

async function syncWindowMode() {
  await window.heroSiegeCompanion.setAlwaysOnTop(alwaysOnTop.value);
  await window.heroSiegeCompanion.setCompactMode(compactMode.value, lockCompactLocation.value);
}

async function copyShoppingItem(item: string, advance: boolean) {
  const trimmed = item.trim();
  if (!trimmed) return;
  await window.heroSiegeCompanion.writeClipboardText(trimmed);
  copiedShoppingItem.value = trimmed;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    copiedShoppingItem.value = "";
    toastTimer = null;
  }, 1600);

  const index = shoppingListItems.value.findIndex((candidate) => candidate === item);
  if (index >= 0) activeShoppingIndex.value = index;
  if (advance) moveToNextShoppingItem();
}

function addShoppingItem(value = shoppingDraftItem.value) {
  const trimmed = value.trim();
  const canonical = shoppingAutocompleteNames.find((name) => name.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
  const [normalized] = normalizeShoppingList([canonical]);
  if (!normalized) return;
  const exists = shoppingListItems.value.some((item) => item.toLowerCase() === normalized.toLowerCase());
  if (!exists) shoppingListItems.value = [...shoppingListItems.value, normalized];
  const index = shoppingListItems.value.findIndex((item) => item.toLowerCase() === normalized.toLowerCase());
  if (index >= 0) activeShoppingIndex.value = index;
  shoppingDraftItem.value = "";
}

function removeShoppingItem(item: string) {
  const index = shoppingListItems.value.findIndex((candidate) => candidate === item);
  shoppingListItems.value = shoppingListItems.value.filter((candidate) => candidate !== item);
  if (index >= 0 && activeShoppingIndex.value >= index) activeShoppingIndex.value = Math.max(0, activeShoppingIndex.value - 1);
  clampActiveShoppingIndex();
}

function moveToNextShoppingItem() {
  if (shoppingListItems.value.length === 0) return;
  activeShoppingIndex.value = (activeShoppingIndex.value + 1) % shoppingListItems.value.length;
}

function clampActiveShoppingIndex() {
  if (shoppingListItems.value.length === 0) {
    activeShoppingIndex.value = 0;
    return;
  }
  activeShoppingIndex.value = Math.min(activeShoppingIndex.value, shoppingListItems.value.length - 1);
}

function normalizeShoppingList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : DEFAULT_SHOPPING_LIST;
  const normalized = values.map((item) => String(item).trim()).filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 100);
}

function normalizeItemFilterGroups(value: unknown): ItemFilterGroup[] {
  const groups = Array.isArray(value) ? value : DEFAULT_ITEM_FILTER_GROUPS;
  const normalized = groups.map(normalizeItemFilterGroup).filter(Boolean) as ItemFilterGroup[];
  return normalized.length ? normalized.slice(0, 40) : structuredCloneCompat(DEFAULT_ITEM_FILTER_GROUPS);
}

function normalizeItemFilterGroup(value: unknown): ItemFilterGroup | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id") || `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const volume = Number(value.volume);
  const cooldownMs = Number(value.cooldownMs);
  return {
    id,
    name: stringField(value, "name") || "Untitled Group",
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    soundId: validSoundId(stringField(value, "soundId")) ? stringField(value, "soundId") : ITEM_FILTER_SOUNDS[0].id,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.trunc(volume))) : 70,
    cooldownMs: Number.isFinite(cooldownMs) ? Math.max(0, Math.min(30_000, Math.trunc(cooldownMs))) : 1000,
    rarities: normalizeStringList(value.rarities).filter((rarity) => ITEM_FILTER_RARITIES.includes(rarity)),
    types: normalizeNumberList(value.types).filter((type) => Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAMES, type)),
    items: normalizeSpecificItems(value.items),
  };
}

function normalizeSpecificItems(value: unknown): ItemFilterSpecificItem[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const items: ItemFilterSpecificItem[] = [];
  for (const item of values) {
    const name = typeof item === "string" ? item.trim() : isRecord(item) ? stringField(item, "name").trim() : "";
    if (!name) continue;
    const canonical = canonicalItemName(name);
    const normalizedName = normalizeLookupText(canonical);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const soundId = isRecord(item) && validSoundId(stringField(item, "soundId")) ? stringField(item, "soundId") : "";
    items.push({ name: canonical, soundId, typeLabel: itemTypeLabelForName(canonical) });
  }
  return sortSpecificItems(items).slice(0, 150);
}

function normalizeStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map((item) => String(item).trim()).filter(Boolean)));
}

function normalizeNumberList(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map(Number).filter(Number.isFinite).map(Math.trunc)));
}

function validSoundId(soundId: string): boolean {
  return ITEM_FILTER_SOUNDS.some((sound) => sound.id === soundId);
}

function soundName(soundId: string): string {
  return ITEM_FILTER_SOUNDS.find((sound) => sound.id === soundId)?.name ?? ITEM_FILTER_SOUNDS[0].name;
}

function addItemFilterGroup() {
  const name = itemFilterDraftGroupName.value.trim() || `Group ${itemFilterGroups.value.length + 1}`;
  const nextGroup: ItemFilterGroup = {
    id: `group-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    enabled: true,
    soundId: ITEM_FILTER_SOUNDS[0].id,
    volume: 70,
    cooldownMs: 1000,
    rarities: [],
    types: [],
    items: [],
  };
  itemFilterGroups.value = [...itemFilterGroups.value, nextGroup];
  activeItemFilterGroupId.value = nextGroup.id;
  itemFilterDraftGroupName.value = "";
}

function removeItemFilterGroup(group: ItemFilterGroup) {
  itemFilterGroups.value = itemFilterGroups.value.filter((candidate) => candidate.id !== group.id);
  clampActiveItemFilterGroup();
}

function selectItemFilterGroup(group: ItemFilterGroup) {
  activeItemFilterGroupId.value = group.id;
}

function addItemToFilterGroup(group: ItemFilterGroup, value = itemFilterDraftItem.value) {
  const trimmed = value.trim();
  const canonical = canonicalItemName(trimmed);
  if (!canonical) return;
  const normalizedName = normalizeLookupText(canonical);
  if (group.items.some((item) => normalizeLookupText(item.name) === normalizedName)) return;
  group.items = normalizeSpecificItems([...group.items, { name: canonical, soundId: "", typeLabel: itemTypeLabelForName(canonical) }]);
  itemFilterDraftItem.value = "";
}

function removeItemFromFilterGroup(group: ItemFilterGroup, item: ItemFilterSpecificItem) {
  const normalizedName = normalizeLookupText(item.name);
  group.items = group.items.filter((candidate) => normalizeLookupText(candidate.name) !== normalizedName);
}

function canonicalItemName(name: string): string {
  const trimmed = name.trim();
  return itemNameOptionByNormalizedName.get(normalizeLookupText(trimmed))?.name ?? trimmed;
}

function itemTypeLabelForName(name: string): string {
  return itemNameOptionByNormalizedName.get(normalizeLookupText(name))?.typeLabel ?? inferredItemTypeLabel(name);
}

function sortSpecificItems(items: ItemFilterSpecificItem[]): ItemFilterSpecificItem[] {
  return [...items].sort((a, b) => itemTypeLabelForName(a.name).localeCompare(itemTypeLabelForName(b.name)) || normalizeSortText(a.name).localeCompare(normalizeSortText(b.name)));
}

function itemFilterGroupedItems(group: ItemFilterGroup | null): Array<{ typeLabel: string; items: ItemFilterSpecificItem[] }> {
  if (!group) return [];
  const groups = new Map<string, ItemFilterSpecificItem[]>();
  const seen = new Set<string>();
  for (const item of sortSpecificItems(group.items)) {
    const canonical = canonicalItemName(item.name);
    const normalizedName = normalizeLookupText(canonical);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const typeLabel = itemTypeLabelForName(canonical);
    item.name = canonical;
    item.typeLabel = typeLabel;
    const items = groups.get(typeLabel) ?? [];
    items.push(item);
    groups.set(typeLabel, items);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([typeLabel, items]) => ({ typeLabel, items }));
}

function toggleFilterRarity(group: ItemFilterGroup, rarity: string, enabled: boolean) {
  const next = new Set(group.rarities);
  if (enabled) next.add(rarity);
  else next.delete(rarity);
  group.rarities = Array.from(next);
}

function toggleFilterType(group: ItemFilterGroup, type: number, enabled: boolean) {
  const next = new Set(group.types);
  if (enabled) next.add(type);
  else next.delete(type);
  group.types = Array.from(next).sort((a, b) => a - b);
}

function eventChecked(event: Event): boolean {
  return Boolean((event.target as HTMLInputElement | null)?.checked);
}

function clampActiveItemFilterGroup() {
  if (itemFilterGroups.value.length === 0) {
    activeItemFilterGroupId.value = "";
    return;
  }
  if (!itemFilterGroups.value.some((group) => group.id === activeItemFilterGroupId.value)) {
    activeItemFilterGroupId.value = itemFilterGroups.value[0].id;
  }
}

function initializeItemFilterSeenItems(items: ItemTimelineEntry[]) {
  itemFilterSeenTimelineKeys.clear();
  for (const item of items) itemFilterSeenTimelineKeys.add(itemTimelineKey(item));
}

function processItemFilterTimeline(items: ItemTimelineEntry[]) {
  const nextItems = items.filter((item) => !itemFilterSeenTimelineKeys.has(itemTimelineKey(item))).reverse();
  for (const item of nextItems) {
    itemFilterSeenTimelineKeys.add(itemTimelineKey(item));
    const match = matchItemFilter(item);
    if (match) handleItemFilterMatch(match);
  }
}

function matchItemFilter(item: ItemTimelineEntry): { group: ItemFilterGroup; soundId: string; item: ItemTimelineEntry } | null {
  const label = item.label || (item.id ? `#${item.id}` : "");
  const normalizedLabel = label.toLowerCase();
  const normalizedLookupLabel = normalizeLookupText(label);
  for (const group of activeItemFilterGroups.value) {
    const specificItem = group.items.find((candidate) => normalizeLookupText(candidate.name) === normalizedLookupLabel);
    if (specificItem) return { group, soundId: specificItem.soundId || group.soundId, item };
  }

  for (const group of activeItemFilterGroups.value) {
    const hasGroupCriteria = group.rarities.length > 0 || group.types.length > 0;
    if (!hasGroupCriteria) continue;
    const matchesRarity = group.rarities.length === 0 || group.rarities.some((rarity) => rarity.toLowerCase() === item.rarity.toLowerCase());
    const matchesType = group.types.length === 0 || group.types.includes(item.type);
    if (matchesRarity && matchesType) return { group, soundId: group.soundId, item };
  }

  return null;
}

function handleItemFilterMatch(match: { group: ItemFilterGroup; soundId: string; item: ItemTimelineEntry }) {
  const nowMs = Date.now();
  lastItemFilterMatch.value = {
    itemLabel: match.item.label || `Type ${match.item.type} #${match.item.id}`,
    groupName: match.group.name,
    soundName: soundName(match.soundId),
    createdAt: nowMs,
  };
  if (itemFilterMuted.value) return;
  const lastPlayedAt = itemFilterLastPlayedAt.get(match.group.id) ?? 0;
  if (nowMs - lastPlayedAt < match.group.cooldownMs) return;
  itemFilterLastPlayedAt.set(match.group.id, nowMs);
  void playItemFilterSound(match.soundId, match.group.volume).catch(() => {
    // Audio feedback should never interfere with capture or rendering.
  });
}

function itemTimelineKey(item: ItemTimelineEntry): string {
  return `${item.createdAt}:${item.fingerprint ?? ""}:${item.type}:${item.id}:${item.label}`;
}

async function testItemFilterSound(soundId = selectedItemFilterGroup.value?.soundId ?? ITEM_FILTER_SOUNDS[0].id, volume = selectedItemFilterGroup.value?.volume ?? 70) {
  try {
    await playItemFilterSound(soundId, volume);
  } catch (error) {
    // Some systems block audio until the next direct user gesture.
    console.warn("Item filter sound did not play", error);
  }
}

async function playItemFilterSound(soundId: string, volume: number) {
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = audioContext ?? new AudioContextClass();
  if (audioContext.state === "suspended") await audioContext.resume();
  const gain = audioContext.createGain();
  gain.gain.value = Math.max(0, Math.min(volume, 100)) / 100;
  gain.connect(audioContext.destination);
  playSoundPreset(audioContext, gain, soundId);
}

function playSoundPreset(context: AudioContext, output: GainNode, soundId: string) {
  const now = context.currentTime;
  if (soundId === "crystal-tink") {
    playImpactNoise(context, output, now, 1.95, 0.9, 360, 11_800, 0.035);
    playBell(context, output, now, [690, 1710, 4520, 5680, 6820, 9020], 2.02, 0.95);
    playTone(context, output, 3440, now + 0.018, 1.45, "square", 0.16, 5);
    return;
  }
  if (soundId === "coin-ping") {
    playImpactNoise(context, output, now, 1.05, 0.45, 620, 8200, 0.024);
    playBell(context, output, now, [880, 1760, 3520, 5280], 1.12, 0.55);
    return;
  }
  if (soundId === "bell-chime") {
    playImpactNoise(context, output, now, 1.55, 0.56, 420, 9200, 0.03);
    playBell(context, output, now, [520, 1040, 2080, 4160, 6240], 1.62, 0.68);
    return;
  }
  if (soundId === "rune-spark") {
    playImpactNoise(context, output, now, 1.72, 0.7, 820, 12_400, 0.026);
    [780, 1560, 3120, 4680, 6240, 9360].forEach((frequency, index) => {
      playTone(context, output, frequency, now + index * 0.018, 1.5 - index * 0.08, index % 2 === 0 ? "triangle" : "sawtooth", 0.52 / (index + 1), index % 2 === 0 ? 7 : -6);
    });
    return;
  }
  if (soundId === "deep-gong") {
    playImpactNoise(context, output, now, 1.45, 0.48, 90, 3600, 0.042);
    playBell(context, output, now, [132, 198, 396, 792, 1584], 1.6, 0.62);
    return;
  }
  if (soundId === "soft-pop") {
    playImpactNoise(context, output, now, 0.82, 0.28, 150, 2800, 0.032);
    playBell(context, output, now, [330, 660, 990], 0.75, 0.34);
    return;
  }
  if (soundId === "bright-cascade") {
    playImpactNoise(context, output, now, 1.9, 0.78, 740, 12_000, 0.024);
    [988, 1319, 1760, 2349, 3136, 4186].forEach((frequency, index) => {
      playTone(context, output, frequency * 1.35, now + index * 0.045, 1.65 - index * 0.1, index % 2 === 0 ? "sine" : "triangle", 0.58 / (index + 1), index % 2 === 0 ? -4 : 4);
    });
    return;
  }
  if (soundId === "low-pulse") {
    playImpactNoise(context, output, now, 1.05, 0.34, 60, 1800, 0.04);
    playBell(context, output, now, [82, 123, 246, 492], 1.05, 0.45);
    return;
  }

  playImpactNoise(context, output, now, 1.9, 0.8, 360, 11_000, 0.03);
  playBell(context, output, now, [690, 1710, 4520, 5680, 6820], 1.95, 0.88);
}

function playBell(context: AudioContext, output: GainNode, start: number, frequencies: number[], duration: number, level: number) {
  frequencies.forEach((frequency, index) => {
    playTone(
      context,
      output,
      frequency,
      start + index * 0.012,
      duration * (1 - index * 0.08),
      index % 2 === 0 ? "sine" : "triangle",
      level / (index + 1),
      index % 2 === 0 ? 0 : 7,
    );
  });
}

function playTone(
  context: AudioContext,
  output: GainNode,
  frequency: number,
  start: number,
  duration: number,
  type: OscillatorType,
  level: number,
  detune = 0,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.detune.value = detune;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), start + 0.006);
  gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.34, 0.0001), start + Math.min(0.16, duration * 0.22));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(output);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playImpactNoise(
  context: AudioContext,
  output: GainNode,
  start: number,
  duration: number,
  level: number,
  lowCut: number,
  highCut: number,
  attackSeconds: number,
) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / frameCount;
    const decay = Math.exp(-progress * 5.2);
    const attackBoost = progress < 0.035 ? 1.9 : 1;
    data[index] = (Math.random() * 2 - 1) * decay * attackBoost;
  }

  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const peaking = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  highpass.type = "highpass";
  highpass.frequency.value = lowCut;
  lowpass.type = "lowpass";
  lowpass.frequency.value = highCut;
  peaking.type = "peaking";
  peaking.frequency.value = 5600;
  peaking.Q.value = 1.4;
  peaking.gain.value = 7;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), start + attackSeconds);
  gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.2, 0.0001), start + Math.min(0.22, duration * 0.24));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(peaking);
  peaking.connect(gain);
  gain.connect(output);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function structuredCloneCompat<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toggleDropBreakdown(rarity: string) {
  expandedDropRarity.value = expandedDropRarity.value === rarity ? null : rarity;
}

function togglePastRunDropBreakdown(run: PastRunSummary, rarity: string) {
  const key = pastRunDropKey(run, rarity);
  expandedPastRunDropKey.value = expandedPastRunDropKey.value === key ? null : key;
}

function itemDropBreakdown(rarity: string): ItemDropCounter[] {
  const breakdown = state.value.stats.itemBreakdown?.[rarity] ?? {};
  return sortedDropBreakdown(breakdown);
}

function runTrackedItems(run: PastRunSummary) {
  return TRACKED_RARITY_ORDER.map((rarity) => ({
    rarity,
    total: runDropTotal(run, rarity),
    mf: runDropMf(run, rarity),
    drops: runDropBreakdown(run, rarity),
  }));
}

function runDropTotal(run: PastRunSummary, rarity: string): number {
  if (rarity === "Set") return run.setDrops ?? breakdownTotal(run.itemBreakdown?.Set);
  if (rarity === "Satanic") return run.satanicDrops ?? breakdownTotal(run.itemBreakdown?.Satanic);
  if (rarity === "Heroic") return run.heroicDrops ?? breakdownTotal(run.itemBreakdown?.Heroic);
  if (rarity === "Angelic") return run.angelicDrops ?? breakdownTotal(run.itemBreakdown?.Angelic);
  return breakdownTotal(run.itemBreakdown?.[rarity]);
}

function runDropMf(run: PastRunSummary, rarity: string): number {
  return Object.values(run.itemBreakdown?.[rarity] ?? {}).reduce((total, drop) => total + drop.mf, 0);
}

function runDropBreakdown(run: PastRunSummary, rarity: string): ItemDropCounter[] {
  return sortedDropBreakdown(run.itemBreakdown?.[rarity] ?? {});
}

function aggregatePastRuns(runs: PastRunSummary[]): PastRunAggregate {
  const aggregateDrops: Record<string, ItemDropCounter> = {};
  const rarityDrops = TRACKED_RARITY_ORDER.map((rarity) => {
    let total = 0;
    let mf = 0;
    const uniqueNames = new Set<string>();
    for (const run of runs) {
      total += runDropTotal(run, rarity);
      const drops = runDropBreakdown(run, rarity);
      for (const drop of drops) {
        uniqueNames.add(drop.name);
        mf += drop.mf;
        aggregateDrops[drop.name] = aggregateDrops[drop.name] ?? { name: drop.name, total: 0, mf: 0 };
        aggregateDrops[drop.name].total += drop.total;
        aggregateDrops[drop.name].mf += drop.mf;
      }
    }
    return { rarity, total, mf, unique: uniqueNames.size };
  });
  const totalDurationMs = runs.reduce((total, run) => total + Math.max(run.durationMs, 0), 0);
  const totalGold = runs.reduce((total, run) => total + run.totalGoldGained, 0);
  const totalXp = runs.reduce((total, run) => total + run.totalXpGained, 0);

  return {
    runCount: runs.length,
    totalDurationMs,
    averageDurationMs: runs.length ? totalDurationMs / runs.length : 0,
    totalGold,
    totalXp,
    goldPerHour: ratePerHour(totalGold, totalDurationMs),
    xpPerHour: ratePerHour(totalXp, totalDurationMs),
    bestGoldPerHour: Math.max(0, ...runs.map((run) => ratePerHour(run.totalGoldGained, run.durationMs))),
    bestXpPerHour: Math.max(0, ...runs.map((run) => ratePerHour(run.totalXpGained, run.durationMs))),
    totalKeys: runs.reduce((total, run) => total + runResourceTotal(run.keys), 0),
    totalOres: runs.reduce((total, run) => total + runResourceTotal(run.ores), 0),
    totalMfDrops: rarityDrops.reduce((total, drop) => total + drop.mf, 0),
    drops: rarityDrops,
    topDrops: sortedDropBreakdown(aggregateDrops).slice(0, 5),
  };
}

function ratePerHour(value: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.trunc(value / (durationMs / 3_600_000));
}

function pastRunDropKey(run: PastRunSummary, rarity: string): string {
  return `${run.id}:${rarity}`;
}

function isPastRunDropExpanded(run: PastRunSummary, rarity: string): boolean {
  return expandedPastRunDropKey.value === pastRunDropKey(run, rarity);
}

function sortedDropBreakdown(breakdown: Record<string, ItemDropCounter>): ItemDropCounter[] {
  return Object.values(breakdown).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function breakdownTotal(breakdown: Record<string, ItemDropCounter> | undefined): number {
  return Object.values(breakdown ?? {}).reduce((total, drop) => total + drop.total, 0);
}

function formatNumber(value: number): string {
  return Math.trunc(value || 0).toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function runResourceTotal(resources: ResourceCounter[]): number {
  return resources.reduce((total, resource) => total + resource.total, 0);
}

function resourceRecordTotal(resources: Record<string, ResourceCounter>): number {
  return Object.values(resources).reduce((total, resource) => total + resource.total, 0);
}

function resourceImage(resource: ResourceCounter, kind: "key" | "ore"): string {
  return kind === "key" ? (keyImages[resource.name] ?? "") : (oreImages[resource.name] ?? "");
}

function itemIconUrl(name: string | undefined): string {
  const file = lookupItemIconFile(name);
  return file ? (itemIconImages[`../../../img/items/${file}`] ?? "") : "";
}

function logItemIconUrl(log: LogEntry): string {
  const payload = parsedLogPayload(log);
  const item = firstLogItem(payload);
  if (item) return itemIconUrl(stringField(item, "label") || stringField(item, "localizationId"));

  const rawPayload = parsedLogText(log);
  return itemIconUrl(extractJsonString(rawPayload, "label") || extractJsonString(rawPayload, "localizationId"));
}

function runTitle(run: PastRunSummary): string {
  return run.accountName || "Hero Siege Run";
}

function logClass(log: LogEntry): string {
  return `log log-${log.level}`;
}

function isLogExpanded(log: LogEntry): boolean {
  return expandedLogIds.value.has(log.id);
}

function toggleLog(log: LogEntry) {
  const next = new Set(expandedLogIds.value);
  if (next.has(log.id)) next.delete(log.id);
  else next.add(log.id);
  expandedLogIds.value = next;
}

function logEventLabel(log: LogEntry): string {
  const payload = parsedLogPayload(log);
  const item = firstLogItem(payload);
  if (item?.rarityName) return String(item.rarityName);
  if (item?.rarity) return String(item.rarity);
  const rawRarity = parsedLogText(log);
  const extractedRarity = extractJsonString(rawRarity, "rarityName") || extractJsonString(rawRarity, "rarity");
  if (extractedRarity) return extractedRarity;
  const parsed = log.message.match(/^Parsed\s+([^:]+):/i);
  if (parsed) return parsed[1];
  if (/gold-like payload did not parse/i.test(log.message)) return "goldParse";
  if (/payload did not parse/i.test(log.message)) return "parse";
  return log.level;
}

function logEventTone(log: LogEntry): string {
  return `log-event-${logEventLabel(log).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function logSummary(log: LogEntry): string {
  const payload = parsedLogPayload(log);
  const item = firstLogItem(payload);
  if (item) {
    const label = stringField(item, "label") || stringField(item, "localizationId") || "Unknown item";
    const details = [stringField(item, "mfDrop") === "1" ? "Magic find" : "", itemTypeName(item), item.fingerprint ? String(item.fingerprint) : ""].filter(Boolean);
    return details.length ? `${label} · ${details.join(" · ")}` : label;
  }

  const rawPayload = parsedLogText(log);
  const extractedLabel = extractJsonString(rawPayload, "label") || extractJsonString(rawPayload, "localizationId");
  if (extractedLabel) {
    const extractedType = extractJsonNumber(rawPayload, "type");
    const extractedFingerprint = extractJsonString(rawPayload, "fingerprint");
    const details = [extractedType !== null ? (ITEM_TYPE_NAMES[extractedType] ?? "") : "", extractedFingerprint].filter(Boolean);
    return details.length ? `${extractedLabel} · ${details.join(" · ")}` : extractedLabel;
  }

  if (isRecord(payload)) {
    const zone = stringField(payload, "zone");
    if (zone) return zone;
    const account = stringField(payload, "name");
    if (account) return account;
    const gold = stringField(payload, "GSS") || stringField(payload, "GSH") || stringField(payload, "GNS") || stringField(payload, "GNH") || stringField(payload, "GBP");
    if (gold) return `Gold ${Number(gold).toLocaleString()}`;
  }

  return log.message.replace(/^Parsed\s+[^:]+:\s*/i, "").trim();
}

function parsedLogPayload(log: LogEntry): unknown {
  const text = parsedLogText(log);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parsedLogText(log: LogEntry): string {
  const parsed = log.message.match(/^Parsed\s+[^:]+:\s*(.*)$/i);
  return parsed?.[1]?.trim() ?? "";
}

function firstLogItem(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) return payload.find(isRecord) ?? null;
  return isRecord(payload) && ("label" in payload || "localizationId" in payload || "fingerprint" in payload) ? payload : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function extractJsonString(text: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]*)"`, "i"));
  return match?.[1] ?? "";
}

function extractJsonNumber(text: string, field: string): number | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`"${escaped}"\\s*:\\s*(-?\\d+)`, "i"));
  return match ? Number.parseInt(match[1], 10) : null;
}

function itemTypeName(item: Record<string, unknown>): string {
  const type = Number(item.type);
  const weaponType = Number(item.weaponType);
  if (type === 3 && Number.isFinite(weaponType) && weaponType > 0) return "Weapon";
  return Number.isFinite(type) ? (ITEM_TYPE_NAMES[type] ?? "") : "";
}
</script>

<template>
  <main :class="['app-shell', { compact: compactMode }]">
    <header class="app-titlebar">
      <div class="drag-strip" aria-label="Drag window">
        <span class="app-mark">HSC</span>
        <span>Hero Siege Companion</span>
      </div>
      <div class="window-controls" aria-label="Window controls">
        <button class="compact-window-button" type="button" @click="toggleCompactMode" :title="compactMode ? 'Exit compact mode' : 'Compact mode'" :aria-label="compactMode ? 'Exit compact mode' : 'Compact mode'">
          <span class="compact-arrows" aria-hidden="true">{{ compactMode ? "↗↙" : "↙↗" }}</span>
        </button>
        <button type="button" @click="minimizeWindow" title="Minimize" aria-label="Minimize">−</button>
        <button v-if="!compactMode" type="button" @click="toggleMaximizeWindow" title="Maximize or restore" aria-label="Maximize or restore">□</button>
        <button class="close" type="button" @click="closeWindow" title="Close" aria-label="Close">×</button>
      </div>
    </header>

    <section v-if="compactMode" class="compact-view">
      <div class="compact-status">
        <span :class="['status-dot', state.captureStatus]"></span>
        <strong>{{ state.captureStatus === "running" ? "Connected" : captureStatusLabel }}</strong>
        <span class="compact-parsed">{{ formatNumber(state.health.parsedEvents) }} parsed</span>
        <button class="compact-shopping-toggle" type="button" @click="showCompactShopping = !showCompactShopping" title="Shopping list" aria-label="Shopping list">
          List
        </button>
        <span class="compact-clock">{{ compactClock }}</span>
      </div>
      <div class="compact-primary">
        <div>
          <span>Session</span>
          <strong>{{ sessionDuration }}</strong>
        </div>
        <div>
          <span>Gold</span>
          <strong>{{ formatNumber(state.stats.totalGoldEarned) }}</strong>
        </div>
        <div>
          <span>XP</span>
          <strong>{{ formatNumber(state.stats.totalXpEarned) }}</strong>
        </div>
        <div>
          <span>Zone</span>
          <strong>{{ zoneCountdown }}</strong>
        </div>
      </div>
      <div class="compact-drops">
        <div v-for="item in compactTrackedItems" :key="item.rarity" :class="['compact-drop', item.rarity.toLowerCase()]">
          <span>{{ item.rarity }}</span>
          <strong>{{ formatNumber(item.total) }}</strong>
        </div>
        <div class="compact-drop compact-resource ore">
          <span>Ore</span>
          <strong>{{ formatNumber(oreDropTotal) }}</strong>
        </div>
      </div>
      <section v-if="showCompactShopping" class="compact-shopping-tray" aria-label="Shopping list">
        <div class="compact-shopping-head">
          <div>
            <span>Shopping List</span>
            <strong>{{ activeShoppingItem || "Empty" }}</strong>
          </div>
          <button class="compact-shopping-close" type="button" @click="showCompactShopping = false" title="Dismiss shopping list" aria-label="Dismiss shopping list">×</button>
        </div>
        <div v-if="shoppingListItems.length" class="compact-shopping-list">
          <button
            v-for="item in shoppingListItems"
            :key="item"
            type="button"
            :class="['shopping-item', { active: item === activeShoppingItem }]"
            @click="copyShoppingItem(item, true)"
          >
            {{ item }}
          </button>
        </div>
        <p v-else class="compact-shopping-empty">Add item names in full view.</p>
      </section>
    </section>

    <section v-if="!compactMode" class="topbar">
      <div class="topbar-title">
        <p class="eyebrow">Hero Siege Companion</p>
        <h1>Live Session</h1>
      </div>
      <div class="actions">
        <button class="icon-button ghost" type="button" @click="openSettings" title="Settings" aria-label="Settings">⚙</button>
        <button class="icon-button ghost" type="button" @click="resetStats" title="Save this run to Past Runs and reset session stats">End Run</button>
        <button class="icon-button primary" type="button" @click="toggleCapture">
          {{ state.captureRunning ? "Stop Capture" : "Launch Game" }}
        </button>
      </div>
    </section>

    <div v-if="!compactMode" class="app-scroll">
      <nav class="view-tabs" aria-label="Companion views">
        <button type="button" :class="{ active: activeTab === 'live' }" @click="activeTab = 'live'">Live Session</button>
        <button type="button" :class="{ active: activeTab === 'filter' }" @click="activeTab = 'filter'">
          Item Filter <span class="info-bubble" data-tip="Sounds are triggered from captured network traffic, so alerts can arrive a couple seconds after the item appears in game.">i</span>
        </button>
        <button type="button" :class="{ active: activeTab === 'past' }" @click="activeTab = 'past'">Past Runs</button>
      </nav>

      <section v-if="activeTab === 'live'" class="live-view">
        <section class="status-strip">
        <div class="status-item">
          <span :class="['status-dot', state.captureStatus]"></span>
          <div>
            <strong>{{ state.captureStatus === "running" ? "Connected" : captureStatusLabel }}</strong>
            <span>{{ state.captureStatus === "running" ? "Capture active" : "No active capture" }}</span>
          </div>
        </div>
        <div class="status-item">
          <strong>Packets</strong>
          <span>{{ formatNumber(state.health.packetsSeen) }} seen &middot; {{ formatNumber(state.health.parsedEvents) }} parsed</span>
        </div>
        <div class="status-item">
          <button class="details-button" type="button" @click="showCaptureDetails = !showCaptureDetails">
            {{ showCaptureDetails ? "Hide Details" : "Details" }}
          </button>
        </div>
        <div v-if="showCaptureDetails" class="status-details">
          <span>Device: {{ state.health.device || "none" }}</span>
          <span>Npcap: {{ state.health.npcapService }} &middot; WinPcap {{ state.health.winPcapCompatible ? "on" : "off" }} &middot; Admin-only {{ state.health.adminOnly ? "on" : "off" }}</span>
          <span>Filter: {{ state.health.filter || "none" }}</span>
          <span>Payloads: {{ formatNumber(state.health.payloadsAssembled) }} assembled &middot; {{ formatNumber(state.health.messagesDecoded) }} decoded</span>
          <span>Parser: {{ formatNumber(state.health.parserErrors) }} errors &middot; {{ formatNumber(state.health.parserRestarts) }} restarts</span>
        </div>
      </section>

      <p v-if="state.captureError" class="error-banner">{{ state.captureError }}</p>

        <section class="metric-grid">
          <article class="metric">
            <span class="metric-label">Session <span class="info-bubble" data-tip="How long this capture session has been running.">i</span></span>
            <strong>{{ sessionDuration }}</strong>
            <small>{{ state.stats.accountName || "No character packet yet" }}</small>
          </article>
          <article class="metric">
            <span class="metric-label">Gold Earned <span class="info-bubble" data-tip="Gold starts from the current server total and tracks positive differences. Sometimes you may need to force a server sync twice, such as vote reset or starting a new game, before gold fully syncs.">i</span></span>
            <strong>{{ formatNumber(state.stats.totalGoldEarned) }}</strong>
            <small>{{ formatNumber(state.stats.goldPerHour) }}/h &middot; Current {{ currentGoldLabel }}</small>
          </article>
          <article class="metric">
            <span class="metric-label">XP Earned</span>
            <strong>{{ formatNumber(state.stats.totalXpEarned) }}</strong>
            <small>{{ formatNumber(state.stats.xpPerHour) }}/h</small>
          </article>
          <article class="metric">
            <span class="metric-label">Mailbox <span class="info-bubble" data-tip="Mailbox state updates when the game sends mailbox data, commonly when you go to town.">i</span></span>
            <strong>{{ state.stats.hasMail ? "Mail" : "Clear" }}</strong>
            <small>Last event {{ formatTime(state.stats.lastEventAt) }}</small>
          </article>
        </section>

        <section class="dashboard-grid">
        <article class="panel zone-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Satanic Zone <span class="info-bubble" data-tip="Satanic zone data updates when the game sends a fresh zone vote/reset packet.">i</span></p>
              <h2>{{ state.stats.satanicZone?.zone || "Waiting for zone packet" }}</h2>
            </div>
            <div class="countdown">
              <span>{{ zoneCountdown }}</span>
              <small>until {{ zoneResetLabel }}</small>
            </div>
          </div>

          <div v-if="state.stats.satanicZone" class="zone-effects">
            <div class="effect-column">
              <h3>Pros</h3>
              <div v-if="state.stats.satanicZone.pros.length" class="buff-list">
                <div v-for="buff in state.stats.satanicZone.pros" :key="buff.id" class="buff buff-pro">
                  <strong>{{ buff.name }}</strong>
                  <span>{{ buff.description }}</span>
                </div>
              </div>
              <p v-else class="empty-copy">No positive modifiers found on the last zone packet.</p>
            </div>

            <div class="effect-column">
              <h3>Cons</h3>
              <div class="buff-list">
                <div v-for="con in state.stats.satanicZone.cons" :key="con.id" class="buff buff-con">
                  <strong>{{ con.name }}</strong>
                  <span>{{ con.description }}</span>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="empty-copy">Zone details are cached until the next half-hour once a zone packet arrives.</p>
        </article>

        <article class="panel items-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Drops</p>
              <h2>Tracked Items</h2>
            </div>
          </div>
          <div class="item-grid">
            <button
              v-for="item in trackedItems"
              :key="item.rarity"
              type="button"
              :class="['item-counter', item.rarity.toLowerCase(), { expanded: expandedDropRarity === item.rarity }]"
              @click="toggleDropBreakdown(item.rarity)"
            >
              <span>{{ item.rarity }}</span>
              <strong>{{ formatNumber(item.total) }}</strong>
              <small>{{ formatNumber(item.mf) }} MF &middot; {{ formatNumber(item.perHour) }}/h</small>
            </button>
          </div>
          <div v-if="expandedDropRarity" class="drop-breakdown" :class="expandedDropRarity.toLowerCase()">
            <div class="drop-breakdown-head">
              <strong>{{ expandedDropRarity }} drops</strong>
              <span>{{ itemDropBreakdown(expandedDropRarity).length }} unique</span>
            </div>
            <div v-if="itemDropBreakdown(expandedDropRarity).length" class="drop-breakdown-list">
              <div v-for="drop in itemDropBreakdown(expandedDropRarity)" :key="drop.name" class="drop-breakdown-row">
                <img v-if="itemIconUrl(drop.name)" class="drop-breakdown-icon" :src="itemIconUrl(drop.name)" :alt="drop.name" />
                <span v-else class="drop-breakdown-icon drop-breakdown-icon-empty" aria-hidden="true"></span>
                <span class="drop-breakdown-name">{{ drop.name }}</span>
                <strong>{{ formatNumber(drop.total) }}</strong>
              </div>
            </div>
            <p v-else class="empty-copy">No {{ expandedDropRarity.toLowerCase() }} drops yet.</p>
          </div>
          <div class="drop-resource-grid" aria-label="Resource drops">
            <div class="drop-resource-counter keys">
              <span>Non-basic keys</span>
              <strong>{{ formatNumber(keyDropTotal) }}</strong>
            </div>
            <div class="drop-resource-counter ore">
              <span>Ore mined</span>
              <strong>{{ formatNumber(oreDropTotal) }}</strong>
            </div>
          </div>
        </article>

        <article class="panel timeline-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Recent</p>
              <h2>Item Timeline</h2>
            </div>
            <label class="timeline-limit">
              <span>History</span>
              <select v-model.number="timelineLimit" title="Visible item timeline history">
                <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
          </div>
          <div class="timeline-filters">
            <label class="timeline-type-filter">
              <span>Type</span>
              <select v-model="timelineType" title="Filter item timeline by item type">
                <option value="all">All</option>
                <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="filter-box">
              <input v-model="hideSocketables" type="checkbox" />
              <span>Hide socketable</span>
            </label>
            <label class="filter-box">
              <input v-model="hideKeys" type="checkbox" />
              <span>Hide keys</span>
            </label>
            <label class="filter-box">
              <input v-model="hideMaterials" type="checkbox" />
              <span>Hide materials</span>
            </label>
          </div>
          <div v-if="visibleItemTimeline.length" class="timeline">
            <div v-for="item in visibleItemTimeline" :key="`${item.createdAt}-${item.id}-${item.fingerprint}`" class="timeline-row">
              <img v-if="itemIconUrl(item.label)" class="timeline-icon" :src="itemIconUrl(item.label)" :alt="item.label" />
              <span v-else class="timeline-icon timeline-icon-empty" aria-hidden="true"></span>
              <span :class="['rarity-pill', item.rarity.toLowerCase()]">{{ item.rarity }}</span>
              <strong>{{ item.label || (item.id ? `#${item.id}` : "Unknown item") }}</strong>
              <small>
                {{ item.mfDrop ? "Magic find" : "Normal" }}
                <template v-if="item.amount > 1">&middot; x{{ item.amount }}</template>
                &middot; {{ formatTime(item.createdAt) }}
              </small>
            </div>
          </div>
          <p v-else-if="state.stats.itemTimeline.length" class="empty-copy">All recent items are hidden by the current filters.</p>
          <p v-else class="empty-copy">No tracked item drops in this session yet.</p>
        </article>

        <article class="panel shopping-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Marketplace</p>
              <h2>Shopping List <span class="info-bubble" data-tip="The shopping list is currently for quickly copying item names into the shop. Future API changes may expose more market surface area, but the developers do not want market automation here right now.">i</span></h2>
            </div>
            <span class="shopping-count">{{ shoppingListItems.length }} saved</span>
          </div>
          <form class="shopping-form" @submit.prevent="addShoppingItem()">
            <div class="shopping-input-wrap">
              <input
                v-model="shoppingDraftItem"
                type="text"
                list="shopping-item-suggestions"
                autocomplete="off"
                spellcheck="false"
                placeholder="Add item"
                title="Add marketplace search item"
              />
              <datalist id="shopping-item-suggestions">
                <option v-for="name in shoppingSuggestions" :key="name" :value="name"></option>
              </datalist>
            </div>
            <button class="icon-button primary shopping-add" type="submit">Add</button>
          </form>
          <div v-if="shoppingListItems.length" class="shopping-list">
            <div v-for="item in shoppingListItems" :key="item" :class="['shopping-item-row', { active: item === activeShoppingItem }]">
              <button type="button" class="shopping-item" @click="copyShoppingItem(item, false)">
                {{ item }}
              </button>
              <button class="shopping-remove" type="button" @click="removeShoppingItem(item)" title="Remove item" :aria-label="`Remove ${item}`">×</button>
            </div>
          </div>
          <p v-else class="empty-copy">Add item names here to copy marketplace searches quickly.</p>
        </article>

        <article class="panel item-filter-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Loot Audio</p>
              <h2>Item Filter <span class="info-bubble" data-tip="Sounds are triggered from captured network traffic, so alerts can arrive a couple seconds after the item appears in game.">i</span></h2>
            </div>
            <div class="item-filter-actions">
              <button class="icon-button ghost" type="button" @click="itemFilterMuted = !itemFilterMuted">{{ itemFilterMuted ? "Unmute" : "Mute" }}</button>
              <button class="icon-button ghost" type="button" @click="testItemFilterSound()">Test</button>
            </div>
          </div>
          <div class="item-filter-status-grid">
            <div>
              <span>Status</span>
              <strong>{{ itemFilterMuted ? "Muted" : "Armed" }}</strong>
            </div>
            <div>
              <span>Groups</span>
              <strong>{{ activeItemFilterGroups.length }}/{{ itemFilterGroups.length }}</strong>
            </div>
            <div>
              <span>Watched</span>
              <strong>{{ watchedItemCount }}</strong>
            </div>
          </div>
          <div class="item-filter-last">
            <span>Last match</span>
            <strong>{{ lastItemFilterMatch?.itemLabel || "None this session" }}</strong>
            <small v-if="lastItemFilterMatch">{{ lastItemFilterMatch.groupName }} &middot; {{ lastItemFilterMatch.soundName }} &middot; {{ formatTime(lastItemFilterMatch.createdAt) }}</small>
            <small v-else>Matching starts from new drops after the app opens.</small>
          </div>
          <div v-if="activeItemFilterGroups.length" class="item-filter-card-groups">
            <div v-for="group in activeItemFilterGroups" :key="group.id" class="item-filter-card-group">
              <strong>{{ group.name }}</strong>
              <span>{{ soundName(group.soundId) }} &middot; {{ group.volume }}% &middot; {{ group.cooldownMs }}ms</span>
            </div>
          </div>
          <p v-else class="empty-copy">No enabled filter groups. Configure groups in the Item Filter tab.</p>
          <button class="icon-button primary item-filter-configure" type="button" @click="activeTab = 'filter'">Configure Filter</button>
        </article>

        <article class="panel log-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Diagnostics</p>
              <h2>Live Log</h2>
            </div>
            <label class="log-limit">
              <span>History</span>
              <select v-model.number="logLimit" title="Visible log history">
                <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
          </div>
          <div class="logs">
            <button v-for="log in recentLogs" :key="log.id" type="button" :class="[logClass(log), { expanded: isLogExpanded(log) }]" @click="toggleLog(log)">
              <span class="log-time">{{ formatTime(log.createdAt) }}</span>
              <span :class="['log-event', logEventTone(log)]">{{ logEventLabel(log) }}</span>
              <img v-if="logItemIconUrl(log)" class="log-icon" :src="logItemIconUrl(log)" alt="" />
              <span v-else class="log-icon log-icon-empty" aria-hidden="true"></span>
              <p class="log-message">{{ logSummary(log) }}</p>
              <pre v-if="isLogExpanded(log)" class="log-full">{{ log.message }}</pre>
            </button>
          </div>
        </article>
      </section>
      </section>

      <section v-else-if="activeTab === 'filter'" class="item-filter-view">
        <article class="panel item-filter-page">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Loot Audio</p>
              <h2>Item Filter <span class="info-bubble" data-tip="Sounds are triggered from captured network traffic, so alerts can arrive a couple seconds after the item appears in game.">i</span></h2>
            </div>
            <div class="item-filter-actions">
              <button class="icon-button ghost" type="button" @click="itemFilterMuted = !itemFilterMuted">{{ itemFilterMuted ? "Unmute All" : "Mute All" }}</button>
              <button class="icon-button primary" type="button" @click="testItemFilterSound()">Test Selected</button>
            </div>
          </div>

          <div class="item-filter-layout">
            <aside class="item-filter-group-sidebar" aria-label="Item filter groups">
              <form class="item-filter-add-group" @submit.prevent="addItemFilterGroup">
                <input v-model="itemFilterDraftGroupName" type="text" placeholder="New group" spellcheck="false" />
                <button class="icon-button primary" type="submit">Add</button>
              </form>
              <div class="item-filter-group-list">
                <button
                  v-for="group in itemFilterGroups"
                  :key="group.id"
                  type="button"
                  :class="['item-filter-group-button', { active: selectedItemFilterGroup?.id === group.id, disabled: !group.enabled }]"
                  @click="selectItemFilterGroup(group)"
                >
                  <strong>{{ group.name }}</strong>
                  <span>{{ group.enabled ? "Enabled" : "Disabled" }} &middot; {{ soundName(group.soundId) }}</span>
                </button>
              </div>
            </aside>

            <section v-if="selectedItemFilterGroup" class="item-filter-editor">
              <div class="item-filter-editor-head">
                <label class="settings-check">
                  <input v-model="selectedItemFilterGroup.enabled" type="checkbox" />
                  <span>Enabled</span>
                </label>
                <button class="icon-button ghost" type="button" @click="removeItemFilterGroup(selectedItemFilterGroup)">Remove Group</button>
              </div>

              <div class="item-filter-editor-grid">
                <label class="settings-row">
                  <span>Group name</span>
                  <input v-model="selectedItemFilterGroup.name" type="text" spellcheck="false" />
                </label>
                <label class="settings-row">
                  <span>Sound</span>
                  <div class="sound-picker">
                    <select v-model="selectedItemFilterGroup.soundId">
                      <option v-for="sound in ITEM_FILTER_SOUNDS" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
                    </select>
                    <button class="sound-test-button" type="button" @click="testItemFilterSound(selectedItemFilterGroup.soundId, selectedItemFilterGroup.volume)" title="Play sound" aria-label="Play selected group sound">Play</button>
                  </div>
                </label>
                <label class="settings-row">
                  <span>Volume</span>
                  <input v-model.number="selectedItemFilterGroup.volume" type="range" min="0" max="100" />
                </label>
                <label class="settings-row">
                  <span>Cooldown</span>
                  <div class="number-setting">
                    <input v-model.number="selectedItemFilterGroup.cooldownMs" type="number" min="0" max="30000" step="100" />
                    <small>ms</small>
                  </div>
                </label>
              </div>

              <div class="item-filter-rule-section">
                <div class="item-filter-rule-heading">
                  <strong>Rarities</strong>
                  <span>Empty means any rarity.</span>
                </div>
                <div class="item-filter-chip-grid">
                  <label v-for="rarity in ITEM_FILTER_RARITIES" :key="rarity" class="filter-box">
                    <input :checked="selectedItemFilterGroup.rarities.includes(rarity)" type="checkbox" @change="toggleFilterRarity(selectedItemFilterGroup, rarity, eventChecked($event))" />
                    <span>{{ rarity }}</span>
                  </label>
                </div>
              </div>

              <div class="item-filter-rule-section">
                <div class="item-filter-rule-heading">
                  <strong>Item types</strong>
                  <span>Empty means any type.</span>
                </div>
                <div class="item-filter-type-grid">
                  <label v-for="option in itemTypeOptions" :key="option.value" class="filter-box">
                    <input :checked="selectedItemFilterGroup.types.includes(Number(option.value))" type="checkbox" @change="toggleFilterType(selectedItemFilterGroup, Number(option.value), eventChecked($event))" />
                    <span>{{ option.label }}</span>
                  </label>
                </div>
              </div>

              <div class="item-filter-rule-section">
                <div class="item-filter-rule-heading">
                  <strong>Watched items</strong>
                  <span>Search known item names. Exact matches can override the group sound.</span>
                </div>
                <div class="item-filter-search-wrap">
                  <form class="item-filter-add-item" @submit.prevent="addItemToFilterGroup(selectedItemFilterGroup)">
                    <input v-model="itemFilterDraftItem" type="search" placeholder="Search item name" autocomplete="off" spellcheck="false" />
                    <button class="icon-button primary" type="submit">Add</button>
                  </form>
                  <div v-if="itemFilterDraftItem.trim().length >= 3 && itemFilterSuggestions.length" class="item-filter-suggestions">
                    <button v-for="name in itemFilterSuggestions" :key="name" type="button" @click="addItemToFilterGroup(selectedItemFilterGroup, name)">
                      {{ name }}
                    </button>
                  </div>
                  <p v-else-if="itemFilterDraftItem.trim().length > 0 && itemFilterDraftItem.trim().length < 3" class="item-filter-search-hint">Type at least 3 characters for suggestions.</p>
                  <p v-else-if="itemFilterDraftItem.trim().length >= 3" class="item-filter-search-hint">No matching known items.</p>
                </div>
                <div v-if="selectedItemFilterGroupedItems.length" class="item-filter-specific-list">
                  <section v-for="itemGroup in selectedItemFilterGroupedItems" :key="itemGroup.typeLabel" class="item-filter-specific-type">
                    <h4>{{ itemGroup.typeLabel }}</h4>
                    <div v-for="item in itemGroup.items" :key="`${itemGroup.typeLabel}-${item.name}`" class="item-filter-specific-row">
                      <span>{{ item.name }}</span>
                      <div class="sound-picker">
                        <select v-model="item.soundId">
                          <option value="">Group sound</option>
                          <option v-for="sound in ITEM_FILTER_SOUNDS" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
                        </select>
                        <button class="sound-test-button" type="button" @click="testItemFilterSound(item.soundId || selectedItemFilterGroup.soundId, selectedItemFilterGroup.volume)" title="Play sound" :aria-label="`Play sound for ${item.name}`">Play</button>
                      </div>
                      <button class="shopping-remove" type="button" @click="removeItemFromFilterGroup(selectedItemFilterGroup, item)" :aria-label="`Remove ${item.name}`">×</button>
                    </div>
                  </section>
                </div>
                <p v-else class="empty-copy">Add exact item names for high-priority watched drops.</p>
              </div>
            </section>
            <p v-else class="empty-copy">Add a group to start building an item filter.</p>
          </div>
        </article>
      </section>

      <section v-else class="past-runs-view">
        <article class="panel past-runs-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">History</p>
              <h2>Past Runs</h2>
            </div>
            <span class="past-run-count">{{ pastRuns.length }}/100 saved</span>
          </div>

          <div v-if="pastRuns.length" class="past-run-aggregate-grid">
            <section v-for="panel in aggregatePanels" :key="panel.key" class="past-run-aggregate">
              <div class="aggregate-heading">
                <div>
                  <h3>{{ panel.title }}</h3>
                  <span>{{ panel.subtitle }} &middot; Avg {{ formatDuration(panel.aggregate.averageDurationMs) }}</span>
                </div>
                <strong>{{ formatDuration(panel.aggregate.totalDurationMs) }}</strong>
              </div>
              <div class="aggregate-metrics">
                <div>
                  <span>Gold/h</span>
                  <strong>{{ formatNumber(panel.aggregate.goldPerHour) }}</strong>
                  <small>Best {{ formatNumber(panel.aggregate.bestGoldPerHour) }}</small>
                </div>
                <div>
                  <span>XP/h</span>
                  <strong>{{ formatNumber(panel.aggregate.xpPerHour) }}</strong>
                  <small>Best {{ formatNumber(panel.aggregate.bestXpPerHour) }}</small>
                </div>
                <div>
                  <span>Keys</span>
                  <strong>{{ formatNumber(panel.aggregate.totalKeys) }}</strong>
                  <small>{{ formatNumber(panel.aggregate.totalOres) }} ore</small>
                </div>
                <div>
                  <span>MF drops</span>
                  <strong>{{ formatNumber(panel.aggregate.totalMfDrops) }}</strong>
                  <small>{{ formatNumber(panel.aggregate.totalGold) }} gold</small>
                </div>
              </div>
              <div class="aggregate-drop-grid">
                <div v-for="drop in panel.aggregate.drops" :key="`${panel.key}-${drop.rarity}`" :class="['aggregate-drop', drop.rarity.toLowerCase()]">
                  <span>{{ drop.rarity }}</span>
                  <strong>{{ formatNumber(drop.total) }}</strong>
                  <small>{{ formatNumber(drop.mf) }} MF &middot; {{ formatNumber(drop.unique) }} unique</small>
                </div>
              </div>
              <div class="aggregate-top-drops">
                <span>Top drops</span>
                <div v-if="panel.aggregate.topDrops.length" class="aggregate-top-list">
                  <div v-for="drop in panel.aggregate.topDrops" :key="`${panel.key}-${drop.name}`">
                    <span>{{ drop.name }}</span>
                    <strong>{{ formatNumber(drop.total) }}</strong>
                  </div>
                </div>
                <small v-else>No tracked drops yet.</small>
              </div>
            </section>
          </div>

          <div v-if="pastRuns.length" class="past-runs-list">
            <section v-for="run in pastRuns" :key="run.id" class="past-run-card">
              <div class="past-run-header">
                <div>
                  <h3>{{ runTitle(run) }}</h3>
                  <span>{{ formatDateTime(run.sessionStartedAt) }} &middot; {{ formatDuration(run.durationMs) }}</span>
                </div>
                <div class="past-run-time">{{ formatTime(run.sessionEndedAt) }}</div>
              </div>

              <div class="past-run-metrics">
                <div>
                  <span>Gold</span>
                  <strong>{{ formatNumber(run.totalGoldGained) }}</strong>
                </div>
                <div>
                  <span>XP</span>
                  <strong>{{ formatNumber(run.totalXpGained) }}</strong>
                </div>
                <div>
                  <span>Keys</span>
                  <strong>{{ formatNumber(runResourceTotal(run.keys)) }}</strong>
                </div>
                <div>
                  <span>Ore</span>
                  <strong>{{ formatNumber(runResourceTotal(run.ores)) }}</strong>
                </div>
              </div>

              <div class="past-run-drops">
                <div class="past-run-drop-grid">
                  <button
                    v-for="item in runTrackedItems(run)"
                    :key="`${run.id}-${item.rarity}`"
                    type="button"
                    :class="['item-counter', item.rarity.toLowerCase(), { expanded: isPastRunDropExpanded(run, item.rarity) }]"
                    @click="togglePastRunDropBreakdown(run, item.rarity)"
                  >
                    <span>{{ item.rarity }}</span>
                    <strong>{{ formatNumber(item.total) }}</strong>
                    <small>{{ formatNumber(item.mf) }} MF &middot; {{ item.drops.length }} unique</small>
                  </button>
                </div>
                <template v-for="item in runTrackedItems(run)" :key="`${run.id}-${item.rarity}-details`">
                  <div v-if="isPastRunDropExpanded(run, item.rarity)" class="drop-breakdown past-run-drop-breakdown" :class="item.rarity.toLowerCase()">
                    <div class="drop-breakdown-head">
                      <strong>{{ item.rarity }} drops</strong>
                      <span>{{ item.drops.length }} unique</span>
                    </div>
                    <div v-if="item.drops.length" class="drop-breakdown-list">
                      <div v-for="drop in item.drops" :key="`${run.id}-${item.rarity}-${drop.name}`" class="drop-breakdown-row">
                        <img v-if="itemIconUrl(drop.name)" class="drop-breakdown-icon" :src="itemIconUrl(drop.name)" :alt="drop.name" />
                        <span v-else class="drop-breakdown-icon drop-breakdown-icon-empty" aria-hidden="true"></span>
                        <span class="drop-breakdown-name">{{ drop.name }}</span>
                        <strong>{{ formatNumber(drop.total) }}</strong>
                      </div>
                    </div>
                    <p v-else class="empty-copy">No saved {{ item.rarity.toLowerCase() }} item detail for this run.</p>
                  </div>
                </template>
              </div>

              <div class="resource-columns">
                <div class="resource-column">
                  <h4>Non-basic keys</h4>
                  <div v-if="run.keys.length" class="resource-list">
                    <div
                      v-for="key in run.keys"
                      :key="`${run.id}-${key.name}`"
                      class="resource-chip"
                      :class="{ 'resource-chip-no-image': !resourceImage(key, 'key') }"
                    >
                      <img v-if="resourceImage(key, 'key')" :src="resourceImage(key, 'key')" :alt="key.name" />
                      <span>{{ key.name }}</span>
                      <strong>{{ formatNumber(key.total) }}</strong>
                    </div>
                  </div>
                  <p v-else class="empty-copy">No non-basic keys logged.</p>
                </div>

                <div class="resource-column">
                  <h4>Ore mined</h4>
                  <div v-if="run.ores.length" class="resource-list">
                    <div
                      v-for="ore in run.ores"
                      :key="`${run.id}-${ore.name}`"
                      class="resource-chip"
                      :class="{ 'resource-chip-no-image': !resourceImage(ore, 'ore') }"
                    >
                      <img v-if="resourceImage(ore, 'ore')" :src="resourceImage(ore, 'ore')" :alt="ore.name" />
                      <span>{{ ore.name }}</span>
                      <strong>{{ formatNumber(ore.total) }}</strong>
                    </div>
                  </div>
                  <p v-else class="empty-copy">No ore logged.</p>
                </div>
              </div>
            </section>
          </div>
          <p v-else class="empty-copy">Click End Run to save the current session here. Closing the app also saves the run, and it will appear on the next launch.</p>
        </article>
      </section>
    </div>
    <div v-if="showSettings" class="modal-backdrop" @click.self="closeSettings">
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="settings-heading">
          <div>
            <p class="eyebrow">Preferences</p>
            <h2 id="settings-title">Settings</h2>
            <p class="settings-note">These preferences are saved on this device and restored between sessions.</p>
          </div>
          <button class="settings-close" type="button" @click="closeSettings" title="Close settings" aria-label="Close settings">×</button>
        </div>

        <div class="settings-grid">
          <label class="settings-row">
            <span class="settings-label">Log history <span class="info-bubble" data-tip="Controls how many Live Log entries remain visible in the diagnostics panel.">i</span></span>
            <select v-model.number="draftLogLimit" title="Visible log history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="settings-row">
            <span class="settings-label">Item timeline history <span class="info-bubble" data-tip="Controls how many recent item drops remain visible in the item timeline.">i</span></span>
            <select v-model.number="draftTimelineLimit" title="Visible item timeline history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="settings-row">
            <span class="settings-label">Timeline type <span class="info-bubble" data-tip="Filters the recent item timeline to a single item type when you want to inspect one category.">i</span></span>
            <select v-model="draftTimelineType" title="Filter item timeline by item type">
              <option value="all">All</option>
              <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <div class="settings-launch-row settings-wide">
            <label class="settings-inline-check">
              <input v-model="draftLaunchThroughSteam" type="checkbox" />
              <span class="settings-label">Launch through Steam <span class="info-bubble" data-tip="Uses Steam's Hero Siege launch URL when you click Launch Game. Uncheck this to choose a standalone Hero Siege executable instead.">i</span></span>
            </label>
            <div v-if="!draftLaunchThroughSteam" class="path-setting">
              <input v-model="draftGameExecutablePath" type="text" spellcheck="false" title="Path to Hero Siege executable" />
              <button class="icon-button ghost" type="button" @click="chooseGameExecutable">Browse</button>
            </div>
          </div>
          <label class="settings-check">
            <input v-model="draftShowCaptureDetails" type="checkbox" />
            <span class="settings-label">Show capture details <span class="info-bubble" data-tip="Shows adapter, filter, parser, and packet counters in the live status area.">i</span></span>
          </label>
          <label class="settings-check">
            <input v-model="draftCreateDebugMode" type="checkbox" />
            <span class="settings-label">Verbose live logging <span class="info-bubble" data-tip="Logs every parsed drop to Live Log. Useful for Blood Pact or extreme endgame farming diagnostics; use with caution because it can get noisy.">i</span></span>
          </label>
          <label class="settings-check">
            <input v-model="draftAlwaysOnTop" type="checkbox" />
            <span class="settings-label">Always on top <span class="info-bubble" data-tip="Keeps the companion above other windows while you play.">i</span></span>
          </label>
          <label class="settings-check">
            <input v-model="draftLockCompactLocation" type="checkbox" />
            <span class="settings-label">Lock saved window positions <span class="info-bubble" data-tip="Restores the compact and full windows to their last saved positions when switching modes.">i</span></span>
          </label>
          <label class="settings-check">
            <input v-model="draftHideSocketables" type="checkbox" />
            <span class="settings-label">Hide socketable items <span class="info-bubble" data-tip="Removes socketables from the recent item timeline so rarer item drops are easier to scan.">i</span></span>
          </label>
          <label class="settings-check">
            <input v-model="draftHideKeys" type="checkbox" />
            <span class="settings-label">Hide key items <span class="info-bubble" data-tip="Removes keys from the recent item timeline; key totals are still tracked elsewhere.">i</span></span>
          </label>
          <label class="settings-check">
            <input v-model="draftHideMaterials" type="checkbox" />
            <span class="settings-label">Hide materials <span class="info-bubble" data-tip="Removes materials and collectibles from the recent item timeline while keeping resource counters intact.">i</span></span>
          </label>
          <label class="settings-check">
            <input v-model="draftSkipEmptyRuns" type="checkbox" />
            <span class="settings-label">Don't save empty runs <span class="info-bubble" data-tip="Prevents Past Runs entries when a session has no tracked activity.">i</span></span>
          </label>
          <label class="settings-row">
            <span class="settings-label">Only save runs over <span class="info-bubble" data-tip="Requires runs to last this many minutes before they are saved to Past Runs.">i</span></span>
            <div class="number-setting">
              <input v-model.number="draftMinRunDurationMinutes" type="number" min="0" max="1440" step="1" title="Minimum run duration in minutes" />
              <small>min</small>
            </div>
          </label>
        </div>

        <div class="settings-actions">
          <button class="icon-button ghost" type="button" @click="resetDraftPreferences">Reset Preferences</button>
          <button class="icon-button primary" type="button" @click="applyDraftPreferences">Done</button>
        </div>
      </section>
    </div>
    <div v-if="copiedShoppingItem" class="toast-bubble" role="status">Copied {{ copiedShoppingItem }} to clipboard</div>
    <span class="app-version">v{{ appVersion }}</span>
    <div class="resize-grip" aria-hidden="true"></div>
  </main>
</template>

