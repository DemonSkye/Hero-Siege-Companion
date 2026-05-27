<script setup lang="ts">
defineEmits<{
  importConfiguration: [];
  exportConfiguration: [];
}>();

const configIncludeAppSettings = defineModel<boolean>("configIncludeAppSettings", { required: true });
const configIncludeRunSaving = defineModel<boolean>("configIncludeRunSaving", { required: true });
const configIncludeReportTracking = defineModel<boolean>("configIncludeReportTracking", { required: true });
const configIncludeLootFilters = defineModel<boolean>("configIncludeLootFilters", { required: true });
const configIncludeSounds = defineModel<boolean>("configIncludeSounds", { required: true });
const configIncludeItemResearch = defineModel<boolean>("configIncludeItemResearch", { required: true });
</script>

<template>
  <div class="settings-grid settings-grid-single">
    <div class="settings-config-row settings-wide">
      <span class="settings-label">Configuration JSON <span class="info-bubble" data-tip="These checkboxes control what gets exported and what gets applied when importing. Sounds are embedded into the JSON only when Sounds is checked.">i</span></span>
      <div class="settings-config-checks" aria-label="Configuration sections">
        <label class="settings-inline-check">
          <input v-model="configIncludeAppSettings" type="checkbox" />
          <span class="settings-label">App settings</span>
        </label>
        <label class="settings-inline-check">
          <input v-model="configIncludeRunSaving" type="checkbox" />
          <span class="settings-label">Past run settings</span>
        </label>
        <label class="settings-inline-check">
          <input v-model="configIncludeReportTracking" type="checkbox" />
          <span class="settings-label">Report tracking</span>
        </label>
        <label class="settings-inline-check">
          <input v-model="configIncludeLootFilters" type="checkbox" />
          <span class="settings-label">Loot filters</span>
        </label>
        <label class="settings-inline-check">
          <input v-model="configIncludeSounds" type="checkbox" />
          <span class="settings-label">Sounds</span>
        </label>
        <label class="settings-inline-check">
          <input v-model="configIncludeItemResearch" type="checkbox" />
          <span class="settings-label">Research data</span>
        </label>
      </div>
      <div class="settings-config-actions">
        <button class="icon-button ghost" type="button" @click="$emit('importConfiguration')">Import JSON</button>
        <button class="icon-button ghost" type="button" @click="$emit('exportConfiguration')">Export JSON</button>
      </div>
    </div>
  </div>
</template>
