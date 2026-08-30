<script setup lang="ts">
import { computed } from "vue";
import { eventValue } from "../lib/dom-events";
import type { ThemeId } from "../lib/themes";

interface ThemeOption {
  id: ThemeId;
  label: string;
}

const props = withDefaults(defineProps<{
  themeOptions: readonly ThemeOption[];
  legacyThemeAvailable?: boolean;
  legacyCompactThemeAvailable?: boolean;
  legacyThemeLabel?: string;
  legacyCompactThemeLabel?: string;
}>(), {
  legacyThemeAvailable: false,
  legacyCompactThemeAvailable: false,
  legacyThemeLabel: "Legacy Custom (Migrated)",
  legacyCompactThemeLabel: "Legacy Custom (Migrated)",
});

defineEmits<{
  resetThemes: [];
}>();

const themeId = defineModel<ThemeId>("themeId", { required: true });
const compactThemeId = defineModel<ThemeId>("compactThemeId", { required: true });
const themeCustomMode = defineModel<boolean>("themeCustomMode", { required: true });
const compactThemeCustomMode = defineModel<boolean>("compactThemeCustomMode", { required: true });
const compactThemeMatchesApp = defineModel<boolean>("compactThemeMatchesApp", { required: true });

const appThemeSelection = computed(() => (themeCustomMode.value ? "legacy" : themeId.value));
const compactThemeSelection = computed(() => (
  compactThemeMatchesApp.value
    ? "match"
    : compactThemeCustomMode.value
      ? "legacy"
      : compactThemeId.value
));
const showLegacyAppTheme = computed(() => props.legacyThemeAvailable || themeCustomMode.value);
const showLegacyCompactTheme = computed(() => props.legacyCompactThemeAvailable || compactThemeCustomMode.value);

function updateAppTheme(value: string) {
  if (value === "legacy") {
    themeCustomMode.value = true;
    return;
  }
  const option = props.themeOptions.find((theme) => theme.id === value);
  if (!option) return;
  themeId.value = option.id;
  themeCustomMode.value = false;
}

function updateCompactTheme(value: string) {
  if (value === "match") {
    compactThemeMatchesApp.value = true;
    compactThemeCustomMode.value = false;
    return;
  }
  compactThemeMatchesApp.value = false;
  if (value === "legacy") {
    compactThemeCustomMode.value = true;
    return;
  }
  const option = props.themeOptions.find((theme) => theme.id === value);
  if (!option) return;
  compactThemeId.value = option.id;
  compactThemeCustomMode.value = false;
}
</script>

<template>
  <div class="settings-ledger-panel-heading">
    <h2>Appearance</h2>
    <p>Choose authored themes. Colors, texture, and panel contrast are owned by each theme.</p>
  </div>

  <section class="settings-ledger-section" aria-labelledby="settings-theme-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-theme-title">Themes</h3>
      <p>Compact mode can follow the app or use another curated theme.</p>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <label class="settings-ledger-title" for="settings-app-theme">App theme</label>
        <p>Controls the full-size dashboard and application chrome.</p>
      </div>
      <div class="settings-ledger-control settings-theme-control">
        <span class="settings-theme-preview" aria-hidden="true"><span></span><span></span><span></span></span>
        <select id="settings-app-theme" :value="appThemeSelection" @change="updateAppTheme(eventValue($event))">
          <option v-for="theme in themeOptions" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
          <option v-if="showLegacyAppTheme" value="legacy">{{ legacyThemeLabel }}</option>
        </select>
      </div>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <label class="settings-ledger-title" for="settings-compact-theme">Compact theme</label>
        <p>Follow the full app by default or choose a distinct compact presentation.</p>
      </div>
      <div class="settings-ledger-control">
        <select id="settings-compact-theme" :value="compactThemeSelection" @change="updateCompactTheme(eventValue($event))">
          <option value="match">Match Full App</option>
          <option v-for="theme in themeOptions" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
          <option v-if="showLegacyCompactTheme" value="legacy">{{ legacyCompactThemeLabel }}</option>
        </select>
      </div>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Theme defaults</span>
        <p>Return both surfaces to the recommended authored themes.</p>
      </div>
      <div class="settings-ledger-control">
        <button class="icon-button ghost" type="button" @click="$emit('resetThemes')">Reset Themes</button>
      </div>
    </div>
  </section>
</template>
