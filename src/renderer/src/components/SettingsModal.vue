<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type {
  CaptureDiagnosticsLevel,
  CaptureDiagnosticsMode,
  CaptureDiagnosticsState,
} from "../../../shared/app-state";
import type { SupportDiagnosticGeneratedFileInfo, SupportDiagnosticLogFileInfo } from "../../../shared/support-diagnostics";
import type { ConfigurationImportPreview } from "../lib/preferences";
import { createMarketAccessToggleGesture } from "../lib/market-search-runtime";
import type { ThemeId } from "../lib/themes";
import type { WhatsNewRelease } from "../lib/whats-new";
import { useModalFocus } from "../lib/modal-focus";
import SettingsActionDialog from "./SettingsActionDialog.vue";
import SettingsAppearanceTab from "./SettingsAppearanceTab.vue";
import SettingsCaptureTab from "./SettingsCaptureTab.vue";
import SettingsConfigTab from "./SettingsConfigTab.vue";
import SettingsGeneralTab from "./SettingsGeneralTab.vue";
import SettingsSupportTab from "./SettingsSupportTab.vue";
import { createInitialSatanicZoneDiagnosticState, type SatanicZoneDiagnosticState } from "../../../shared/satanic-zone-diagnostic";

interface ThemeOption {
  id: ThemeId;
  label: string;
}

type SettingsSection = "app" | "appearance" | "features" | "support" | "developers";
type SettingsDialogKind = "sz-learn-more" | "deep" | "restore" | "factory-reset";

const props = withDefaults(defineProps<{
  themeOptions: readonly ThemeOption[];
  legacyThemeAvailable?: boolean;
  legacyCompactThemeAvailable?: boolean;
  captureDiagnostics: CaptureDiagnosticsState;
  satanicZoneDiagnostic?: SatanicZoneDiagnosticState;
  satanicZoneLoginCache?: import("../../../shared/satanic-zone-login-cache").SatanicZoneLoginCacheState;
  szDiagnosticBusy?: boolean;
  szDiagnosticCancelBusy?: boolean;
  diagnosticsNow: number;
  diagnosticsBusyLevel?: CaptureDiagnosticsLevel | null;
  supportDiagnostics: string;
  supportGeneratedFiles: SupportDiagnosticGeneratedFileInfo[];
  supportLogFiles: SupportDiagnosticLogFileInfo[];
  supportLogsPath: string;
  supportBundleBusy: boolean;
  whatsNew: WhatsNewRelease;
  backupPreview?: ConfigurationImportPreview | null;
  backupBusy?: boolean;
  factoryResetBusy?: boolean;
  legacyResearchAvailable?: boolean;
  saveStatus?: "saved" | "saving" | "error";
  initialTab?: string;
}>(), {
  legacyThemeAvailable: false,
  legacyCompactThemeAvailable: false,
  diagnosticsBusyLevel: null,
  backupPreview: null,
  backupBusy: false,
  factoryResetBusy: false,
  legacyResearchAvailable: false,
  saveStatus: "saved",
  initialTab: "app",
});

const emit = defineEmits<{
  close: [];
  chooseGameExecutable: [];
  resetThemes: [];
  exportBackup: [];
  chooseBackup: [];
  confirmRestoreBackup: [];
  cancelRestoreBackup: [];
  openSupportLogsDirectory: [];
  saveSupportDiagnostics: [];
  copySupportDiagnosticsSummary: [];
  openNpcapGuide: [];
  setDiagnosticsMode: [level: CaptureDiagnosticsLevel, mode: CaptureDiagnosticsMode];
  armSatanicZoneDiagnostic: [];
  startSatanicZoneDiagnostic: [];
  cancelSatanicZoneDiagnostic: [];
  resetWindowPosition: [];
  factoryReset: [deleteItemFilters: boolean];
  importTheme: [];
  exportTheme: [];
  exportThemeTemplate: [];
  copyThemeTokenReference: [];
  exportLegacyResearch: [];
  retrySave: [];
  settingsTabChange: [tab: SettingsSection];
}>();

