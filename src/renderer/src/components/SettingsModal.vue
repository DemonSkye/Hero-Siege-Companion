<script setup lang="ts">
interface ItemTypeOption {
  value: string;
  label: string;
}

defineProps<{
  logLimitOptions: number[];
  itemTypeOptions: ItemTypeOption[];
}>();

defineEmits<{
  close: [];
  chooseGameExecutable: [];
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
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Preferences</p>
          <h2 id="settings-title">Settings</h2>
          <p class="settings-note">These preferences are saved on this device and restored between sessions.</p>
        </div>
        <button class="settings-close" type="button" title="Close settings" aria-label="Close settings" @click="$emit('close')">×</button>
      </div>

      <div class="settings-grid">
        <label class="settings-row">
          <span class="settings-label">Log history <span class="info-bubble" data-tip="Controls how many Live Log entries remain visible in the diagnostics panel.">i</span></span>
          <select v-model.number="draftLogLimit" title="Visible log history">
            <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="settings-row">
          <span class="settings-label">Item timeline history <span class="info-bubble" data-tip="Controls how many recent item drops remain visible in the item timeline.">i</span></span>
          <select v-model.number="draftTimelineLimit" title="Visible item timeline history">
            <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="settings-row">
          <span class="settings-label">Timeline type <span class="info-bubble" data-tip="Filters the recent item timeline to a single item type when you want to inspect one category.">i</span></span>
          <select v-model="draftTimelineType" title="Filter item timeline by item type">
            <option value="all">All</option>
            <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <div class="settings-launch-row settings-wide">
          <label class="settings-inline-check">
            <input v-model="draftLaunchThroughSteam" type="checkbox" />
            <span class="settings-label">Launch through Steam <span class="info-bubble" data-tip="Uses Steam's Hero Siege launch URL when you click Launch Game. Uncheck this to choose a standalone Hero Siege executable instead.">i</span></span>
          </label>
          <div v-if="!draftLaunchThroughSteam" class="path-setting">
            <input v-model="draftGameExecutablePath" type="text" spellcheck="false" title="Path to Hero Siege executable" />
            <button class="icon-button ghost" type="button" @click="$emit('chooseGameExecutable')">Browse</button>
          </div>
        </div>
        <label class="settings-check">
          <input v-model="draftShowCaptureDetails" type="checkbox" />
          <span class="settings-label">Show capture details <span class="info-bubble" data-tip="Shows adapter, filter, parser, and packet counters in the live status area.">i</span></span>
        </label>
        <label class="settings-check">
          <input v-model="draftCreateDebugMode" type="checkbox" />
          <span class="settings-label">Verbose live logging <span class="info-bubble" data-tip="Logs parsed drops to Live Log and writes a wide packet trace to capture-wide-debug.log for loot correlation diagnostics.">i</span></span>
        </label>
        <label class="settings-check">
          <input v-model="draftAlwaysOnTop" type="checkbox" />
          <span class="settings-label">Always on top <span class="info-bubble" data-tip="Keeps the companion above other windows while you play.">i</span></span>
        </label>
        <label class="settings-check">
          <input v-model="draftLockCompactLocation" type="checkbox" />
          <span class="settings-label">Lock saved window positions <span class="info-bubble" data-tip="Restores the compact and full windows to their last saved positions when switching modes.">i</span></span>
        </label>
        <label class="settings-check">
          <input v-model="draftHideSocketables" type="checkbox" />
          <span class="settings-label">Hide socketable items <span class="info-bubble" data-tip="Removes socketables from the recent item timeline so rarer item drops are easier to scan.">i</span></span>
        </label>
        <label class="settings-check">
          <input v-model="draftHideKeys" type="checkbox" />
          <span class="settings-label">Hide key items <span class="info-bubble" data-tip="Removes keys from the recent item timeline; key totals are still tracked elsewhere.">i</span></span>
        </label>
        <label class="settings-check">
          <input v-model="draftHideMaterials" type="checkbox" />
          <span class="settings-label">Hide materials <span class="info-bubble" data-tip="Removes materials and collectibles from the recent item timeline while keeping resource counters intact.">i</span></span>
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

      <div class="settings-actions">
        <button class="icon-button ghost" type="button" @click="$emit('reset')">Reset Preferences</button>
        <button class="icon-button primary" type="button" @click="$emit('apply')">Done</button>
      </div>
    </section>
  </div>
</template>
