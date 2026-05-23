<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { CapturePreferences, CompanionState, LogEntry, ReleaseUpdateInfo, RunArchivePreferences } from "../../shared/app-state";
import { MATERIAL_LIKE_TIMELINE_TYPES } from "../../shared/constants";
import { createInitialStats, type ItemDropCounter, type ItemTimelineEntry } from "../../shared/stats";
import CompactView from "./components/CompactView.vue";
import ItemFilterView from "./components/ItemFilterView.vue";
import LiveView from "./components/LiveView.vue";
import PastRunsView from "./components/PastRunsView.vue";
import SettingsModal from "./components/SettingsModal.vue";
import UpdateBanner from "./components/UpdateBanner.vue";
import { formatDuration, formatNumber } from "./lib/format";
import { playItemFilterSound } from "./lib/item-filter-sounds";
import {
  ITEM_FILTER_SOUNDS,
  ITEM_FILTER_SUGGESTION_LIMIT,
  canonicalItemName,
  createItemFilterGroup,
  itemFilterGroupedItems,
  itemTimelineKey,
  itemTypeLabelForName,
  matchItemFilter,
  normalizeSpecificItems,
  soundName,
  type ItemFilterGroup,
  type ItemFilterMatch,
  type ItemFilterRuleMatch,
  type ItemFilterSpecificItem,
} from "./lib/item-filters";
import { ITEM_TYPE_OPTIONS, SHOPPING_SUGGESTION_LIMIT, shoppingAutocompleteNames } from "./lib/item-options";
import {
  activeItemResearchEntries,
  isItemResearchCandidate,
  normalizeItemResearchEntries,
  updateItemResearchEntry,
  upsertItemResearchEntry,
  type ItemResearchEntry,
} from "./lib/item-research";
import {
  LOG_LIMIT_OPTIONS,
  createConfigurationExportPayload,
  defaultPreferences,
  importConfigurationPayload,
  loadPreferences,
  normalizeRunDurationMinutes,
  normalizeShoppingList,
  savePreferences,
  type UiPreferences,
} from "./lib/preferences";
import {
  TRACKED_RARITY_ORDER,
  resourceRecordTotal,
  sortedDropBreakdown,
} from "./lib/past-runs";
import { normalizePostRunReportConfig, type PostRunReportConfig } from "./lib/report-config";
import { normalizeLookupText } from "./lib/text";

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
const logLimitOptions = LOG_LIMIT_OPTIONS;
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
const appVersion = "0.1.5";
const expandedLogIds = ref<Set<string>>(new Set());
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
const draftCreateDebugMode = ref(false);
const draftSkipEmptyRuns = ref(false);
const draftMinRunDurationMinutes = ref(0);
const configIncludeAppSettings = ref(true);
const configIncludeRunSaving = ref(true);
const configIncludeReportTracking = ref(true);
const configIncludeLootFilters = ref(true);
const configIncludeItemResearch = ref(false);
const shoppingListItems = ref<string[]>([]);
const shoppingDraftItem = ref("");
const itemFilterGroups = ref<ItemFilterGroup[]>([]);
const itemFilterMuted = ref(false);
const postRunReport = ref<PostRunReportConfig>(defaultPreferences.postRunReport);
const developerItemResearchEnabled = ref(false);
const unknownItemAudioPrompt = ref(false);
const itemResearchEntries = ref<ItemResearchEntry[]>([]);
const itemFilterDraftItem = ref("");
const itemFilterDraftGroupName = ref("");
const activeItemFilterGroupId = ref("");
const lastItemFilterMatch = ref<ItemFilterMatch | null>(null);
const activeShoppingIndex = ref(0);
const toastMessage = ref("");
const expandedDropRarity = ref<string | null>(null);
const expandedPastRunDropKey = ref<string | null>(null);
const availableUpdate = ref<ReleaseUpdateInfo | null>(null);
let toastTimer: number | null = null;
const IGNORED_UPDATE_STORAGE_KEY = "hero-siege-companion:ignored-update:v1";
const itemFilterSeenTimelineKeys = new Set<string>();
const itemResearchSeenTimelineKeys = new Set<string>();
const itemFilterLastPlayedAt = new Map<string, number>();
let lastUnknownItemPromptAt = 0;
const itemTypeOptions = ITEM_TYPE_OPTIONS;

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
const activeItemFilterGroups = computed(() => itemFilterGroups.value.filter((group) => group.enabled));
const watchedItemCount = computed(() => itemFilterGroups.value.reduce((total, group) => total + new Set(group.items.map((item) => normalizeLookupText(item.name))).size, 0));
const unresolvedItemResearchEntries = computed(() => activeItemResearchEntries(itemResearchEntries.value));
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
  initializeItemResearchSeenItems(state.value.stats.itemTimeline);
  unsubscribe = window.heroSiegeCompanion.onStateUpdated((nextState) => {
    processItemFilterTimeline(nextState.stats.itemTimeline);
    processItemResearchTimeline(nextState.stats.itemTimeline);
    state.value = nextState;
  });
  void checkForUpdateNotice();
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

