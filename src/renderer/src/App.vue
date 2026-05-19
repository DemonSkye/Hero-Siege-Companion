<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { CompanionState, LogEntry, RunArchivePreferences } from "../../shared/app-state";
import { ITEM_TYPE_NAMES, MATERIAL_LIKE_TIMELINE_TYPES } from "../../shared/constants";
import { allItemIconNames, lookupItemIconFile } from "../../shared/item-icons";
import { allItemTranslationNames } from "../../shared/item-lookup";
import { allStackItemTranslationNames } from "../../shared/stack-item-lookup";
import { createInitialStats, type ItemDropCounter, type PastRunSummary, type ResourceCounter } from "../../shared/stats";

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
const activeTab = ref<"live" | "past">("live");
const appVersion = "0.0.7";
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
const draftSkipEmptyRuns = ref(false);
const draftMinRunDurationMinutes = ref(0);
const shoppingListItems = ref<string[]>([]);
const shoppingDraftItem = ref("");
const activeShoppingIndex = ref(0);
const copiedShoppingItem = ref("");
const expandedDropRarity = ref<string | null>(null);
const expandedPastRunDropKey = ref<string | null>(null);
let toastTimer: number | null = null;
const PREFERENCES_STORAGE_KEY = "hero-siege-companion:preferences:v1";
const DEFAULT_SHOPPING_LIST = ["Copper Ore", "Iron Ore", "Gold Ore", "Ruby", "Jade", "Tarethium Ore"];
const SHOPPING_SUGGESTION_LIMIT = 8;
const TRACKED_RARITY_ORDER = ["Set", "Satanic", "Heroic", "Angelic"];
const shoppingAutocompleteNames = Array.from(
  new Set([...DEFAULT_SHOPPING_LIST, ...allStackItemTranslationNames(), ...allItemTranslationNames(), ...allItemIconNames()]),
).sort((a, b) => a.localeCompare(b));
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
};

const itemTypeOptions = computed(() =>
  Object.entries(ITEM_TYPE_NAMES)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

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
const activeShoppingItem = computed(() => shoppingListItems.value[activeShoppingIndex.value] ?? shoppingListItems.value[0] ?? "");
const shoppingSuggestions = computed(() => {
  const query = shoppingDraftItem.value.trim().toLowerCase();
  const existing = new Set(shoppingListItems.value.map((item) => item.toLowerCase()));
  if (!query) return shoppingAutocompleteNames.filter((name) => !existing.has(name.toLowerCase())).slice(0, SHOPPING_SUGGESTION_LIMIT);
  return shoppingAutocompleteNames
    .filter((name) => !existing.has(name.toLowerCase()) && name.toLowerCase().includes(query))
    .slice(0, SHOPPING_SUGGESTION_LIMIT);
});

onMounted(async () => {
  applyPreferences(loadPreferences());
  await syncWindowMode();
  state.value = await window.heroSiegeCompanion.getState();
  unsubscribe = window.heroSiegeCompanion.onStateUpdated((nextState) => {
    state.value = nextState;
  });
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

watch([logLimit, timelineLimit, showCaptureDetails, hideSocketables, hideKeys, hideMaterials, timelineType, lockCompactLocation, shoppingListItems], () => {
  savePreferences(currentPreferences());
  clampActiveShoppingIndex();
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
}

async function applyDraftPreferences() {
  applyPreferences(currentDraftPreferences());
  savePreferences(currentPreferences());
  state.value = await window.heroSiegeCompanion.setRunArchivePreferences(currentDraftRunArchivePreferences());
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
  clampActiveShoppingIndex();
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
  draftSkipEmptyRuns.value = state.value.runArchivePreferences.skipEmptyRuns;
  draftMinRunDurationMinutes.value = state.value.runArchivePreferences.minDurationMinutes;
}

function loadPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return defaultPreferences;
    return normalizePreferences(JSON.parse(raw) as Partial<UiPreferences>);
  } catch {
    return defaultPreferences;
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
  };
}

function currentDraftRunArchivePreferences(): RunArchivePreferences {
  return {
    skipEmptyRuns: draftSkipEmptyRuns.value,
    minDurationMinutes: normalizeRunDurationMinutes(draftMinRunDurationMinutes.value),
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
              <h2>Shopping List</h2>
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

      <section v-else class="past-runs-view">
        <article class="panel past-runs-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">History</p>
              <h2>Past Runs</h2>
            </div>
            <span class="past-run-count">{{ pastRuns.length }}/100 saved</span>
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
            <span>Log history</span>
            <select v-model.number="draftLogLimit" title="Visible log history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="settings-row">
            <span>Item timeline history</span>
            <select v-model.number="draftTimelineLimit" title="Visible item timeline history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="settings-row">
            <span>Timeline type</span>
            <select v-model="draftTimelineType" title="Filter item timeline by item type">
              <option value="all">All</option>
              <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="settings-stack">
            <span>Launch from other source</span>
            <div :class="['path-setting', { disabled: draftLaunchThroughSteam }]">
              <input v-model="draftGameExecutablePath" type="text" spellcheck="false" title="Path to Hero Siege executable" :disabled="draftLaunchThroughSteam" />
              <button class="icon-button ghost" type="button" @click="chooseGameExecutable" :disabled="draftLaunchThroughSteam">Browse</button>
            </div>
          </label>
          <label class="settings-check">
            <input v-model="draftLaunchThroughSteam" type="checkbox" />
            <span>Launch through Steam</span>
          </label>
          <label class="settings-check">
            <input v-model="draftShowCaptureDetails" type="checkbox" />
            <span>Show capture details</span>
          </label>
          <label class="settings-check">
            <input v-model="draftAlwaysOnTop" type="checkbox" />
            <span>Always on top</span>
          </label>
          <label class="settings-check">
            <input v-model="draftLockCompactLocation" type="checkbox" />
            <span>Lock compact and full views to their last locations</span>
          </label>
          <label class="settings-check">
            <input v-model="draftHideSocketables" type="checkbox" />
            <span>Hide socketable items</span>
          </label>
          <label class="settings-check">
            <input v-model="draftHideKeys" type="checkbox" />
            <span>Hide key items</span>
          </label>
          <label class="settings-check">
            <input v-model="draftHideMaterials" type="checkbox" />
            <span>Hide material and collectible items</span>
          </label>
          <label class="settings-check">
            <input v-model="draftSkipEmptyRuns" type="checkbox" />
            <span>Don't save empty runs</span>
          </label>
          <label class="settings-row">
            <span>Only save runs over</span>
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

