<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
import type { CaptureDiagnosticsLevel, CaptureDiagnosticsMode, CompanionState, LogEntry } from "../../shared/app-state";
import { mergeCompanionStateUpdate } from "../../shared/app-state";
import { createInitialCompanionState } from "../../shared/initial-state";
import AppTitlebar from "./components/AppTitlebar.vue";
import CompactView from "./components/CompactView.vue";
import LiveSessionHeader from "./components/LiveSessionHeader.vue";
import UpdateBanner from "./components/UpdateBanner.vue";
import WhatsNewPrompt from "./components/WhatsNewPrompt.vue";
import { useToast } from "./lib/app-toast";
import { compactFilterGroupRecoveryOptions } from "./lib/compact-tiles";
import { useConfigurationBackupRuntime } from "./lib/configuration-backup-runtime";
import { ITEM_TYPE_OPTIONS, shoppingAutocompleteNames } from "./lib/item-options";
import { itemFilterIdFromTimelineValue, type ItemFilterGroup } from "./lib/item-filters";
import { useItemFilterRuntime } from "./lib/item-filter-runtime";
import { createItemResearchExportPayload } from "./lib/item-research";
import { useLiveRunHistory } from "./lib/live-run-history";
import { useAppPreferences } from "./lib/app-preferences";
import {
  LOG_LIMIT_OPTIONS,
  createFactoryResetPreferences,
  defaultPreferences,
  loadPreferences,
  savePreferences,
  type UiPreferences,
} from "./lib/preferences";
import { withoutPostRunReportItemFilterGroup } from "./lib/report-config";
import {
  DEFAULT_THEME_ACCENTS,
  THEME_OPTIONS,
  THEME_TOKEN_OPTIONS,
  createThemeExportPayload,
  createThemeTemplatePayload,
  effectiveThemeForegroundFill,
  effectiveThemeTexture,
  importThemePayload,
  themeHasCustomization,
} from "./lib/themes";
import { useThemeApplication } from "./lib/theme-application";
import { useSessionDisplay } from "./lib/session-display";
import type { PastRunsExportPayload } from "./lib/past-runs";
import { useShoppingListRuntime } from "./lib/shopping-list-runtime";
import { useSupportDiagnosticsRuntime } from "./lib/support-diagnostics-runtime";
import { useUpdateNotice } from "./lib/update-notice";
import { useWhatsNewPrompt } from "./lib/whats-new-prompt";
import { WHATS_NEW_RELEASE } from "./lib/whats-new";
import { useWindowMode } from "./lib/window-mode";

type SettingsSection = "app" | "appearance" | "features" | "support" | "developers";
type SettingsTarget = SettingsSection | "whatsNew";

const CompactCustomizeModal = defineAsyncComponent(() => import("./components/CompactCustomizeModal.vue"));
const ItemFilterView = defineAsyncComponent(() => import("./components/ItemFilterView.vue"));
const LiveView = defineAsyncComponent(() => import("./components/LiveView.vue"));
const PastRunsView = defineAsyncComponent(() => import("./components/PastRunsView.vue"));
const SettingsModal = defineAsyncComponent(() => import("./components/SettingsModal.vue"));

const state = ref<CompanionState>(createInitialCompanionState());
const stateHydrated = ref(false);
const now = ref(Date.now());
const showSettings = ref(false);
const showCompactCustomization = ref(false);
const settingsInitialTab = ref<SettingsTarget>("app");
const showCompactZone = ref(false);
const satanicZoneRefreshSubmitting = ref(false);
const activeTab = ref<"live" | "past" | "filter">("live");
const expandedLogIds = ref<Set<string>>(new Set());
const expandedDropRarity = ref<string | null>(null);
const diagnosticsBusyLevel = ref<CaptureDiagnosticsLevel | null>(null);
const factoryResetBusy = ref(false);
const saveStatus = ref<"saved" | "saving" | "error">("saved");
const appVersion = WHATS_NEW_RELEASE.version;
const logLimitOptions = LOG_LIMIT_OPTIONS;
const itemTypeOptions = ITEM_TYPE_OPTIONS;
let preferencesLoaded = false;
let preferenceSaveGeneration = 0;
let unsubscribe: (() => void) | null = null;
let clock: number | null = null;