watch([logLimit, timelineLimit, showCaptureDetails, hideSocketables, hideKeys, hideMaterials, timelineType, lockCompactLocation, shoppingListItems, itemFilterGroups, itemFilterMuted, postRunReport, developerItemResearchEnabled, unknownItemAudioPrompt, itemResearchEntries], () => {
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

async function exportConfiguration() {
  try {
    const payload = createConfigurationExportPayload(
      currentDraftPreferences(),
      currentDraftRunArchivePreferences(),
      currentDraftCapturePreferences(),
      currentConfigurationTransferOptions(),
    );
    const exported = await window.heroSiegeCompanion.exportConfiguration(JSON.stringify(payload, null, 2));
    if (exported) showToast("Configuration exported");
  } catch {
    showToast("Configuration export failed");
  }
}

async function importConfiguration() {
  try {
    const contents = await window.heroSiegeCompanion.importConfiguration();
    if (!contents) return;

    const imported = importConfigurationPayload(contents, currentPreferences(), currentConfigurationTransferOptions());
    applyPreferences(imported.uiPreferences);
    savePreferences(currentPreferences());

    if (imported.runArchivePreferences) {
      state.value = await window.heroSiegeCompanion.setRunArchivePreferences(imported.runArchivePreferences);
    }
    if (imported.capturePreferences) {
      state.value = await window.heroSiegeCompanion.setCapturePreferences(imported.capturePreferences);
    }

    loadDraftPreferences(currentPreferences());
    await syncWindowMode();
    showToast("Configuration imported");
  } catch {
    showToast("Configuration import failed");
  }
}

function currentConfigurationTransferOptions() {
  return {
    includeAppSettings: configIncludeAppSettings.value,
    includeRunSaving: configIncludeRunSaving.value,
    includeReportTracking: configIncludeReportTracking.value,
    includeLootFilters: configIncludeLootFilters.value,
    includeItemResearch: configIncludeItemResearch.value,
  };
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
    postRunReport: postRunReport.value,
    developerItemResearchEnabled: developerItemResearchEnabled.value,
    unknownItemAudioPrompt: unknownItemAudioPrompt.value,
    itemResearchEntries: itemResearchEntries.value,
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
  postRunReport.value = preferences.postRunReport;
  developerItemResearchEnabled.value = preferences.developerItemResearchEnabled;
  unknownItemAudioPrompt.value = preferences.unknownItemAudioPrompt;
  itemResearchEntries.value = preferences.itemResearchEntries;
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
    postRunReport: postRunReport.value,
    developerItemResearchEnabled: draftDeveloperItemResearchEnabled.value,
    unknownItemAudioPrompt: draftDeveloperItemResearchEnabled.value && draftUnknownItemAudioPrompt.value,
    itemResearchEntries: itemResearchEntries.value,
  };
}

function updatePostRunReportConfig(value: PostRunReportConfig) {
  postRunReport.value = normalizePostRunReportConfig(value);
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
  draftDeveloperItemResearchEnabled.value = preferences.developerItemResearchEnabled;
  draftUnknownItemAudioPrompt.value = preferences.unknownItemAudioPrompt;
  draftTimelineType.value = preferences.timelineType;
  draftGameExecutablePath.value = preferences.gameExecutablePath;
  draftLaunchThroughSteam.value = preferences.launchThroughSteam;
  draftCreateDebugMode.value = state.value.capturePreferences.createDebugMode;
  draftSkipEmptyRuns.value = state.value.runArchivePreferences.skipEmptyRuns;
  draftMinRunDurationMinutes.value = state.value.runArchivePreferences.minDurationMinutes;
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

async function chooseGameExecutable() {
  const selected = await window.heroSiegeCompanion.chooseGameExecutable();
  if (!selected) return;
  draftGameExecutablePath.value = selected;
}

async function checkForUpdateNotice() {
  try {
    const update = await window.heroSiegeCompanion.checkForUpdate();
    if (!update) return;
    if (window.localStorage.getItem(IGNORED_UPDATE_STORAGE_KEY) === update.version) return;
    availableUpdate.value = update;
  } catch {
    // Update checks are opportunistic and should stay silent when offline.
  }
}

async function openAvailableUpdate() {
  if (!availableUpdate.value) return;
  await window.heroSiegeCompanion.openRelease(availableUpdate.value.url);
}

function ignoreAvailableUpdate() {
  if (!availableUpdate.value) return;
  try {
    window.localStorage.setItem(IGNORED_UPDATE_STORAGE_KEY, availableUpdate.value.version);
  } catch {
    // Ignore state is cosmetic; failing to store it is harmless.
  }
  availableUpdate.value = null;
}

async function syncWindowMode() {
  await window.heroSiegeCompanion.setAlwaysOnTop(alwaysOnTop.value);
  await window.heroSiegeCompanion.setCompactMode(compactMode.value, lockCompactLocation.value);
}

async function copyShoppingItem(item: string, advance: boolean) {
  const trimmed = item.trim();
  if (!trimmed) return;
  await window.heroSiegeCompanion.writeClipboardText(trimmed);
  showToast(`Copied ${trimmed} to clipboard`);

  const index = shoppingListItems.value.findIndex((candidate) => candidate === item);
  if (index >= 0) activeShoppingIndex.value = index;
  if (advance) moveToNextShoppingItem();
}

function showToast(message: string) {
  toastMessage.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMessage.value = "";
    toastTimer = null;
  }, 1800);
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

function addItemFilterGroup() {
  const nextGroup = createItemFilterGroup(itemFilterDraftGroupName.value, itemFilterGroups.value.length);
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
    if (item.source !== "server") continue;
    const match = matchItemFilter(item, activeItemFilterGroups.value);
    if (match) handleItemFilterMatch(match);
  }
}

