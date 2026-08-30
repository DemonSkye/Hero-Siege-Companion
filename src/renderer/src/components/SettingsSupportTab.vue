<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  CaptureDiagnosticsLevel,
  CaptureDiagnosticsMode,
  CaptureDiagnosticsModeState,
  CaptureDiagnosticsState,
} from "../../../shared/app-state";
import type { SupportDiagnosticGeneratedFileInfo, SupportDiagnosticLogFileInfo } from "../../../shared/support-diagnostics";
import type { WhatsNewRelease } from "../lib/whats-new";

const props = withDefaults(defineProps<{
  captureDiagnostics: CaptureDiagnosticsState;
  diagnosticsNow: number;
  diagnosticsBusyLevel?: CaptureDiagnosticsLevel | null;
  supportDiagnostics: string;
  supportGeneratedFiles: SupportDiagnosticGeneratedFileInfo[];
  supportLogFiles: SupportDiagnosticLogFileInfo[];
  supportLogsPath: string;
  supportBundleBusy: boolean;
  backupBusy?: boolean;
  factoryResetBusy?: boolean;
  whatsNew: WhatsNewRelease;
  initiallyExpandWhatsNew?: boolean;
}>(), {
  diagnosticsBusyLevel: null,
  backupBusy: false,
  factoryResetBusy: false,
  initiallyExpandWhatsNew: false,
});

defineEmits<{
  exportBackup: [];
  chooseBackup: [];
  openSupportLogsDirectory: [];
  saveSupportDiagnostics: [];
  copySupportDiagnosticsSummary: [];
  openNpcapGuide: [];
  setDiagnosticsMode: [level: CaptureDiagnosticsLevel, mode: CaptureDiagnosticsMode];
  resetWindowPosition: [];
  requestFactoryReset: [];
}>();

const availableSupportLogFiles = computed(() => props.supportLogFiles.filter((file) => file.exists));
const whatsNewOpen = ref(props.initiallyExpandWhatsNew);

watch(() => props.initiallyExpandWhatsNew, (shouldExpand) => {
  if (shouldExpand) whatsNewOpen.value = true;
});