const launchThroughSteam = defineModel<boolean>("launchThroughSteam", { required: true });
const gameExecutablePath = defineModel<string>("gameExecutablePath", { required: true });
const themeId = defineModel<ThemeId>("themeId", { required: true });
const compactThemeId = defineModel<ThemeId>("compactThemeId", { required: true });
const themeCustomMode = defineModel<boolean>("themeCustomMode", { required: true });
const compactThemeCustomMode = defineModel<boolean>("compactThemeCustomMode", { required: true });
const compactThemeMatchesApp = defineModel<boolean>("compactThemeMatchesApp", { required: true });
const satanicZoneRefreshEnabled = defineModel<boolean>("satanicZoneRefreshEnabled", { required: true });
const marketSearchEnabled = defineModel<boolean>("marketSearchEnabled", { required: true });

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; group: "settings" | "resources" }> = [
  { id: "app", label: "App", group: "settings" },
  { id: "appearance", label: "Appearance", group: "settings" },
  { id: "features", label: "Features", group: "settings" },
  { id: "support", label: "Help & Support", group: "resources" },
  { id: "developers", label: "Developers", group: "resources" },
];
const activeSettingsSection = ref<SettingsSection>(normalizeSettingsSection(props.initialTab));
const settingsDialog = ref<HTMLElement | null>(null);
const nestedDialog = ref<SettingsDialogKind | null>(props.backupPreview ? "restore" : null);
const pendingDeepMode = ref<Exclude<CaptureDiagnosticsMode, "off">>("manual");
const deleteItemFilters = ref(false);
const marketAccessToggleGesture = createMarketAccessToggleGesture();
const { handleModalFocusKeydown } = useModalFocus(settingsDialog);

watch(() => props.initialTab, (tab) => {
  const normalized = normalizeSettingsSection(tab);
  if (activeSettingsSection.value !== normalized) activeSettingsSection.value = normalized;
});

watch(() => props.backupPreview, (preview) => {
  if (preview) nestedDialog.value = "restore";
  else if (nestedDialog.value === "restore") nestedDialog.value = null;
});

watch([activeSettingsSection, nestedDialog], ([section, dialog]) => {
  if (section !== "support" || dialog !== null) marketAccessToggleGesture.reset();
});

function normalizeSettingsSection(value: string | undefined): SettingsSection {
  if (value === "appearance" || value === "features" || value === "support" || value === "developers" || value === "app") return value;
  if (value === "capture") return "features";
  if (value === "config") return "developers";
  if (value === "whatsNew") return "support";
  return "app";
}

function selectSettingsSection(section: SettingsSection) {
  if (activeSettingsSection.value === section) return;
  activeSettingsSection.value = section;
  emit("settingsTabChange", section);
}

function handleNavigationKeydown(event: KeyboardEvent) {
  const currentIndex = SETTINGS_SECTIONS.findIndex((section) => section.id === activeSettingsSection.value);
  const lastIndex = SETTINGS_SECTIONS.length - 1;
  const nextIndex = event.key === "ArrowDown" || event.key === "ArrowRight"
    ? (currentIndex + 1) % SETTINGS_SECTIONS.length
    : event.key === "ArrowUp" || event.key === "ArrowLeft"
      ? (currentIndex + lastIndex) % SETTINGS_SECTIONS.length
      : event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : -1;
  if (nextIndex < 0) return;
  event.preventDefault();
  const nextSection = SETTINGS_SECTIONS[nextIndex];
  selectSettingsSection(nextSection.id);
  void nextTick(() => document.querySelector<HTMLButtonElement>(`[data-settings-section="${nextSection.id}"]`)?.focus());
}