const {
  logLimit,
  showCaptureDetails,
  hideSocketables,
  hideKeys,
  hideMaterials,
  hideUnfilteredTimelineItems,
  timelineType,
  gameExecutablePath,
  launchThroughSteam,
  themeId,
  compactThemeId,
  themeCustomMode,
  compactThemeCustomMode,
  compactThemeMatchesApp,
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
  hiddenDashboardPanels,
  itemResearchEntries,
  preferenceWatchSources,
  currentPreferences,
  applyPreferences,
  updatePostRunReportConfig,
} = useAppPreferences();
const { toastMessage, showToast } = useToast();
const {
  supportDiagnosticsInfo,
  supportBundleBusy,
  supportDiagnostics,
  refreshSupportDiagnosticsInfo,
  saveSupportDiagnostics,
  copySupportDiagnosticsSummary,
  openSupportLogsDirectory,
  openNpcapGuide,
} = useSupportDiagnosticsRuntime({ state, showToast });
const {
  shoppingListItems,
  shoppingDraftItem,
  activeShoppingItem,
  shoppingSuggestions,
  copyShoppingItem,
  addShoppingItem,
  removeShoppingItem,
  clampActiveShoppingIndex,
} = useShoppingListRuntime({ showToast });
const {
  compactMode,
  fullWindowPinned,
  syncWindowMode,
  openCompactCustomization,
  toggleCompactMode,
  toggleFullWindowPinned,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
} = useWindowMode({ showSettings, showCompactCustomization });
const {
  itemFilterDraftItem,
  itemFilterDraftGroupName,
  itemFilterMatchHistory,
  itemFilterSoundOptionsList,
  selectedItemFilterGroup,
  selectedItemFilterGroupedItems,
  itemFilterSuggestions,
  pendingItemFilterPackImport,
  itemFilterPackImportBusy,
  addItemFilterGroup,
  removeItemFilterGroup,
  restoreMissingItemFilterGroup,
  selectItemFilterGroup,
  updateItemFilterGroup,
  addItemToFilterGroup,
  removeItemFromFilterGroup,
  clampActiveItemFilterGroup,
  initializeItemFilterSeenItems,
  resetItemFilterSession,
  processItemFilterTimeline,
  testItemFilterSound,
  importItemFilterSounds,
  exportItemFilterSoundPack,
  removeItemFilterSound,
  exportItemFilterPack,
  prepareItemFilterPackImport,
  confirmItemFilterPackImport,
  discardPendingItemFilterPackImport,
} = useItemFilterRuntime({ itemFilterGroups, itemFilterMuted, customItemFilterSounds, showToast });
const {
  captureStatusLabel,
  runScoreDisplays,
  compactRunTileDisplays,
  runPausedLabel,
  canToggleRunPaused,
  zoneCountdown,
  zoneResetLabel,
  keyDropTotal,
  oreDropTotal,
  trackedItems,
  itemTimelineSourceCount,
  visibleItemTimeline,
  recentLogs,
  pastRuns,
} = useSessionDisplay({
  state,
  now,
  compactRunTiles,
  itemFilterGroups,
  itemFilterMatchHistory,
  logLimit,
  timelineType,
  hideUnfilteredTimelineItems,
  hideKeys,
  hideMaterials,
  hideSocketables,
});
const {
  lanes: liveRunGraphLanes,
  customItems: liveRunGraphCustomItems,
  enabledStandardMetrics: liveRunGraphEnabledStandardMetrics,
  elapsedMs: liveRunGraphElapsedMs,
  addCustomItem: addLiveRunGraphItem,
  removeCustomItem: removeLiveRunGraphItem,
  setStandardMetricEnabled: setLiveRunGraphStandardMetric,
} = useLiveRunHistory({ state, now, ready: stateHydrated });
const { availableUpdate, checkForUpdateNotice, openAvailableUpdate, ignoreAvailableUpdate } = useUpdateNotice();
const { showWhatsNewPrompt, maybeShowWhatsNewPrompt, dismissWhatsNewPrompt, openWhatsNewFromPrompt } = useWhatsNewPrompt(
  WHATS_NEW_RELEASE.version,
  () => openSettings("whatsNew"),
);
const {
  backupPreview,
  backupBusy,
  exportBackup,
  chooseBackup,
  confirmRestoreBackup,
  cancelRestoreBackup,
} = useConfigurationBackupRuntime({
  currentPreferences: currentUiPreferences,
  applyPreferences: applyUiPreferences,
  showToast,
});

