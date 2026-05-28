<script setup lang="ts">
const draftShowCaptureDetails = defineModel<boolean>("showCaptureDetails", { required: true });
const draftCreateDebugMode = defineModel<boolean>("createDebugMode", { required: true });
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
      <input v-model="draftCreateDebugMode" type="checkbox" />
      <span class="settings-label">Verbose live logging <span class="info-bubble" data-tip="Writes wider redacted packet metadata to capture-wide-debug.log for loot correlation diagnostics. Parsed item events still appear in Live Log.">i</span></span>
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
