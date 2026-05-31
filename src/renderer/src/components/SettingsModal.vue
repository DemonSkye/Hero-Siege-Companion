<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { SupportDiagnosticGeneratedFileInfo, SupportDiagnosticLogFileInfo } from "../../../shared/support-diagnostics";
import type { CompactRunTileConfig } from "../lib/compact-tiles";
import type { CustomItemFilterSound, ItemFilterGroup } from "../lib/item-filters";
import type { ThemeAccentMap, ThemeForegroundFillMap, ThemeId, ThemeTextureMap } from "../lib/themes";
import type { WhatsNewRelease } from "../lib/whats-new";
import SettingsAppearanceTab from "./SettingsAppearanceTab.vue";
import SettingsCaptureTab from "./SettingsCaptureTab.vue";
import SettingsConfigTab from "./SettingsConfigTab.vue";
import SettingsDashboardTab from "./SettingsDashboardTab.vue";
import SettingsGeneralTab from "./SettingsGeneralTab.vue";
import SettingsSoundsTab from "./SettingsSoundsTab.vue";
import SettingsSupportTab from "./SettingsSupportTab.vue";
import SettingsWhatsNewTab from "./SettingsWhatsNewTab.vue";
import { useModalFocus } from "../lib/modal-focus";

interface ItemTypeOption {
  value: string;
  label: string;
}

interface ThemeOption {
  id: ThemeId;
  label: string;
  defaultAccent: string;
}

type SettingsTab = "general" | "capture" | "appearance" | "sounds" | "dashboard" | "whatsNew" | "support" | "config";

const props = defineProps<{
  logLimitOptions: number[];
  itemTypeOptions: ItemTypeOption[];
  itemFilterGroups: ItemFilterGroup[];
  itemSuggestions: string[];
  themeOptions: ThemeOption[];
  customItemFilterSounds: CustomItemFilterSound[];
  supportDiagnostics: string;
  supportGeneratedFiles: SupportDiagnosticGeneratedFileInfo[];
  supportLogFiles: SupportDiagnosticLogFileInfo[];
  supportLogsPath: string;
  supportBundleBusy: boolean;
  whatsNew: WhatsNewRelease;
  initialTab?: SettingsTab;
}>();

const emit = defineEmits<{
  close: [];
  chooseGameExecutable: [];
  updateThemeAccent: [value: string, themeId?: ThemeId];
  importTheme: [];
  exportTheme: [];
  exportThemeTemplate: [];
  importSounds: [];
  exportSounds: [];
  removeSound: [sound: CustomItemFilterSound];
  saveSupportDiagnostics: [];
  copySupportDiagnosticsSummary: [];
  exportConfiguration: [];
  importConfiguration: [];
  reset: [];
  apply: [];
  settingsTabChange: [tab: SettingsTab];
}>();

const draftLogLimit = defineModel<number>("logLimit", { required: true });
const draftTimelineLimit = defineModel<number>("timelineLimit", { required: true });
const draftTimelineType = defineModel<string>("timelineType", { required: true });
const draftLaunchThroughSteam = defineModel<boolean>("launchThroughSteam", { required: true });
const draftGameExecutablePath = defineModel<string>("gameExecutablePath", { required: true });
const draftShowCaptureDetails = defineModel<boolean>("showCaptureDetails", { required: true });
const draftCreateDebugMode = defineModel<boolean>("createDebugMode", { required: true });
const draftAlwaysOnTop = defineModel<boolean>("alwaysOnTop", { required: true });
const draftLockCompactLocation = defineModel<boolean>("lockCompactLocation", { required: true });
const draftHideSocketables = defineModel<boolean>("hideSocketables", { required: true });
const draftHideKeys = defineModel<boolean>("hideKeys", { required: true });
const draftHideMaterials = defineModel<boolean>("hideMaterials", { required: true });
const draftSkipEmptyRuns = defineModel<boolean>("skipEmptyRuns", { required: true });
const draftMinRunDurationMinutes = defineModel<number>("minRunDurationMinutes", { required: true });
const draftDeveloperItemResearchEnabled = defineModel<boolean>("developerItemResearchEnabled", { required: true });
const draftUnknownItemAudioPrompt = defineModel<boolean>("unknownItemAudioPrompt", { required: true });
const draftThemeId = defineModel<ThemeId>("themeId", { required: true });
const draftCompactThemeId = defineModel<ThemeId>("compactThemeId", { required: true });
const draftThemeAccents = defineModel<ThemeAccentMap>("themeAccents", { required: true });
const draftThemeTextures = defineModel<ThemeTextureMap>("themeTextures", { required: true });
const draftCompactThemeTextures = defineModel<ThemeTextureMap>("compactThemeTextures", { required: true });
const draftThemeForegroundFills = defineModel<ThemeForegroundFillMap>("themeForegroundFills", { required: true });
const draftCompactThemeForegroundFills = defineModel<ThemeForegroundFillMap>("compactThemeForegroundFills", { required: true });
const configIncludeAppSettings = defineModel<boolean>("configIncludeAppSettings", { required: true });
const configIncludeRunSaving = defineModel<boolean>("configIncludeRunSaving", { required: true });
const configIncludeReportTracking = defineModel<boolean>("configIncludeReportTracking", { required: true });
const configIncludeLootFilters = defineModel<boolean>("configIncludeLootFilters", { required: true });
const configIncludeSounds = defineModel<boolean>("configIncludeSounds", { required: true });
const configIncludeItemResearch = defineModel<boolean>("configIncludeItemResearch", { required: true });
const draftCompactRunTiles = defineModel<CompactRunTileConfig[]>("compactRunTiles", { required: true });