const compactUsesAppTheme = computed(() => compactMode.value && compactThemeMatchesApp.value);
const effectiveThemeId = computed(() => (
  compactMode.value && !compactThemeMatchesApp.value ? compactThemeId.value : themeId.value
));
const effectiveThemeCustomMode = computed(() => (
  compactMode.value && !compactThemeMatchesApp.value ? compactThemeCustomMode.value : themeCustomMode.value
));
const activeThemeAccent = computed(() => (
  effectiveThemeCustomMode.value
    ? themeAccents.value[effectiveThemeId.value] ?? DEFAULT_THEME_ACCENTS[effectiveThemeId.value]
    : DEFAULT_THEME_ACCENTS[effectiveThemeId.value]
));
const activeThemeTokenMaps = computed(() => effectiveThemeCustomMode.value ? themeTokenMaps.value : {});
const activeBackgroundTexture = computed(() => {
  if (!effectiveThemeCustomMode.value) return effectiveThemeTexture(effectiveThemeId.value, {});
  return effectiveThemeTexture(
    effectiveThemeId.value,
    compactMode.value && !compactUsesAppTheme.value ? compactThemeTextures.value : themeTextures.value,
  );
});
const activeForegroundFill = computed(() => {
  if (!effectiveThemeCustomMode.value) return effectiveThemeForegroundFill(effectiveThemeId.value, {});
  return effectiveThemeForegroundFill(
    effectiveThemeId.value,
    compactMode.value && !compactUsesAppTheme.value ? compactThemeForegroundFills.value : themeForegroundFills.value,
  );
});
const legacyThemeAvailable = computed(() => themeHasCustomization(
  themeId.value,
  themeAccents.value,
  themeTokenMaps.value,
  themeTextures.value,
  themeForegroundFills.value,
));
const legacyCompactThemeAvailable = computed(() => themeHasCustomization(
  compactThemeId.value,
  themeAccents.value,
  themeTokenMaps.value,
  compactThemeTextures.value,
  compactThemeForegroundFills.value,
));
const recoverableCompactFilterGroups = computed(() => compactFilterGroupRecoveryOptions(compactRunTiles.value, itemFilterGroups.value));
const activeViewTitle = computed(() => activeTab.value === "filter" ? "Item Filter" : activeTab.value === "past" ? "Past Runs" : "Live Session");
const satanicZoneRefreshEnabled = computed({
  get: () => state.value.satanicZone.refreshEnabled,
  set: (enabled: boolean) => { void setSatanicZoneRefreshEnabled(enabled); },
});
const legacyResearchAvailable = computed(() => itemResearchEntries.value.length > 0);

useThemeApplication(effectiveThemeId, activeThemeAccent, activeThemeTokenMaps, activeBackgroundTexture, activeForegroundFill);

onMounted(async () => {
  applyUiPreferences(loadPreferences());
  preferencesLoaded = true;
  await syncWindowMode();
  state.value = await window.heroSiegeCompanion.getState();
  stateHydrated.value = true;
  initializeItemFilterSeenItems(state.value.stats.itemTimeline);
  maybeShowWhatsNewPrompt();
  void refreshSupportDiagnosticsInfo();
  unsubscribe = window.heroSiegeCompanion.onStateUpdated((nextState) => {
    processItemFilterTimeline(nextState.stats.itemTimeline);
    state.value = mergeCompanionStateUpdate(state.value, nextState);
  });
  void checkForUpdateNotice();
  clock = window.setInterval(() => { now.value = Date.now(); }, 1000);
});