function initializeItemResearchSeenItems(items: ItemTimelineEntry[]) {
  itemResearchSeenTimelineKeys.clear();
  for (const item of items) itemResearchSeenTimelineKeys.add(itemTimelineKey(item));
}

function processItemResearchTimeline(items: ItemTimelineEntry[]) {
  const nextItems = items.filter((item) => !itemResearchSeenTimelineKeys.has(itemTimelineKey(item))).reverse();
  for (const item of nextItems) {
    itemResearchSeenTimelineKeys.add(itemTimelineKey(item));
    if (!developerItemResearchEnabled.value || !isItemResearchCandidate(item)) continue;
    itemResearchEntries.value = upsertItemResearchEntry(itemResearchEntries.value, item);
    maybePromptUnknownItem();
  }
}

function maybePromptUnknownItem() {
  if (!unknownItemAudioPrompt.value) return;
  const nowMs = Date.now();
  if (nowMs - lastUnknownItemPromptAt < 5000) return;
  lastUnknownItemPromptAt = nowMs;
  void playItemFilterSound("low-pulse", 45).catch(() => {
    // Item research audio is optional and should never affect capture.
  });
}

function saveItemResearchEntry(signature: string, value: { resolvedName: string; notes: string }) {
  itemResearchEntries.value = updateItemResearchEntry(itemResearchEntries.value, signature, value);
}