function handleWhatsNewToggle(event: Event): void {
  whatsNewOpen.value = (event.currentTarget as HTMLDetailsElement).open;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

function diagnosticStatus(state: CaptureDiagnosticsModeState): string {
  if (state.mode === "manual") return "On · app session";
  if (state.mode !== "timed" || !state.timedUntil) return "Off";
  const remainingSeconds = Math.max(0, Math.ceil((state.timedUntil - props.diagnosticsNow) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} remaining`;
}

function nextMode(state: CaptureDiagnosticsModeState, requested: Exclude<CaptureDiagnosticsMode, "off">): CaptureDiagnosticsMode {
  return state.mode === requested ? "off" : requested;
}
</script>

<template>
  <div class="settings-ledger-panel-heading">
    <h2>Help &amp; Support</h2>
    <p>Back up your setup, collect support information, and recover the window.</p>
  </div>

  <section class="settings-ledger-section" aria-labelledby="settings-backup-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-backup-title">Backup &amp; Restore</h3>
      <p>One complete backup replaces configuration-scope checkboxes.</p>
    </div>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Companion backup</span>
        <p>Includes supported settings, item filters, sounds, custom themes, and layouts.</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <button class="icon-button ghost" type="button" :disabled="backupBusy" @click="$emit('exportBackup')">Export Backup</button>
        <button class="icon-button ghost" type="button" :disabled="backupBusy" @click="$emit('chooseBackup')">Restore Backup…</button>
      </div>
    </div>
    <p class="settings-ledger-footnote">Older configuration JSON is accepted. Retired options are ignored, and restoring never enables SZ Refresh.</p>
  </section>

  <section class="settings-ledger-section" aria-labelledby="settings-diagnostics-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-diagnostics-title">Diagnostics</h3>
      <p>Routine support logging is automatic, local, and bounded.</p>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Support diagnostics</span>
        <p>Capture setup, adapter, parser, heartbeat, and active SZ request outcomes.</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <span class="settings-status-badge active">Automatic</span>
        <button class="icon-button ghost" type="button" @click="$emit('openSupportLogsDirectory')">Open Log Folder</button>
        <button class="icon-button ghost" type="button" :disabled="supportBundleBusy" @click="$emit('saveSupportDiagnostics')">
          {{ supportBundleBusy ? "Creating…" : "Create Support Bundle" }}
        </button>
      </div>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Enhanced diagnostics</span>
        <p>Include sanitized payload detail until it is turned off or for one bounded ten-minute session.</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <span :class="['settings-status-badge', { active: captureDiagnostics.enhanced.mode !== 'off' }]">{{ diagnosticStatus(captureDiagnostics.enhanced) }}</span>
        <button
          class="icon-button ghost"
          type="button"
          :aria-pressed="captureDiagnostics.enhanced.mode === 'manual'"
          :disabled="diagnosticsBusyLevel === 'enhanced'"
          @click="$emit('setDiagnosticsMode', 'enhanced', nextMode(captureDiagnostics.enhanced, 'manual'))"
        >{{ captureDiagnostics.enhanced.mode === "manual" ? "Turn Off" : "Turn On" }}</button>
        <button
          class="icon-button ghost"
          type="button"
          :aria-pressed="captureDiagnostics.enhanced.mode === 'timed'"
          :disabled="diagnosticsBusyLevel === 'enhanced'"
          @click="$emit('setDiagnosticsMode', 'enhanced', nextMode(captureDiagnostics.enhanced, 'timed'))"
        >{{ captureDiagnostics.enhanced.mode === "timed" ? "Stop" : "Start 10 min" }}</button>
      </div>
    </div>

    <details class="settings-disclosure">
      <summary>
        <span><strong>Deep diagnostics</strong><small>Large packet-level troubleshooting files for support-directed use only.</small></span>
        <span :class="['settings-status-badge', 'warning', { active: captureDiagnostics.deep.mode !== 'off' }]">{{ diagnosticStatus(captureDiagnostics.deep) }}</span>
      </summary>
      <div class="settings-disclosure-body">
        <p>This collection can grow quickly and may contain character, chat, or platform metadata. Every activation asks for confirmation.</p>
        <div class="settings-action-group">
          <button
            class="icon-button warning"
            type="button"
            :aria-pressed="captureDiagnostics.deep.mode === 'manual'"
            :disabled="diagnosticsBusyLevel === 'deep'"
            @click="$emit('setDiagnosticsMode', 'deep', nextMode(captureDiagnostics.deep, 'manual'))"
          >{{ captureDiagnostics.deep.mode === "manual" ? "Turn Off" : "Turn On…" }}</button>
          <button
            class="icon-button warning"
            type="button"
            :aria-pressed="captureDiagnostics.deep.mode === 'timed'"
            :disabled="diagnosticsBusyLevel === 'deep'"
            @click="$emit('setDiagnosticsMode', 'deep', nextMode(captureDiagnostics.deep, 'timed'))"
          >{{ captureDiagnostics.deep.mode === "timed" ? "Stop" : "Start 10 min…" }}</button>
        </div>
      </div>
    </details>

    <details class="settings-disclosure settings-diagnostics-files">
      <summary>
        <span><strong>Support bundle contents</strong><small>{{ availableSupportLogFiles.length }} local log file{{ availableSupportLogFiles.length === 1 ? "" : "s" }} currently available.</small></span>
        <span class="settings-nav-tag">Local</span>
      </summary>
      <div class="settings-disclosure-body">
        <p>Support bundles include diagnostic summaries and bounded local logs. They do not include packet captures.</p>
        <p class="settings-support-path">Log folder: <code>{{ supportLogsPath }}</code></p>
        <div class="settings-support-files" aria-label="Diagnostics files">
          <div v-for="file in supportGeneratedFiles" :key="file.name" class="settings-support-file">
            <div><strong>{{ file.name }}</strong><span>{{ file.description }}</span></div>
            <small class="settings-support-file-status">Generated</small>
          </div>
          <div v-for="file in availableSupportLogFiles" :key="file.name" class="settings-support-file">
            <div><strong>{{ file.name }}</strong><span>{{ file.description }}</span><code>{{ file.path }}</code></div>
            <small class="settings-support-file-status">{{ formatBytes(file.sizeBytes) }}<span v-if="file.updatedAt">{{ formatUpdatedAt(file.updatedAt) }}</span></small>
          </div>
        </div>
        <div class="settings-action-group">
          <button class="icon-button ghost" type="button" @click="$emit('copySupportDiagnosticsSummary')">Copy Summary</button>
          <button class="icon-button ghost" type="button" @click="$emit('openNpcapGuide')">Npcap Guide</button>
        </div>
        <pre class="settings-support-bundle">{{ supportDiagnostics }}</pre>
      </div>
    </details>
  </section>

  <section class="settings-ledger-section" aria-labelledby="settings-recovery-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-recovery-title">Recovery</h3>
      <p>Focused recovery actions leave durable app data alone unless explicitly selected.</p>
    </div>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Window position</span>
        <p>Move full and compact windows back to safe default positions.</p>
      </div>
      <div class="settings-ledger-control">
        <button class="icon-button ghost" type="button" @click="$emit('resetWindowPosition')">Reset Window Position</button>
      </div>
    </div>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Factory reset</span>
        <p>Restore recommended preferences and layouts while preserving Past Runs, logs, item filters, and imported sounds.</p>
      </div>
      <div class="settings-ledger-control">
        <button class="icon-button danger" type="button" :disabled="factoryResetBusy" @click="$emit('requestFactoryReset')">Factory Reset…</button>
      </div>
    </div>
  </section>

  <section class="settings-ledger-section" aria-labelledby="settings-about-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-about-title">About</h3>
    </div>
    <details class="settings-disclosure settings-whats-new" :open="whatsNewOpen" @toggle="handleWhatsNewToggle">
      <summary>
        <span><strong>Hero Siege Companion {{ whatsNew.version }}</strong><small>{{ whatsNew.title }}</small></span>
        <span class="settings-nav-tag">What’s New</span>
      </summary>
      <div class="settings-disclosure-body">
        <p v-if="whatsNew.intro">{{ whatsNew.intro }}</p>
        <section v-if="whatsNew.items.length">
          <h4>Highlights</h4>
          <ul><li v-for="item in whatsNew.items" :key="item">{{ item }}</li></ul>
        </section>
        <section v-for="section in whatsNew.sections" :key="section.title">
          <h4>{{ section.title }}</h4>
          <ul><li v-for="item in section.items" :key="item">{{ item }}</li></ul>
        </section>
      </div>
    </details>
  </section>
</template>
