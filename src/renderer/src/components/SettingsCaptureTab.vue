<script setup lang="ts">
const draftShowCaptureDetails = defineModel<boolean>("showCaptureDetails", { required: true });
const draftCaptureDebugLogging = defineModel<boolean>("captureDebugLogging", { required: true });
const draftCapturePayloadLogging = defineModel<boolean>("capturePayloadLogging", { required: true });
const draftCaptureWideLogging = defineModel<boolean>("captureWideLogging", { required: true });
const draftSatanicZoneDebugLogging = defineModel<boolean>("satanicZoneDebugLogging", { required: true });
const draftSatanicZoneRefreshEnabled = defineModel<boolean>("satanicZoneRefreshEnabled", { required: true });
const draftSkipEmptyRuns = defineModel<boolean>("skipEmptyRuns", { required: true });
const draftMinRunDurationMinutes = defineModel<number>("minRunDurationMinutes", { required: true });
const draftDeveloperItemResearchEnabled = defineModel<boolean>("developerItemResearchEnabled", { required: true });
const draftUnknownItemAudioPrompt = defineModel<boolean>("unknownItemAudioPrompt", { required: true });
</script>

<template>
  <div class="settings-grid">
    <label class="settings-check">
      <input v-model="draftShowCaptureDetails" type="checkbox" />
      <span class="settings-label">Show capture details <span class="info-bubble" data-tip="Shows adapter, filter, parser, and packet counters in the live status area.">i</span></span>
    </label>
    <label class="settings-check">
      <input v-model="draftCaptureDebugLogging" type="checkbox" />
      <span class="settings-label">Capture diagnostics file <span class="info-bubble" data-tip="Writes low-volume capture setup, adapter, parser, and heartbeat diagnostics to capture-debug.log.">i</span></span>
    </label>
    <label class="settings-check">
      <input v-model="draftSatanicZoneDebugLogging" :disabled="!draftCaptureDebugLogging" type="checkbox" />
      <span class="settings-label">Satanic Zone request diagnostics <span class="info-bubble" data-tip="Records each Satanic Zone refresh request and whether a zone update arrived before timeout. Requires the capture diagnostics file.">i</span></span>
    </label>
    <label class="settings-check settings-check-with-note">
      <input
        v-model="draftSatanicZoneRefreshEnabled"
        type="checkbox"
        aria-label="Enable manual Satanic Zone refresh"
        aria-describedby="satanic-zone-refresh-note"
      />
      <span class="settings-check-copy">
        <span class="settings-label">Enable manual Satanic Zone refresh <span class="info-bubble" data-tip="Starts the local proxy relay used by the dashboard button. Enabling or disabling this option while Hero Siege is connected will disconnect the game in progress, so enable it before joining a game. Some VPNs, system proxy setups, and network-security tools may conflict with it. Requests are limited to once every 30 seconds.">i</span></span>
        <small id="satanic-zone-refresh-note" class="settings-check-note satanic-zone-refresh-note">Uses a local proxy relay. Enabling or disabling this option while connected will disconnect the game in progress; enable it before joining a game. Some VPNs, system proxy setups, and network-security tools may conflict with it.</small>
      </span>
    </label>
    <label class="settings-check">
      <input v-model="draftCapturePayloadLogging" :disabled="!draftCaptureDebugLogging" type="checkbox" />
      <span class="settings-label">Payload snippet diagnostics <span class="info-bubble" data-tip="Writes selected sanitized payload snippets to capture-debug.log for parser support. Enable only while troubleshooting.">i</span></span>
    </label>
    <label class="settings-check">
      <input v-model="draftCaptureWideLogging" type="checkbox" />
      <span class="settings-label">Verbose packet file <span class="info-bubble" data-tip="Writes local packet and assembled-payload snippets to capture-wide-debug.log. It can grow quickly and may contain character, chat, or platform metadata; share only the generated Support bundle.">i</span></span>
    </label>
    <label class="settings-check">
      <input v-model="draftDeveloperItemResearchEnabled" type="checkbox" />
      <span class="settings-label">Developer item research <span class="info-bubble" data-tip="Adds an opt-in local research queue for unresolved item IDs so drops can help build better lookup data.">i</span></span>
    </label>
    <label class="settings-check">
      <input v-model="draftUnknownItemAudioPrompt" :disabled="!draftDeveloperItemResearchEnabled" type="checkbox" />
      <span class="settings-label">Prompt on unknown drops <span class="info-bubble" data-tip="Plays a quiet cue when a new unresolved item signature appears while developer item research is enabled.">i</span></span>
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
</template>
