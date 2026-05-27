<script setup lang="ts">
import { ref, watch } from "vue";
import type { SupportDiagnosticGeneratedFileInfo, SupportDiagnosticLogFileInfo } from "../../../shared/support-diagnostics";
import type { CompactRunTileConfig } from "../lib/compact-tiles";
import type { CustomItemFilterSound, ItemFilterGroup } from "../lib/item-filters";
import type { ThemeAccentMap, ThemeId } from "../lib/themes";
import type { WhatsNewRelease } from "../lib/whats-new";
import SettingsAppearanceTab from "./SettingsAppearanceTab.vue";
import SettingsCaptureTab from "./SettingsCaptureTab.vue";
import SettingsConfigTab from "./SettingsConfigTab.vue";
import SettingsDashboardTab from "./SettingsDashboardTab.vue";
import SettingsGeneralTab from "./SettingsGeneralTab.vue";
import SettingsSoundsTab from "./SettingsSoundsTab.vue";
import SettingsSupportTab from "./SettingsSupportTab.vue";
import SettingsWhatsNewTab from "./SettingsWhatsNewTab.vue";

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
  importSounds: [];
  exportSounds: [];
  removeSound: [sound: CustomItemFilterSound];
  saveSupportDiagnostics: [];
  copySupportDiagnosticsSummary: [];
  exportConfiguration: [];
  importConfiguration: [];
  reset: [];
  apply: [];
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
const configIncludeAppSettings = defineModel<boolean>("configIncludeAppSettings", { required: true });
const configIncludeRunSaving = defineModel<boolean>("configIncludeRunSaving", { required: true });
const configIncludeReportTracking = defineModel<boolean>("configIncludeReportTracking", { required: true });
const configIncludeLootFilters = defineModel<boolean>("configIncludeLootFilters", { required: true });
const configIncludeSounds = defineModel<boolean>("configIncludeSounds", { required: true });
const configIncludeItemResearch = defineModel<boolean>("configIncludeItemResearch", { required: true });
const draftCompactRunTiles = defineModel<CompactRunTileConfig[]>("compactRunTiles", { required: true });

const activeSettingsTab = ref<SettingsTab>(props.initialTab ?? "general");

watch(() => props.initialTab, (tab) => {
  if (tab) activeSettingsTab.value = tab;
});

function updateThemeAccent(value: string, themeId?: ThemeId) {
  emit("updateThemeAccent", value, themeId);
}
</script>

<template>
  <div class="modal-backdrop">
    <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Preferences</p>
          <h2 id="settings-title">Settings</h2>
          <p class="settings-note">These preferences are saved on this device and restored between sessions.</p>
        </div>
        <button class="settings-close" type="button" title="Close settings" aria-label="Close settings" @click="$emit('close')">x</button>
      </div>

      <nav class="settings-tabs" aria-label="Settings sections">
        <button :class="{ active: activeSettingsTab === 'general' }" type="button" @click="activeSettingsTab = 'general'">General</button>
        <button :class="{ active: activeSettingsTab === 'capture' }" type="button" @click="activeSettingsTab = 'capture'">Capture</button>
        <button :class="{ active: activeSettingsTab === 'appearance' }" type="button" @click="activeSettingsTab = 'appearance'">Appearance</button>
        <button :class="{ active: activeSettingsTab === 'sounds' }" type="button" @click="activeSettingsTab = 'sounds'">Sounds</button>
        <button :class="{ active: activeSettingsTab === 'dashboard' }" type="button" @click="activeSettingsTab = 'dashboard'">Dashboard</button>
        <button :class="{ active: activeSettingsTab === 'whatsNew' }" type="button" @click="activeSettingsTab = 'whatsNew'">What's New</button>
        <button :class="{ active: activeSettingsTab === 'support' }" type="button" @click="activeSettingsTab = 'support'">Support</button>
        <button :class="{ active: activeSettingsTab === 'config' }" type="button" @click="activeSettingsTab = 'config'">Import / Export</button>
      </nav>

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
        :theme-options="themeOptions"
        @update-theme-accent="updateThemeAccent"
        @import-theme="$emit('importTheme')"
        @export-theme="$emit('exportTheme')"
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

      <div class="settings-actions">
        <button class="icon-button ghost" type="button" @click="$emit('reset')">Reset Preferences</button>
        <button class="icon-button primary" type="button" @click="$emit('apply')">Done</button>
      </div>
    </section>
  </div>
</template>