const SETTINGS_TAB_ORDER: SettingsTab[] = ["general", "capture", "appearance", "sounds", "dashboard", "whatsNew", "support", "config"];
const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  capture: "Capture",
  appearance: "Appearance",
  sounds: "Sounds",
  dashboard: "Dashboard",
  whatsNew: "What's New",
  support: "Support",
  config: "Import / Export",
};
const activeSettingsTab = ref<SettingsTab>(props.initialTab ?? "general");
const settingsDialog = ref<HTMLElement | null>(null);
const { handleModalFocusKeydown } = useModalFocus(settingsDialog);

watch(() => props.initialTab, (tab) => {
  if (tab) setActiveSettingsTab(tab, false);
});

function updateThemeAccent(value: string, themeId?: ThemeId) {
  emit("updateThemeAccent", value, themeId);
}

function selectSettingsTab(tab: SettingsTab) {
  setActiveSettingsTab(tab);
}

function setActiveSettingsTab(tab: SettingsTab, notify = true) {
  if (activeSettingsTab.value === tab) return;
  activeSettingsTab.value = tab;
  if (notify) emit("settingsTabChange", tab);
}

function settingsTabButtonId(tab: SettingsTab): string {
  return `settings-tab-${tab}`;
}

function settingsTabPanelId(tab: SettingsTab): string {
  return `settings-panel-${tab}`;
}

function handleSettingsTabKeydown(event: KeyboardEvent) {
  const currentIndex = SETTINGS_TAB_ORDER.indexOf(activeSettingsTab.value);
  const lastIndex = SETTINGS_TAB_ORDER.length - 1;
  const nextIndex =
    event.key === "ArrowRight"
      ? (currentIndex + 1) % SETTINGS_TAB_ORDER.length
      : event.key === "ArrowLeft"
        ? (currentIndex + lastIndex) % SETTINGS_TAB_ORDER.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? lastIndex
            : -1;
  if (nextIndex < 0) return;
  event.preventDefault();
  const nextTab = SETTINGS_TAB_ORDER[nextIndex];
  setActiveSettingsTab(nextTab);
  void nextTick(() => {
    document.querySelector<HTMLButtonElement>(`[data-settings-tab="${nextTab}"]`)?.focus();
  });
}
</script>