function handleSettingsKeydownCapture(event: KeyboardEvent) {
  if (
    activeSettingsSection.value !== "support"
    || nestedDialog.value !== null
    || event.key !== "ArrowLeft"
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  if (marketAccessToggleGesture.recordArrowPress()) {
    marketSearchEnabled.value = !marketSearchEnabled.value;
  }
}

function requestSatanicZoneRefreshChange(enabled: boolean) {
  satanicZoneRefreshEnabled.value = enabled;
}

function requestDiagnosticsMode(level: CaptureDiagnosticsLevel, mode: CaptureDiagnosticsMode) {
  if (level === "deep" && mode !== "off") {
    pendingDeepMode.value = mode;
    nestedDialog.value = "deep";
    return;
  }
  emit("setDiagnosticsMode", level, mode);
}

function requestFactoryReset() {
  deleteItemFilters.value = false;
  nestedDialog.value = "factory-reset";
}

function closeNestedDialog() {
  if (nestedDialog.value === "restore") emit("cancelRestoreBackup");
  nestedDialog.value = null;
}


function confirmDeepDiagnostics() {
  emit("setDiagnosticsMode", "deep", pendingDeepMode.value);
  nestedDialog.value = null;
}

function confirmRestoreBackup() {
  emit("confirmRestoreBackup");
}

function confirmFactoryReset() {
  emit("factoryReset", deleteItemFilters.value);
  nestedDialog.value = null;
}

function saveStatusLabel(): string {
  if (props.saveStatus === "saving") return "Saving…";
  if (props.saveStatus === "error") return "Couldn’t save";
  return "Saved";
}
</script>

<template>
  <div
    class="modal-backdrop settings-ledger-backdrop"
    @keydown.capture="handleSettingsKeydownCapture"
    @keydown="handleModalFocusKeydown"
    @keydown.esc="$emit('close')"
  >
    <section
      ref="settingsDialog"
      class="settings-panel settings-ledger"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <header class="settings-ledger-header">
        <div>
          <p class="eyebrow">Preferences</p>
          <h2 id="settings-title">Settings</h2>
          <p>A small set of app-wide choices. Everything else lives where it is used.</p>
        </div>
        <div class="settings-ledger-header-actions">
          <button
            v-if="saveStatus === 'error'"
            class="settings-save-state error"
            type="button"
            aria-live="polite"
            @click="$emit('retrySave')"
          >{{ saveStatusLabel() }} · Retry</button>
          <span v-else :class="['settings-save-state', saveStatus]" role="status" aria-live="polite">{{ saveStatusLabel() }}</span>
          <button class="settings-close" type="button" aria-label="Close settings" @click="$emit('close')">×</button>
        </div>
      </header>

      <div class="settings-ledger-layout">
        <nav class="settings-ledger-nav" aria-label="Preferences and resources" @keydown="handleNavigationKeydown">
          <span class="settings-ledger-nav-label">Settings</span>
          <button
            v-for="section in SETTINGS_SECTIONS.filter((candidate) => candidate.group === 'settings')"
            :key="section.id"
            :data-settings-section="section.id"
            type="button"
            :aria-current="activeSettingsSection === section.id ? 'page' : undefined"
            @click="selectSettingsSection(section.id)"
          >{{ section.label }}</button>
          <span class="settings-ledger-nav-label resources">Resources</span>
          <button
            v-for="section in SETTINGS_SECTIONS.filter((candidate) => candidate.group === 'resources')"
            :key="section.id"
            :data-settings-section="section.id"
            type="button"
            :aria-current="activeSettingsSection === section.id ? 'page' : undefined"
            @click="selectSettingsSection(section.id)"
          >
            <span>{{ section.label }}</span>
            <span v-if="section.id === 'developers'" class="settings-nav-tag">Advanced</span>
          </button>
        </nav>

        <section
          :id="`settings-section-${activeSettingsSection}`"
          class="settings-ledger-content"
          :aria-label="`${SETTINGS_SECTIONS.find((section) => section.id === activeSettingsSection)?.label ?? 'Settings'} section`"
          tabindex="0"
        >
          <SettingsGeneralTab
            v-if="activeSettingsSection === 'app'"
            v-model:launch-through-steam="launchThroughSteam"
            v-model:game-executable-path="gameExecutablePath"
            @choose-game-executable="$emit('chooseGameExecutable')"
          />
          <SettingsAppearanceTab
            v-else-if="activeSettingsSection === 'appearance'"
            v-model:theme-id="themeId"
            v-model:compact-theme-id="compactThemeId"
            v-model:theme-custom-mode="themeCustomMode"
            v-model:compact-theme-custom-mode="compactThemeCustomMode"
            v-model:compact-theme-matches-app="compactThemeMatchesApp"
            :theme-options="themeOptions"
            :legacy-theme-available="legacyThemeAvailable"
            :legacy-compact-theme-available="legacyCompactThemeAvailable"
            @reset-themes="$emit('resetThemes')"
          />
          <SettingsCaptureTab
            v-else-if="activeSettingsSection === 'features'"
            :satanic-zone-refresh-enabled="satanicZoneRefreshEnabled"
            :satanic-zone-login-cache="satanicZoneLoginCache"
            @request-satanic-zone-refresh-change="requestSatanicZoneRefreshChange"
            @learn-more="nestedDialog = 'sz-learn-more'"
          />
          <SettingsSupportTab
            v-else-if="activeSettingsSection === 'support'"
            :capture-diagnostics="captureDiagnostics"
            :satanic-zone-diagnostic="satanicZoneDiagnostic ?? createInitialSatanicZoneDiagnosticState()"
            :sz-diagnostic-busy="szDiagnosticBusy"
            :sz-diagnostic-cancel-busy="szDiagnosticCancelBusy"
            :diagnostics-now="diagnosticsNow"
            :diagnostics-busy-level="diagnosticsBusyLevel"
            :support-diagnostics="supportDiagnostics"
            :support-generated-files="supportGeneratedFiles"
            :support-log-files="supportLogFiles"
            :support-logs-path="supportLogsPath"
            :support-bundle-busy="supportBundleBusy"
            :backup-busy="backupBusy"
            :factory-reset-busy="factoryResetBusy"
            :whats-new="whatsNew"
            :initially-expand-whats-new="initialTab === 'whatsNew'"
            @export-backup="$emit('exportBackup')"
            @choose-backup="$emit('chooseBackup')"
            @open-support-logs-directory="$emit('openSupportLogsDirectory')"
            @save-support-diagnostics="$emit('saveSupportDiagnostics')"
            @copy-support-diagnostics-summary="$emit('copySupportDiagnosticsSummary')"
            @open-npcap-guide="$emit('openNpcapGuide')"
            @set-diagnostics-mode="requestDiagnosticsMode"
            @arm-satanic-zone-diagnostic="$emit('armSatanicZoneDiagnostic')"
            @start-satanic-zone-diagnostic="$emit('startSatanicZoneDiagnostic')"
            @cancel-satanic-zone-diagnostic="$emit('cancelSatanicZoneDiagnostic')"
            @reset-window-position="$emit('resetWindowPosition')"
            @request-factory-reset="requestFactoryReset"
          />
          <SettingsConfigTab
            v-else
            :legacy-research-available="legacyResearchAvailable"
            @import-theme="$emit('importTheme')"
            @export-theme="$emit('exportTheme')"
            @export-theme-template="$emit('exportThemeTemplate')"
            @copy-theme-token-reference="$emit('copyThemeTokenReference')"
            @export-legacy-research="$emit('exportLegacyResearch')"
          />
        </section>
      </div>

      <SettingsActionDialog
        v-if="nestedDialog === 'sz-learn-more'"
        title="SZ Refresh details"
        dismiss-only
        @close="closeNestedDialog"
      >
        <p>Capture collects new sign-in data while you play. Click Refresh when you want to check the current Satanic Zone.</p>
        <ul>
          <li>Npcap is required to collect a new sign-in. No certificate installation, administrator service, proxy, or special game launch is required.</li>
          <li>Refresh requests remain limited to once every 30 seconds.</li>
          <li>Open Companion before signing into the game, or launch the game here. Refresh gets ready automatically while capture is enabled.</li>
          <li>If Companion missed this sign-in, keep playing. Without a saved sign-in, Refresh will be available after the game next signs in; changing characters may not do that.</li>
          <li>Requests are sent only when you click Refresh. Ready sign-in data has no time limit.</li>
          <li>Capture interruptions pause Refresh using live sign-in data until fresh matching sign-in data is observed. With Remember sign-in off, new sign-in data stays in memory and is cleared on a game session change, disable or closing Companion.</li>
          <li>With a loaded saved sign-in and known server, you can try Refresh after restarting Companion or stopping capture. The server may reject the saved sign-in.</li>
          <li>Older saved sign-ins without a known server wait for the game's server connection to be observed; a new sign-in is not required.</li>
          <li>Remember sign-in is optional and off by default. Automatic save/load requires consent during setup; existing manual settings stay manual until you choose it. Use the existing passphrase to enable automatic loading without changing the encrypted file.</li>
          <li>A lost passphrase cannot be recovered. Turning Remember sign-in or SZ Refresh off removes the local unlocking key and keeps the encrypted file. Forget saved sign-in deletes both files and turns Remember sign-in off. Older Windows-encrypted files stay untouched.</li>
          <li>If saving or loading fails, check access to the saved file and try again. Forget saved sign-in lets you start again if a file is damaged or its passphrase is lost. Existing saved Off settings are preserved.</li>
          <li>Restoring a backup never enables SZ Refresh.</li>
        </ul>
        <p v-if="satanicZoneLoginCache?.accountLabel">{{ satanicZoneLoginCache.accountLabel }}.</p>
      </SettingsActionDialog>

      <SettingsActionDialog
        v-else-if="nestedDialog === 'deep'"
        :title="pendingDeepMode === 'manual' ? 'Turn on deep diagnostics?' : 'Start deep diagnostics for 10 minutes?'"
        :confirm-label="pendingDeepMode === 'manual' ? 'Turn On Deep Diagnostics' : 'Start 10 Minutes'"
        confirm-tone="warning"
        @close="closeNestedDialog"
        @confirm="confirmDeepDiagnostics"
      >
        <p>Deep diagnostics can grow quickly and may contain character, chat, or platform metadata. Use it only while troubleshooting and share only through a generated Support bundle.</p>
      </SettingsActionDialog>

      <SettingsActionDialog
        v-else-if="nestedDialog === 'restore' && backupPreview"
        title="Restore this backup?"
        confirm-label="Restore Backup"
        :busy="backupBusy"
        @close="closeNestedDialog"
        @confirm="confirmRestoreBackup"
      >
        <p>The selected {{ backupPreview.legacyFormat ? "legacy configuration" : "backup" }} contains:</p>
        <ul>
          <li>{{ backupPreview.settings }} supported setting{{ backupPreview.settings === 1 ? "" : "s" }}</li>
          <li>{{ backupPreview.filterGroups }} item filter{{ backupPreview.filterGroups === 1 ? "" : "s" }}</li>
          <li>{{ backupPreview.sounds }} custom sound{{ backupPreview.sounds === 1 ? "" : "s" }}</li>
          <li>{{ backupPreview.customThemes }} custom theme{{ backupPreview.customThemes === 1 ? "" : "s" }}</li>
          <li>{{ backupPreview.compactTiles }} compact tile{{ backupPreview.compactTiles === 1 ? "" : "s" }}</li>
        </ul>
        <p>Retired options are ignored. SZ Refresh keeps its current state.</p>
      </SettingsActionDialog>

      <SettingsActionDialog
        v-else-if="nestedDialog === 'factory-reset'"
        title="Factory reset the companion?"
        confirm-label="Factory Reset"
        confirm-tone="danger"
        :busy="factoryResetBusy"
        @close="closeNestedDialog"
        @confirm="confirmFactoryReset"
      >
        <p>This resets local preferences, custom themes, and layouts. Past Runs, diagnostic logs, item filters, and imported sound files are preserved by default.</p>
        <label class="settings-dialog-option">
          <input v-model="deleteItemFilters" type="checkbox" />
          <span><strong>Also delete item filters</strong><small>Leave this unchecked to keep carefully configured filter groups.</small></span>
        </label>
      </SettingsActionDialog>
    </section>
  </div>
</template>
