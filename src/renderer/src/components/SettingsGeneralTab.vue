<script setup lang="ts">
import { computed } from "vue";
import { itemFilterTimelineOptions, type ItemFilterGroup } from "../lib/item-filters";

interface ItemTypeOption {
  value: string;
  label: string;
}

const props = defineProps<{
  logLimitOptions: number[];
  itemTypeOptions: ItemTypeOption[];
  itemFilterGroups: ItemFilterGroup[];
}>();

defineEmits<{
  chooseGameExecutable: [];
}>();

const draftLogLimit = defineModel<number>("logLimit", { required: true });
const draftTimelineLimit = defineModel<number>("timelineLimit", { required: true });
const draftTimelineType = defineModel<string>("timelineType", { required: true });
const draftLaunchThroughSteam = defineModel<boolean>("launchThroughSteam", { required: true });
const draftGameExecutablePath = defineModel<string>("gameExecutablePath", { required: true });
const draftAlwaysOnTop = defineModel<boolean>("alwaysOnTop", { required: true });
const draftLockCompactLocation = defineModel<boolean>("lockCompactLocation", { required: true });
const draftHideSocketables = defineModel<boolean>("hideSocketables", { required: true });
const draftHideKeys = defineModel<boolean>("hideKeys", { required: true });
const draftHideMaterials = defineModel<boolean>("hideMaterials", { required: true });

const timelineItemFilterOptions = computed(() => itemFilterTimelineOptions(props.itemFilterGroups));
</script>

<template>
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
      <span class="settings-label">Timeline filter <span class="info-bubble" data-tip="Filters the recent item timeline to a single item type or one of your item filter groups.">i</span></span>
      <select v-model="draftTimelineType" title="Filter item timeline by type or item filter">
        <option value="all">All</option>
        <optgroup label="Item types">
          <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </optgroup>
        <optgroup v-if="timelineItemFilterOptions.length" label="Item filters">
          <option v-for="option in timelineItemFilterOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </optgroup>
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
  </div>
</template>