<template>
  <div class="modal-backdrop" @keydown="handleModalFocusKeydown" @keydown.esc="$emit('close')">
    <section ref="settingsDialog" class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Preferences</p>
          <h2 id="settings-title">Settings</h2>
          <p class="settings-note">These preferences are saved on this device and restored between sessions.</p>
        </div>
        <button class="settings-close" type="button" title="Close settings" aria-label="Close settings" @click="$emit('close')">x</button>
      </div>

      <nav class="settings-tabs" role="tablist" aria-label="Settings sections" @keydown="handleSettingsTabKeydown">
        <button
          v-for="tab in SETTINGS_TAB_ORDER"
          :id="settingsTabButtonId(tab)"
          :key="tab"
          :data-settings-tab="tab"
          role="tab"
          :aria-selected="activeSettingsTab === tab"
          :aria-controls="settingsTabPanelId(tab)"
          :tabindex="activeSettingsTab === tab ? 0 : -1"
          :class="{ active: activeSettingsTab === tab }"
          type="button"
          @click="selectSettingsTab(tab)"
        >
          {{ SETTINGS_TAB_LABELS[tab] }}
        </button>
      </nav>

      <section
        :id="settingsTabPanelId(activeSettingsTab)"
        class="settings-tab-panel"
        role="tabpanel"
        :aria-labelledby="settingsTabButtonId(activeSettingsTab)"
        tabindex="0"
      >
        <SettingsGeneralTab
          v-if="activeSettingsTab === 'general'"
          v-model:log-limit="draftLogLimit"
          v-model:timeline-limit="draftTimelineLimit"
          v-model:timeline-type="draftTimelineType"
          v-model:launch-through-steam="draftLaunchThroughSteam"
          v-model:game-executable-path="draftGameExecutablePath"
          v-model:always-on-top="draftAlwaysOnTop"
          v-model:lock-compact-location="draftLockCompactLocation"
          v-model:hide-socketables="draftHideSocketables"
          v-model:hide-keys="draftHideKeys"
          v-model:hide-materials="draftHideMaterials"
          :log-limit-options="logLimitOptions"
          :item-type-options="itemTypeOptions"
          :item-filter-groups="itemFilterGroups"
          @choose-game-executable="$emit('chooseGameExecutable')"
        />

        <SettingsCaptureTab
          v-else-if="activeSettingsTab === 'capture'"
          v-model:show-capture-details="draftShowCaptureDetails"
          v-model:create-debug-mode="draftCreateDebugMode"
          v-model:developer-item-research-enabled="draftDeveloperItemResearchEnabled"
          v-model:unknown-item-audio-prompt="draftUnknownItemAudioPrompt"
          v-model:skip-empty-runs="draftSkipEmptyRuns"
          v-model:min-run-duration-minutes="draftMinRunDurationMinutes"
        />

        <SettingsAppearanceTab
          v-else-if="activeSettingsTab === 'appearance'"
          v-model:theme-id="draftThemeId"
          v-model:compact-theme-id="draftCompactThemeId"
          v-model:theme-accents="draftThemeAccents"
          v-model:theme-textures="draftThemeTextures"
          v-model:compact-theme-textures="draftCompactThemeTextures"
          v-model:theme-foreground-fills="draftThemeForegroundFills"
          v-model:compact-theme-foreground-fills="draftCompactThemeForegroundFills"
          :theme-options="themeOptions"
          @update-theme-accent="updateThemeAccent"
          @import-theme="$emit('importTheme')"
          @export-theme="$emit('exportTheme')"
          @export-theme-template="$emit('exportThemeTemplate')"
        />

        <SettingsSoundsTab
          v-else-if="activeSettingsTab === 'sounds'"
          :custom-item-filter-sounds="customItemFilterSounds"
          @import-sounds="$emit('importSounds')"
          @export-sounds="$emit('exportSounds')"
          @remove-sound="$emit('removeSound', $event)"
        />

        <SettingsDashboardTab
          v-else-if="activeSettingsTab === 'dashboard'"
          v-model:compact-run-tiles="draftCompactRunTiles"
          :item-filter-groups="itemFilterGroups"
          :item-suggestions="itemSuggestions"
        />

        <SettingsWhatsNewTab
          v-else-if="activeSettingsTab === 'whatsNew'"
          :whats-new="whatsNew"
        />

        <SettingsSupportTab
          v-else-if="activeSettingsTab === 'support'"
          :support-diagnostics="supportDiagnostics"
          :support-generated-files="supportGeneratedFiles"
          :support-log-files="supportLogFiles"
          :support-logs-path="supportLogsPath"
          :support-bundle-busy="supportBundleBusy"
          @save-support-diagnostics="$emit('saveSupportDiagnostics')"
          @copy-support-diagnostics-summary="$emit('copySupportDiagnosticsSummary')"
        />

        <SettingsConfigTab
          v-else
          v-model:config-include-app-settings="configIncludeAppSettings"
          v-model:config-include-run-saving="configIncludeRunSaving"
          v-model:config-include-report-tracking="configIncludeReportTracking"
          v-model:config-include-loot-filters="configIncludeLootFilters"
          v-model:config-include-sounds="configIncludeSounds"
          v-model:config-include-item-research="configIncludeItemResearch"
          @import-configuration="$emit('importConfiguration')"
          @export-configuration="$emit('exportConfiguration')"
        />
      </section>

      <div class="settings-actions">
        <button class="icon-button ghost" type="button" @click="$emit('reset')">Reset Preferences</button>
        <button class="icon-button primary" type="button" @click="$emit('apply')">Done</button>
      </div>
    </section>
  </div>
</template>