function ignoreItemResearchEntry(signature: string) {
  itemResearchEntries.value = updateItemResearchEntry(itemResearchEntries.value, signature, { ignored: true });
}

function resetItemResearchEntry(signature: string) {
  itemResearchEntries.value = updateItemResearchEntry(itemResearchEntries.value, signature, { resolvedName: "", notes: "", ignored: false });
}

function clearResolvedItemResearchEntries() {
  itemResearchEntries.value = normalizeItemResearchEntries(itemResearchEntries.value.filter((entry) => !entry.resolvedName.trim() && !entry.ignored));
}

function handleItemFilterMatch(match: ItemFilterRuleMatch) {
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

async function testItemFilterSound(soundId = selectedItemFilterGroup.value?.soundId ?? ITEM_FILTER_SOUNDS[0].id, volume = selectedItemFilterGroup.value?.volume ?? 70) {
  try {
    await playItemFilterSound(soundId, volume);
  } catch (error) {
    // Some systems block audio until the next direct user gesture.
    console.warn("Item filter sound did not play", error);
  }
}

function itemDropBreakdown(rarity: string): ItemDropCounter[] {
  const breakdown = state.value.stats.itemBreakdown?.[rarity] ?? {};
  return sortedDropBreakdown(breakdown);
}

function toggleLog(log: LogEntry) {
  const next = new Set(expandedLogIds.value);
  if (next.has(log.id)) next.delete(log.id);
  else next.add(log.id);
  expandedLogIds.value = next;
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

    <UpdateBanner v-if="!compactMode && availableUpdate" :update="availableUpdate" @open="openAvailableUpdate" @ignore="ignoreAvailableUpdate" />

    <CompactView
      v-if="compactMode"
      v-model:show-shopping="showCompactShopping"
      :state="state"
      :capture-status-label="captureStatusLabel"
      :compact-clock="compactClock"
      :session-duration="sessionDuration"
      :zone-countdown="zoneCountdown"
      :compact-tracked-items="compactTrackedItems"
      :ore-drop-total="oreDropTotal"
      :active-shopping-item="activeShoppingItem"
      :shopping-list-items="shoppingListItems"
      @copy-shopping-item="copyShoppingItem($event, true)"
    />

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

      <LiveView
        v-if="activeTab === 'live'"
        v-model:show-capture-details="showCaptureDetails"
        v-model:expanded-drop-rarity="expandedDropRarity"
        v-model:timeline-limit="timelineLimit"
        v-model:timeline-type="timelineType"
        v-model:hide-socketables="hideSocketables"
        v-model:hide-keys="hideKeys"
        v-model:hide-materials="hideMaterials"
        v-model:shopping-draft-item="shoppingDraftItem"
        v-model:item-filter-muted="itemFilterMuted"
        v-model:log-limit="logLimit"
        :state="state"
        :capture-status-label="captureStatusLabel"
        :session-duration="sessionDuration"
        :current-gold-label="currentGoldLabel"
        :zone-countdown="zoneCountdown"
        :zone-reset-label="zoneResetLabel"
        :tracked-items="trackedItems"
        :key-drop-total="keyDropTotal"
        :ore-drop-total="oreDropTotal"
        :visible-item-timeline="visibleItemTimeline"
        :item-timeline-count="state.stats.itemTimeline.length"
        :log-limit-options="logLimitOptions"
        :item-type-options="itemTypeOptions"
        :shopping-list-items="shoppingListItems"
        :shopping-suggestions="shoppingSuggestions"
        :active-shopping-item="activeShoppingItem"
        :active-item-filter-groups="activeItemFilterGroups"
        :item-filter-group-count="itemFilterGroups.length"
        :watched-item-count="watchedItemCount"
        :last-item-filter-match="lastItemFilterMatch"
        :recent-logs="recentLogs"
        :expanded-log-ids="expandedLogIds"
        @copy-shopping-item="copyShoppingItem($event, false)"
        @add-shopping-item="addShoppingItem"
        @remove-shopping-item="removeShoppingItem"
        @test-item-filter-sound="testItemFilterSound"
        @configure-filter="activeTab = 'filter'"
        @toggle-log="toggleLog"
      />

      <ItemFilterView
        v-else-if="activeTab === 'filter'"
        v-model:item-filter-muted="itemFilterMuted"
        v-model:item-filter-draft-group-name="itemFilterDraftGroupName"
        v-model:item-filter-draft-item="itemFilterDraftItem"
        :item-filter-groups="itemFilterGroups"
        :selected-item-filter-group="selectedItemFilterGroup"
        :selected-item-filter-grouped-items="selectedItemFilterGroupedItems"
        :item-filter-suggestions="itemFilterSuggestions"
        :item-type-options="itemTypeOptions"
        :developer-item-research-enabled="developerItemResearchEnabled"
        :item-research-entries="itemResearchEntries"
        :unresolved-item-research-count="unresolvedItemResearchEntries.length"
        @add-group="addItemFilterGroup"
        @select-group="selectItemFilterGroup"
        @remove-group="removeItemFilterGroup"
        @add-item-to-group="addItemToFilterGroup"
        @remove-item-from-group="removeItemFromFilterGroup"
        @test-sound="testItemFilterSound"
        @save-item-research-entry="saveItemResearchEntry"
        @ignore-item-research-entry="ignoreItemResearchEntry"
        @reset-item-research-entry="resetItemResearchEntry"
        @clear-resolved-item-research-entries="clearResolvedItemResearchEntries"
      />

      <PastRunsView
        v-else
        :expanded-drop-key="expandedPastRunDropKey"
        :report-config="postRunReport"
        :past-runs="pastRuns"
        @update:expanded-drop-key="expandedPastRunDropKey = $event"
        @update:report-config="updatePostRunReportConfig"
      />
    </div>
    <SettingsModal
      v-if="showSettings"
      v-model:log-limit="draftLogLimit"
      v-model:timeline-limit="draftTimelineLimit"
      v-model:timeline-type="draftTimelineType"
      v-model:launch-through-steam="draftLaunchThroughSteam"
      v-model:game-executable-path="draftGameExecutablePath"
      v-model:show-capture-details="draftShowCaptureDetails"
      v-model:create-debug-mode="draftCreateDebugMode"
      v-model:always-on-top="draftAlwaysOnTop"
      v-model:lock-compact-location="draftLockCompactLocation"
      v-model:hide-socketables="draftHideSocketables"
      v-model:hide-keys="draftHideKeys"
      v-model:hide-materials="draftHideMaterials"
      v-model:developer-item-research-enabled="draftDeveloperItemResearchEnabled"
      v-model:unknown-item-audio-prompt="draftUnknownItemAudioPrompt"
      v-model:skip-empty-runs="draftSkipEmptyRuns"
      v-model:min-run-duration-minutes="draftMinRunDurationMinutes"
      v-model:config-include-app-settings="configIncludeAppSettings"
      v-model:config-include-run-saving="configIncludeRunSaving"
      v-model:config-include-report-tracking="configIncludeReportTracking"
      v-model:config-include-loot-filters="configIncludeLootFilters"
      v-model:config-include-item-research="configIncludeItemResearch"
      :log-limit-options="logLimitOptions"
      :item-type-options="itemTypeOptions"
      @close="closeSettings"
      @choose-game-executable="chooseGameExecutable"
      @export-configuration="exportConfiguration"
      @import-configuration="importConfiguration"
      @reset="resetDraftPreferences"
      @apply="applyDraftPreferences"
    />
    <div v-if="toastMessage" class="toast-bubble" role="status">{{ toastMessage }}</div>
    <span class="app-version">v{{ appVersion }}</span>
    <div class="resize-grip" aria-hidden="true"></div>
  </main>
</template>

