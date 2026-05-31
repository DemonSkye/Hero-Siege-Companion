<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
import type { CompanionState, LogEntry } from "../../shared/app-state";
import { createInitialCompanionState } from "../../shared/initial-state";
import AppTitlebar from "./components/AppTitlebar.vue";
import CompactView from "./components/CompactView.vue";
import LiveSessionHeader from "./components/LiveSessionHeader.vue";
import UpdateBanner from "./components/UpdateBanner.vue";
import WhatsNewPrompt from "./components/WhatsNewPrompt.vue";
import { useToast } from "./lib/app-toast";
import { compactFilterGroupRecoveryOptions } from "./lib/compact-tiles";
import { ITEM_TYPE_OPTIONS, shoppingAutocompleteNames } from "./lib/item-options";
import { itemFilterIdFromTimelineValue, type ItemFilterGroup } from "./lib/item-filters";
import { useItemFilterRuntime } from "./lib/item-filter-runtime";
import {
  createItemResearchExportPayload,
  type ItemResearchExportScope,
} from "./lib/item-research";
import { useItemResearchRuntime } from "./lib/item-research-runtime";
import { useAppPreferences } from "./lib/app-preferences";
import {
  LOG_LIMIT_OPTIONS,
  createConfigurationExportPayload,
  defaultPreferences,
  importConfigurationPayload,
  loadPreferences,
  savePreferences,
  type UiPreferences,
} from "./lib/preferences";
import { withoutPostRunReportItemFilterGroup } from "./lib/report-config";
import {
  DEFAULT_THEME_ACCENTS,
  THEME_OPTIONS,
  createThemeExportPayload,
  createThemeTemplatePayload,
  effectiveThemeForegroundFill,
  effectiveThemeTexture,
  importThemePayload,
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

type SettingsTab = "general" | "capture" | "appearance" | "sounds" | "dashboard" | "whatsNew" | "support" | "config";

const ItemFilterView = defineAsyncComponent(() => import("./components/ItemFilterView.vue"));
const LiveView = defineAsyncComponent(() => import("./components/LiveView.vue"));
const PastRunsView = defineAsyncComponent(() => import("./components/PastRunsView.vue"));
const SettingsModal = defineAsyncComponent(() => import("./components/SettingsModal.vue"));

const state = ref<CompanionState>(createInitialCompanionState());

const now = ref(Date.now());
let unsubscribe: (() => void) | null = null;
let clock: number | null = null;
const logLimitOptions = LOG_LIMIT_OPTIONS;
const showSettings = ref(false);
const settingsInitialTab = ref<SettingsTab>("general");
const showCompactZone = ref(false);
const activeTab = ref<"live" | "past" | "filter">("live");
const appVersion = WHATS_NEW_RELEASE.version;
const expandedLogIds = ref<Set<string>>(new Set());
const expandedDropRarity = ref<string | null>(null);
const hideUnfilteredTimelineItems = ref(false);
const itemTypeOptions = ITEM_TYPE_OPTIONS;
const {
  logLimit,
  timelineLimit,
  showCaptureDetails,
  alwaysOnTop,
  lockCompactLocation,
  hideSocketables,
  hideKeys,
  hideMaterials,
  timelineType,
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
} = useAppPreferences();
const { toastMessage, showToast } = useToast();
const {
  supportDiagnosticsInfo,
  supportBundleBusy,
  supportDiagnostics,
  refreshSupportDiagnosticsInfo,
  saveSupportDiagnostics,
  copySupportDiagnosticsSummary,
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
  syncWindowMode,
  openCompactSettings,
  toggleCompactMode,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
} = useWindowMode({ alwaysOnTop, lockCompactLocation, showSettings, openSettings });
const {
  itemFilterDraftItem,
  itemFilterDraftGroupName,
  itemFilterMatchHistory,
  itemFilterSoundOptionsList,
  selectedItemFilterGroup,
  selectedItemFilterGroupedItems,
  itemFilterSuggestions,
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
} = useItemFilterRuntime({ itemFilterGroups, itemFilterMuted, customItemFilterSounds, showToast });
const {
  captureStatusLabel,
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
  timelineLimit,
  timelineType,
  hideUnfilteredTimelineItems,
  hideKeys,
  hideMaterials,
  hideSocketables,
});
const {
  unresolvedItemResearchEntries,
  initializeItemResearchSeenItems,
  processItemResearchTimeline,
  saveItemResearchEntry,
  ignoreItemResearchEntry,
  resetItemResearchEntry,
  clearResolvedItemResearchEntries,
  clearIgnoredItemResearchEntries,
  identifyTimelineItem,
} = useItemResearchRuntime({
  itemResearchEntries,
  developerItemResearchEnabled,
  unknownItemAudioPrompt,
  showToast,
  openItemFilterTab: () => {
    activeTab.value = "filter";
  },
});
const { availableUpdate, checkForUpdateNotice, openAvailableUpdate, ignoreAvailableUpdate } = useUpdateNotice();
const { showWhatsNewPrompt, maybeShowWhatsNewPrompt, dismissWhatsNewPrompt, openWhatsNewFromPrompt } = useWhatsNewPrompt(
  WHATS_NEW_RELEASE.version,
  () => openSettings("whatsNew"),
);
const effectiveThemeId = computed(() => (compactMode.value ? compactThemeId.value : themeId.value));
const activeThemeAccent = computed(() => themeAccents.value[effectiveThemeId.value] ?? DEFAULT_THEME_ACCENTS[effectiveThemeId.value]);
const activeBackgroundTexture = computed(() =>
  compactMode.value
    ? effectiveThemeTexture(compactThemeId.value, compactThemeTextures.value)
    : effectiveThemeTexture(themeId.value, themeTextures.value),
);
const activeForegroundFill = computed(() =>
  compactMode.value
    ? effectiveThemeForegroundFill(compactThemeId.value, compactThemeForegroundFills.value)
    : effectiveThemeForegroundFill(themeId.value, themeForegroundFills.value),
);
const recoverableCompactFilterGroups = computed(() => compactFilterGroupRecoveryOptions(compactRunTiles.value, itemFilterGroups.value));
const activeViewTitle = computed(() => {
  if (activeTab.value === "filter") return "Item Filter";
  if (activeTab.value === "past") return "Past Runs";
  return "Live Session";
});
useThemeApplication(effectiveThemeId, activeThemeAccent, themeTokenMaps, activeBackgroundTexture, activeForegroundFill);