watch([...preferenceWatchSources, shoppingListItems], () => {
  if (!preferencesLoaded) return;
  persistUiPreferences();
  clampActiveShoppingIndex();
  clampActiveItemFilterGroup();
}, { deep: true });

watch([timelineType, itemFilterGroups], () => {
  const groupId = itemFilterIdFromTimelineValue(timelineType.value);
  if (groupId && !itemFilterGroups.value.some((group) => group.id === groupId)) timelineType.value = "all";
}, { deep: true });

onUnmounted(() => {
  unsubscribe?.();
  if (clock) window.clearInterval(clock);
});

function currentUiPreferences(): UiPreferences {
  return currentPreferences(shoppingListItems.value);
}

function applyUiPreferences(preferences: UiPreferences): void {
  applyPreferences(preferences);
  shoppingListItems.value = preferences.shoppingListItems;
  clampActiveShoppingIndex();
  clampActiveItemFilterGroup();
}

function persistUiPreferences(): void {
  const generation = ++preferenceSaveGeneration;
  saveStatus.value = "saving";
  try {
    if (!savePreferences(currentUiPreferences())) {
      saveStatus.value = "error";
      return;
    }
    window.setTimeout(() => {
      if (generation === preferenceSaveGeneration) saveStatus.value = "saved";
    }, 120);
  } catch {
    saveStatus.value = "error";
  }
}

async function toggleCapture() {
  state.value = state.value.captureRunning
    ? await window.heroSiegeCompanion.stopCapture()
    : await window.heroSiegeCompanion.launchGameOrCapture({
        executablePath: gameExecutablePath.value,
        launchThroughSteam: launchThroughSteam.value,
      });
}

async function resetStats() {
  const previousRunCount = pastRuns.value.length;
  state.value = await window.heroSiegeCompanion.resetStats();
  resetItemFilterSession(state.value.stats.itemTimeline);
  if ((state.value.pastRuns?.length ?? 0) > previousRunCount) activeTab.value = "past";
}

async function refreshSatanicZone() {
  if (satanicZoneRefreshSubmitting.value) return;
  satanicZoneRefreshSubmitting.value = true;
  try {
    state.value = await window.heroSiegeCompanion.refreshSatanicZone();
    if (state.value.satanicZone.phase === "refreshing") showToast("Satanic Zone refresh requested");
    else if (state.value.satanicZone.phase === "failed" || state.value.satanicZone.phase === "unavailable") showToast("Satanic Zone refresh unavailable");
  } catch {
    showToast("Satanic Zone refresh failed");
  } finally {
    satanicZoneRefreshSubmitting.value = false;
  }
}

async function setSatanicZoneRefreshEnabled(enabled: boolean) {
  try {
    state.value = await window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(enabled);
    showToast(`SZ Refresh ${enabled ? "enabled" : "disabled"}`);
  } catch {
    showToast("SZ Refresh could not be changed");
  }
}

async function setDiagnosticsMode(level: CaptureDiagnosticsLevel, mode: CaptureDiagnosticsMode) {
  if (diagnosticsBusyLevel.value) return;
  diagnosticsBusyLevel.value = level;
  try {
    state.value = await window.heroSiegeCompanion.setCaptureDiagnosticsMode(level, mode);
  } catch {
    showToast("Diagnostics mode could not be changed");
  } finally {
    diagnosticsBusyLevel.value = null;
  }
}

async function toggleRunPaused() {
  if (!canToggleRunPaused.value) return;
  state.value = state.value.runStatus === "paused" ? await window.heroSiegeCompanion.resumeRun() : await window.heroSiegeCompanion.pauseRun();
}

async function updatePastRunTags(runId: string, tags: string[]) {
  state.value = await window.heroSiegeCompanion.setPastRunTags(runId, tags);
}

async function deletePastRun(runId: string) {
  try {
    state.value = await window.heroSiegeCompanion.deletePastRun(runId);
    showToast("Past run deleted");
  } catch {
    showToast("Past run delete failed");
  }
}