onMounted(async () => {
  applyUiPreferences(loadPreferences());
  await syncWindowMode();
  state.value = await window.heroSiegeCompanion.getState();
  initializeItemFilterSeenItems(state.value.stats.itemTimeline);
  initializeItemResearchSeenItems(state.value.stats.itemTimeline);
  maybeShowWhatsNewPrompt();
  void refreshSupportDiagnosticsInfo();
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

watch([...preferenceWatchSources, shoppingListItems], () => {
  savePreferences(currentUiPreferences());
  clampActiveShoppingIndex();
  clampActiveItemFilterGroup();
}, { deep: true });

watch([timelineType, itemFilterGroups], () => {
  const groupId = itemFilterIdFromTimelineValue(timelineType.value);
  if (groupId && !itemFilterGroups.value.some((group) => group.id === groupId)) {
    timelineType.value = "all";
  }
}, { deep: true });

onUnmounted(() => {
  unsubscribe?.();
  if (clock) window.clearInterval(clock);
});

function currentUiPreferences(): UiPreferences {
  return currentPreferences(shoppingListItems.value);
}

function currentDraftUiPreferences(): UiPreferences {
  return currentDraftPreferences(shoppingListItems.value);
}

function applyUiPreferences(preferences: UiPreferences): void {
  applyPreferences(preferences);
  shoppingListItems.value = preferences.shoppingListItems;
  clampActiveShoppingIndex();
  clampActiveItemFilterGroup();
}

function loadCurrentDraftPreferences(preferences = currentUiPreferences()): void {
  loadDraftPreferences(preferences, state.value.runArchivePreferences, state.value.capturePreferences);
}

async function toggleCapture() {
  state.value = state.value.captureRunning
    ? await window.heroSiegeCompanion.stopCapture()
    : await window.heroSiegeCompanion.launchGameOrCapture({
        executablePath: currentUiPreferences().gameExecutablePath,
        launchThroughSteam: currentUiPreferences().launchThroughSteam,
      });
}

async function resetStats() {
  const previousRunCount = pastRuns.value.length;
  state.value = await window.heroSiegeCompanion.resetStats();
  resetItemFilterSession(state.value.stats.itemTimeline);
  if ((state.value.pastRuns?.length ?? 0) > previousRunCount) activeTab.value = "past";
}

async function toggleRunPaused() {
  if (!canToggleRunPaused.value) return;
  state.value = state.value.runStatus === "paused" ? await window.heroSiegeCompanion.resumeRun() : await window.heroSiegeCompanion.pauseRun();
}

async function updatePastRunTags(runId: string, tags: string[]) {
  state.value = await window.heroSiegeCompanion.setPastRunTags(runId, tags);
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

function openSettings(tab?: SettingsTab) {
  loadCurrentDraftPreferences();
  if (tab) settingsInitialTab.value = tab;
  showSettings.value = true;
  void refreshSupportDiagnosticsInfo();
}

function closeSettings() {
  showSettings.value = false;
}

function resetDraftPreferences() {
  loadDraftPreferences(defaultPreferences, { skipEmptyRuns: false, minDurationMinutes: 0 }, { createDebugMode: false });
}

async function applyDraftPreferences() {
  applyUiPreferences(currentDraftUiPreferences());
  savePreferences(currentUiPreferences());
  state.value = await window.heroSiegeCompanion.setRunArchivePreferences(currentDraftRunArchivePreferences());
  state.value = await window.heroSiegeCompanion.setCapturePreferences(currentDraftCapturePreferences());
  showSettings.value = false;
  await syncWindowMode();
}

async function exportConfiguration() {
  try {
    const payload = createConfigurationExportPayload(
      currentDraftUiPreferences(),
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
    const transferOptions = currentConfigurationTransferOptions();
    const contents = await window.heroSiegeCompanion.importConfiguration(transferOptions.includeSounds);
    if (!contents) return;

    const imported = importConfigurationPayload(contents, currentUiPreferences(), transferOptions);
    applyUiPreferences(imported.uiPreferences);
    savePreferences(currentUiPreferences());

    if (imported.runArchivePreferences) {
      state.value = await window.heroSiegeCompanion.setRunArchivePreferences(imported.runArchivePreferences);
    }
    if (imported.capturePreferences) {
      state.value = await window.heroSiegeCompanion.setCapturePreferences(imported.capturePreferences);
    }

    loadCurrentDraftPreferences();
    await syncWindowMode();
    showToast("Configuration imported");
  } catch {
    showToast("Configuration import failed");
  }
}

async function exportTheme() {
  try {
    const payload = createThemeExportPayload(
      draftThemeId.value,
      draftThemeAccents.value,
      draftThemeTokenMaps.value,
      draftThemeTextures.value,
      draftThemeForegroundFills.value,
    );
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
    const payload = createThemeTemplatePayload(draftThemeId.value);
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
    const imported = importThemePayload(
      contents,
      draftThemeId.value,
      draftThemeAccents.value,
      draftThemeTokenMaps.value,
      draftThemeTextures.value,
      draftThemeForegroundFills.value,
    );
    draftThemeId.value = imported.themeId;
    draftThemeAccents.value = imported.themeAccents;
    draftThemeTokenMaps.value = imported.themeTokenMaps;
    draftThemeTextures.value = imported.themeTextureMaps;
    draftThemeForegroundFills.value = imported.themeForegroundFillMaps;
    showToast("Theme imported");
  } catch {
    showToast("Theme import failed");
  }
}

async function exportItemResearch(scope: ItemResearchExportScope = "all") {
  try {
    const payload = createItemResearchExportPayload(itemResearchEntries.value, { scope });
    const exported = await window.heroSiegeCompanion.exportItemResearch(JSON.stringify(payload, null, 2));
    if (exported) showToast("Research JSON exported. Share a gist with sarevok9 on Reddit or Snyne on Discord.");
  } catch {
    showToast("Research export failed");
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

async function chooseGameExecutable() {
  const selected = await window.heroSiegeCompanion.chooseGameExecutable();
  if (!selected) return;
  draftGameExecutablePath.value = selected;
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
      @toggle-compact-mode="toggleCompactMode"
      @open-compact-settings="openCompactSettings"
      @minimize-window="minimizeWindow"
      @toggle-maximize-window="toggleMaximizeWindow"
      @close-window="closeWindow"
    />

    <UpdateBanner v-if="!compactMode && availableUpdate" :update="availableUpdate" @open="openAvailableUpdate" @ignore="ignoreAvailableUpdate" />

    <CompactView
      v-if="compactMode"
      v-model:show-zone="showCompactZone"
      :state="state"
      :compact-run-tile-displays="compactRunTileDisplays"
      :run-paused-label="runPausedLabel"
      :can-toggle-run-paused="canToggleRunPaused"
      @toggle-run-paused="toggleRunPaused"
      @end-run="resetStats"
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
        v-model:timeline-limit="timelineLimit"
        v-model:timeline-type="timelineType"
        v-model:hide-socketables="hideSocketables"
        v-model:hide-keys="hideKeys"
        v-model:hide-materials="hideMaterials"
        v-model:hide-unfiltered-items="hideUnfilteredTimelineItems"
        v-model:shopping-draft-item="shoppingDraftItem"
        v-model:log-limit="logLimit"
        :state="state"
        :capture-status-label="captureStatusLabel"
        :run-tile-displays="compactRunTileDisplays"
        :zone-countdown="zoneCountdown"
        :zone-reset-label="zoneResetLabel"
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
        :developer-item-research-enabled="developerItemResearchEnabled"
        :recent-logs="recentLogs"
        :expanded-log-ids="expandedLogIds"
        @copy-shopping-item="copyShoppingItem($event, false)"
        @add-shopping-item="addShoppingItem"
        @remove-shopping-item="removeShoppingItem"
        @open-npcap-guide="openNpcapGuide"
        @open-item-filter-group="openItemFilterGroup"
        @identify-timeline-item="identifyTimelineItem"
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
        :selected-item-filter-group="selectedItemFilterGroup"
        :selected-item-filter-grouped-items="selectedItemFilterGroupedItems"
        :item-filter-suggestions="itemFilterSuggestions"
        :item-type-options="itemTypeOptions"
        :developer-item-research-enabled="developerItemResearchEnabled"
        :item-research-entries="itemResearchEntries"
        :unresolved-item-research-count="unresolvedItemResearchEntries.length"
        @add-group="addItemFilterGroup"
        @select-group="selectItemFilterGroup"
        @remove-group="removeItemFilterGroupAndReportRefs"
        @restore-missing-group="restoreMissingItemFilterGroup($event.id, $event.name)"
        @update-group="updateItemFilterGroup"
        @add-item-to-group="addItemToFilterGroup"
        @remove-item-from-group="removeItemFromFilterGroup"
        @test-sound="testItemFilterSound"
        @export-item-research="exportItemResearch"
        @save-item-research-entry="saveItemResearchEntry"
        @ignore-item-research-entry="ignoreItemResearchEntry"
        @reset-item-research-entry="resetItemResearchEntry"
        @clear-resolved-item-research-entries="clearResolvedItemResearchEntries"
        @clear-ignored-item-research-entries="clearIgnoredItemResearchEntries"
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
      v-model:theme-id="draftThemeId"
      v-model:compact-theme-id="draftCompactThemeId"
      v-model:theme-accents="draftThemeAccents"
      v-model:theme-textures="draftThemeTextures"
      v-model:compact-theme-textures="draftCompactThemeTextures"
      v-model:theme-foreground-fills="draftThemeForegroundFills"
      v-model:compact-theme-foreground-fills="draftCompactThemeForegroundFills"
      v-model:skip-empty-runs="draftSkipEmptyRuns"
      v-model:min-run-duration-minutes="draftMinRunDurationMinutes"
      v-model:config-include-app-settings="configIncludeAppSettings"
      v-model:config-include-run-saving="configIncludeRunSaving"
      v-model:config-include-report-tracking="configIncludeReportTracking"
      v-model:config-include-loot-filters="configIncludeLootFilters"
      v-model:config-include-sounds="configIncludeSounds"
      v-model:config-include-item-research="configIncludeItemResearch"
      v-model:compact-run-tiles="compactRunTiles"
      :log-limit-options="logLimitOptions"
      :item-type-options="itemTypeOptions"
      :item-filter-groups="itemFilterGroups"
      :item-suggestions="shoppingAutocompleteNames"
      :theme-options="THEME_OPTIONS"
      :custom-item-filter-sounds="customItemFilterSounds"
      :support-diagnostics="supportDiagnostics"
      :support-generated-files="supportDiagnosticsInfo.generatedFiles"
      :support-log-files="supportDiagnosticsInfo.logFiles"
      :support-logs-path="supportDiagnosticsInfo.userDataPath"
      :support-bundle-busy="supportBundleBusy"
      :whats-new="WHATS_NEW_RELEASE"
      :initial-tab="settingsInitialTab"
      @close="closeSettings"
      @choose-game-executable="chooseGameExecutable"
      @update-theme-accent="updateDraftThemeAccent"
      @import-theme="importTheme"
      @export-theme="exportTheme"
      @export-theme-template="exportThemeTemplate"
      @import-sounds="importItemFilterSounds"
      @export-sounds="exportItemFilterSoundPack"
      @remove-sound="removeItemFilterSound"
      @save-support-diagnostics="saveSupportDiagnostics"
      @copy-support-diagnostics-summary="copySupportDiagnosticsSummary"
      @export-configuration="exportConfiguration"
      @import-configuration="importConfiguration"
      @settings-tab-change="settingsInitialTab = $event"
      @reset="resetDraftPreferences"
      @apply="applyDraftPreferences"
    />
    <WhatsNewPrompt v-if="showWhatsNewPrompt && !showSettings" :version="WHATS_NEW_RELEASE.version" @open="openWhatsNewFromPrompt" @dismiss="dismissWhatsNewPrompt" />
    <div v-if="toastMessage" class="toast-bubble" role="status">{{ toastMessage }}</div>
    <span class="app-version">v{{ appVersion }}</span>
    <div class="resize-grip" aria-hidden="true"></div>
  </main>
</template>