async function deleteAllPastRuns() {
  try {
    state.value = await window.heroSiegeCompanion.deleteAllPastRuns();
    showToast("Past runs deleted");
  } catch {
    showToast("Past runs delete failed");
  }
}

function removeItemFilterGroupAndReportRefs(group: ItemFilterGroup) {
  removeItemFilterGroup(group);
  updatePostRunReportConfig(withoutPostRunReportItemFilterGroup(postRunReport.value, group.id));
}

function openItemFilterGroup(groupId: string) {
  const group = itemFilterGroups.value.find((candidate) => candidate.id === groupId);
  if (group) selectItemFilterGroup(group);
  activeTab.value = "filter";
}

function openSettings(tab?: SettingsTarget) {
  if (tab) settingsInitialTab.value = tab;
  showSettings.value = true;
  showCompactCustomization.value = false;
  void refreshSupportDiagnosticsInfo();
}

function resetThemes() {
  themeId.value = defaultPreferences.themeId;
  compactThemeId.value = defaultPreferences.compactThemeId;
  themeCustomMode.value = false;
  compactThemeCustomMode.value = false;
  compactThemeMatchesApp.value = true;
  themeAccents.value = { ...DEFAULT_THEME_ACCENTS };
  themeTextures.value = {};
  compactThemeTextures.value = {};
  themeForegroundFills.value = {};
  compactThemeForegroundFills.value = {};
  themeTokenMaps.value = {};
}

async function chooseGameExecutable() {
  const selected = await window.heroSiegeCompanion.chooseGameExecutable();
  if (selected) gameExecutablePath.value = selected;
}

async function exportTheme() {
  try {
    const payload = createThemeExportPayload(themeId.value, themeAccents.value, themeTokenMaps.value, themeTextures.value, themeForegroundFills.value);
    const exported = await window.heroSiegeCompanion.exportConfiguration(JSON.stringify(payload, null, 2), {
      title: "Export Hero Siege theme",
      defaultPath: "hero-siege-theme.json",
    });
    if (exported) showToast("Theme exported");
  } catch {
    showToast("Theme export failed");
  }
}

async function exportThemeTemplate() {
  try {
    const payload = createThemeTemplatePayload(themeId.value);
    const exported = await window.heroSiegeCompanion.exportConfiguration(JSON.stringify(payload, null, 2), {
      title: "Export Hero Siege starter theme",
      defaultPath: "hero-siege-theme-template.json",
    });
    if (exported) showToast("Starter theme exported");
  } catch {
    showToast("Starter theme export failed");
  }
}

async function importTheme() {
  try {
    const contents = await window.heroSiegeCompanion.importConfiguration();
    if (!contents) return;
    const imported = importThemePayload(contents, themeId.value, themeAccents.value, themeTokenMaps.value, themeTextures.value, themeForegroundFills.value);
    themeId.value = imported.themeId;
    themeAccents.value = imported.themeAccents;
    themeTokenMaps.value = imported.themeTokenMaps;
    themeTextures.value = imported.themeTextureMaps;
    themeForegroundFills.value = imported.themeForegroundFillMaps;
    themeCustomMode.value = true;
    showToast("Theme imported as Legacy Custom");
  } catch {
    showToast("Theme import failed");
  }
}

async function copyThemeTokenReference() {
  try {
    await window.heroSiegeCompanion.writeClipboardText(JSON.stringify(THEME_TOKEN_OPTIONS, null, 2));
    showToast("Theme token reference copied");
  } catch {
    showToast("Theme token reference copy failed");
  }
}

async function exportLegacyResearch() {
  try {
    const payload = createItemResearchExportPayload(itemResearchEntries.value, { scope: "all" });
    const exported = await window.heroSiegeCompanion.exportItemResearch(JSON.stringify(payload, null, 2));
    if (!exported) return;
    itemResearchEntries.value = [];
    persistUiPreferences();
    showToast("Legacy research exported and removed from preferences");
  } catch {
    showToast("Legacy research export failed");
  }
}

async function resetWindowPosition() {
  try {
    await window.heroSiegeCompanion.resetWindowBounds();
    showToast("Window position reset");
  } catch {
    showToast("Window position reset failed");
  }
}

async function factoryReset(deleteItemFilters: boolean) {
  if (factoryResetBusy.value) return;
  factoryResetBusy.value = true;
  try {
    applyUiPreferences(createFactoryResetPreferences(currentUiPreferences(), { deleteItemFilters }));
    persistUiPreferences();
    await window.heroSiegeCompanion.resetWindowBounds();
    await syncWindowMode();
    showToast(deleteItemFilters ? "Factory reset complete; item filters reset" : "Factory reset complete; item filters preserved");
  } catch {
    showToast("Factory reset failed");
  } finally {
    factoryResetBusy.value = false;
  }
}

async function exportPastRunsJson(payload: PastRunsExportPayload) {
  try {
    const exported = await window.heroSiegeCompanion.exportPastRunsJson(JSON.stringify(payload, null, 2));
    if (exported) showToast("Past runs JSON exported");
  } catch {
    showToast("Past runs export failed");
  }
}

async function exportPastRunsCsv(csv: string) {
  try {
    const exported = await window.heroSiegeCompanion.exportPastRunsCsv(csv);
    if (exported) showToast("Past runs CSV exported");
  } catch {
    showToast("Past runs CSV export failed");
  }
}

async function copyPastRunsSummary(summary: string) {
  try {
    await window.heroSiegeCompanion.writeClipboardText(summary);
    showToast("Past runs summary copied");
  } catch {
    showToast("Past runs summary copy failed");
  }
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
    <AppTitlebar
      :compact-mode="compactMode"
      :full-window-pinned="fullWindowPinned"
      @toggle-compact-mode="toggleCompactMode"
      @open-compact-customization="openCompactCustomization"
      @toggle-full-window-pinned="toggleFullWindowPinned"
      @minimize-window="minimizeWindow"
      @toggle-maximize-window="toggleMaximizeWindow"
      @close-window="closeWindow"
    />

    <UpdateBanner v-if="!compactMode && availableUpdate" :update="availableUpdate" @open="openAvailableUpdate" @ignore="ignoreAvailableUpdate" />

    <CompactView
      v-if="compactMode"
      v-model:show-zone="showCompactZone"
      :state="state"
      :now="now"
      :compact-run-tile-displays="compactRunTileDisplays"
      :run-paused-label="runPausedLabel"
      :can-toggle-run-paused="canToggleRunPaused"
      :satanic-zone-refresh-submitting="satanicZoneRefreshSubmitting"
      @toggle-run-paused="toggleRunPaused"
      @end-run="resetStats"
      @refresh-satanic-zone="refreshSatanicZone"
    />

    <LiveSessionHeader
      v-if="!compactMode"
      :capture-running="state.captureRunning"
      :run-status="state.runStatus"
      :can-toggle-run-paused="canToggleRunPaused"
      :title="activeViewTitle"
      @open-settings="openSettings()"
      @toggle-run-paused="toggleRunPaused"
      @end-run="resetStats"
      @toggle-capture="toggleCapture"
    />

    <div v-if="!compactMode" class="app-scroll">
      <nav class="view-tabs" role="tablist" aria-label="Companion views">
        <button type="button" role="tab" :aria-selected="activeTab === 'live'" :class="{ active: activeTab === 'live' }" @click="activeTab = 'live'">Live Session</button>
        <button type="button" role="tab" :aria-selected="activeTab === 'filter'" :class="{ active: activeTab === 'filter' }" @click="activeTab = 'filter'">
          Item Filter <span class="info-bubble" data-tip="Sounds are triggered from captured network traffic, so alerts can arrive a couple seconds after the item appears in game.">i</span>
        </button>
        <button type="button" role="tab" :aria-selected="activeTab === 'past'" :class="{ active: activeTab === 'past' }" @click="activeTab = 'past'">Past Runs</button>
      </nav>

      <LiveView
        v-if="activeTab === 'live'"
        v-model:show-capture-details="showCaptureDetails"
        v-model:expanded-drop-rarity="expandedDropRarity"
        v-model:timeline-type="timelineType"
        v-model:hide-socketables="hideSocketables"
        v-model:hide-keys="hideKeys"
        v-model:hide-materials="hideMaterials"
        v-model:hide-unfiltered-items="hideUnfilteredTimelineItems"
        v-model:hidden-fixtures="hiddenDashboardPanels"
        v-model:shopping-draft-item="shoppingDraftItem"
        v-model:log-limit="logLimit"
        :state="state"
        :now="now"
        :capture-status-label="captureStatusLabel"
        :run-tile-displays="runScoreDisplays"
        :live-run-graph-elapsed-ms="liveRunGraphElapsedMs"
        :run-paused-label="runPausedLabel"
        :live-run-graph-lanes="liveRunGraphLanes"
        :live-run-graph-custom-items="liveRunGraphCustomItems"
        :live-run-graph-enabled-standard-metrics="liveRunGraphEnabledStandardMetrics"
        :live-run-item-name-options="shoppingAutocompleteNames"
        :zone-countdown="zoneCountdown"
        :zone-reset-label="zoneResetLabel"
        :satanic-zone-refresh-submitting="satanicZoneRefreshSubmitting"
        :tracked-items="trackedItems"
        :key-drop-total="keyDropTotal"
        :ore-drop-total="oreDropTotal"
        :visible-item-timeline="visibleItemTimeline"
        :item-timeline-count="itemTimelineSourceCount"
        :item-filter-match-history="itemFilterMatchHistory"
        :log-limit-options="logLimitOptions"
        :item-type-options="itemTypeOptions"
        :item-filter-groups="itemFilterGroups"
        :shopping-list-items="shoppingListItems"
        :shopping-suggestions="shoppingSuggestions"
        :active-shopping-item="activeShoppingItem"
        :recent-logs="recentLogs"
        :expanded-log-ids="expandedLogIds"
        @copy-shopping-item="copyShoppingItem($event, false)"
        @add-shopping-item="addShoppingItem"
        @remove-shopping-item="removeShoppingItem"
        @open-npcap-guide="openNpcapGuide"
        @open-item-filter-group="openItemFilterGroup"
        @add-live-run-graph-item="addLiveRunGraphItem"
        @remove-live-run-graph-item="removeLiveRunGraphItem"
        @set-live-run-graph-standard-metric="setLiveRunGraphStandardMetric"
        @refresh-satanic-zone="refreshSatanicZone"
        @toggle-log="toggleLog"
      />

      <ItemFilterView
        v-else-if="activeTab === 'filter'"
        v-model:item-filter-muted="itemFilterMuted"
        v-model:item-filter-draft-group-name="itemFilterDraftGroupName"
        v-model:item-filter-draft-item="itemFilterDraftItem"
        :item-filter-groups="itemFilterGroups"
        :recoverable-compact-filter-groups="recoverableCompactFilterGroups"
        :item-filter-sounds="itemFilterSoundOptionsList"
        :custom-item-filter-sounds="customItemFilterSounds"
        :selected-item-filter-group="selectedItemFilterGroup"
        :selected-item-filter-grouped-items="selectedItemFilterGroupedItems"
        :item-filter-suggestions="itemFilterSuggestions"
        :item-type-options="itemTypeOptions"
        :pending-item-filter-pack-import="pendingItemFilterPackImport"
        :item-filter-pack-import-busy="itemFilterPackImportBusy"
        @add-group="addItemFilterGroup"
        @select-group="selectItemFilterGroup"
        @remove-group="removeItemFilterGroupAndReportRefs"
        @restore-missing-group="restoreMissingItemFilterGroup($event.id, $event.name)"
        @update-group="updateItemFilterGroup"
        @add-item-to-group="addItemToFilterGroup"
        @remove-item-from-group="removeItemFromFilterGroup"
        @test-sound="testItemFilterSound"
        @import-sounds="importItemFilterSounds"
        @export-soundpack="exportItemFilterSoundPack"
        @remove-sound="removeItemFilterSound"
        @import-filter-pack="prepareItemFilterPackImport"
        @export-filter-pack="exportItemFilterPack"
        @confirm-filter-pack-import="confirmItemFilterPackImport"
        @cancel-filter-pack-import="discardPendingItemFilterPackImport"
      />

      <PastRunsView
        v-else
        :report-config="postRunReport"
        :past-runs="pastRuns"
        :item-filter-groups="itemFilterGroups"
        @update:report-config="updatePostRunReportConfig"
        @update-run-tags="updatePastRunTags"
        @export-runs-json="exportPastRunsJson"
        @export-runs-csv="exportPastRunsCsv"
        @copy-summary="copyPastRunsSummary"
        @delete-run="deletePastRun"
        @delete-all-runs="deleteAllPastRuns"
      />
    </div>

    <SettingsModal
      v-if="showSettings"
      v-model:launch-through-steam="launchThroughSteam"
      v-model:game-executable-path="gameExecutablePath"
      v-model:theme-id="themeId"
      v-model:compact-theme-id="compactThemeId"
      v-model:theme-custom-mode="themeCustomMode"
      v-model:compact-theme-custom-mode="compactThemeCustomMode"
      v-model:compact-theme-matches-app="compactThemeMatchesApp"
      v-model:satanic-zone-refresh-enabled="satanicZoneRefreshEnabled"
      :theme-options="THEME_OPTIONS"
      :legacy-theme-available="legacyThemeAvailable"
      :legacy-compact-theme-available="legacyCompactThemeAvailable"
      :capture-diagnostics="state.captureDiagnostics"
      :diagnostics-now="now"
      :diagnostics-busy-level="diagnosticsBusyLevel"
      :support-diagnostics="supportDiagnostics"
      :support-generated-files="supportDiagnosticsInfo.generatedFiles"
      :support-log-files="supportDiagnosticsInfo.logFiles"
      :support-logs-path="supportDiagnosticsInfo.logsPath"
      :support-bundle-busy="supportBundleBusy"
      :whats-new="WHATS_NEW_RELEASE"
      :backup-preview="backupPreview"
      :backup-busy="backupBusy"
      :factory-reset-busy="factoryResetBusy"
      :legacy-research-available="legacyResearchAvailable"
      :save-status="saveStatus"
      :initial-tab="settingsInitialTab"
      @close="showSettings = false"
      @choose-game-executable="chooseGameExecutable"
      @reset-themes="resetThemes"
      @export-backup="exportBackup"
      @choose-backup="chooseBackup"
      @confirm-restore-backup="confirmRestoreBackup"
      @cancel-restore-backup="cancelRestoreBackup"
      @open-support-logs-directory="openSupportLogsDirectory"
      @save-support-diagnostics="saveSupportDiagnostics"
      @copy-support-diagnostics-summary="copySupportDiagnosticsSummary"
      @open-npcap-guide="openNpcapGuide"
      @set-diagnostics-mode="setDiagnosticsMode"
      @reset-window-position="resetWindowPosition"
      @factory-reset="factoryReset"
      @import-theme="importTheme"
      @export-theme="exportTheme"
      @export-theme-template="exportThemeTemplate"
      @copy-theme-token-reference="copyThemeTokenReference"
      @export-legacy-research="exportLegacyResearch"
      @retry-save="persistUiPreferences"
      @settings-tab-change="settingsInitialTab = $event"
    />

    <CompactCustomizeModal
      v-if="showCompactCustomization"
      v-model:compact-run-tiles="compactRunTiles"
      :item-filter-groups="itemFilterGroups"
      :item-suggestions="shoppingAutocompleteNames"
      :save-status="saveStatus"
      @close="showCompactCustomization = false"
      @reset="showToast('Compact layout reset')"
      @retry-save="persistUiPreferences"
    />

    <WhatsNewPrompt v-if="showWhatsNewPrompt && !showSettings && !showCompactCustomization" :version="WHATS_NEW_RELEASE.version" @open="openWhatsNewFromPrompt" @dismiss="dismissWhatsNewPrompt" />
    <div v-if="toastMessage" class="toast-bubble" role="status">{{ toastMessage }}</div>
    <span class="app-version">v{{ appVersion }}</span>
    <div class="resize-grip" aria-hidden="true"></div>
  </main>
</template>
