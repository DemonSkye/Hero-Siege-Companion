<script setup lang="ts">
import type { ThemeAccentMap, ThemeId } from "../lib/themes";
import { eventValue } from "../lib/dom-events";

interface ThemeOption {
  id: ThemeId;
  label: string;
  defaultAccent: string;
}

defineProps<{
  themeOptions: ThemeOption[];
}>();

defineEmits<{
  updateThemeAccent: [value: string, themeId?: ThemeId];
  importTheme: [];
  exportTheme: [];
}>();

const draftThemeId = defineModel<ThemeId>("themeId", { required: true });
const draftCompactThemeId = defineModel<ThemeId>("compactThemeId", { required: true });
const draftThemeAccents = defineModel<ThemeAccentMap>("themeAccents", { required: true });
</script>

<template>
  <div class="settings-grid settings-grid-single">
    <section class="settings-wide compact-settings-section">
      <div class="compact-settings-heading">
        <strong>Theme</strong>
        <span>Rarity colors stay game-matched.</span>
      </div>
      <div class="settings-theme-grid">
        <label class="settings-row">
          <span class="settings-label">Full app theme <span class="info-bubble" data-tip="Changes app surfaces, borders, and background chrome. Drop rarity colors are intentionally unchanged.">i</span></span>
          <select v-model="draftThemeId" title="Application theme">
            <option v-for="theme in themeOptions" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
          </select>
        </label>
        <label class="settings-row settings-color-row">
          <span class="settings-label">Full app accent <span class="info-bubble" data-tip="Tunes the selected full app theme's accent color for controls and highlights.">i</span></span>
          <span class="settings-color-control">
            <input :value="draftThemeAccents[draftThemeId]" type="color" title="Theme accent color" @input="$emit('updateThemeAccent', eventValue($event), draftThemeId)" />
            <code>{{ draftThemeAccents[draftThemeId] }}</code>
          </span>
        </label>
        <label class="settings-row">
          <span class="settings-label">Compact theme <span class="info-bubble" data-tip="Used only while compact mode is active, so the overlay can differ from the full dashboard.">i</span></span>
          <select v-model="draftCompactThemeId" title="Compact mode theme">
            <option v-for="theme in themeOptions" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
          </select>
        </label>
        <label class="settings-row settings-color-row">
          <span class="settings-label">Compact accent <span class="info-bubble" data-tip="Tunes the selected compact theme's accent color. Shared theme accents still export with app settings.">i</span></span>
          <span class="settings-color-control">
            <input :value="draftThemeAccents[draftCompactThemeId]" type="color" title="Compact theme accent color" @input="$emit('updateThemeAccent', eventValue($event), draftCompactThemeId)" />
            <code>{{ draftThemeAccents[draftCompactThemeId] }}</code>
          </span>
        </label>
      </div>
      <div class="settings-theme-actions">
        <button class="icon-button ghost" type="button" @click="$emit('importTheme')">Import Theme</button>
        <button class="icon-button ghost" type="button" @click="$emit('exportTheme')">Export Theme</button>
      </div>
      <details class="settings-theme-help">
        <summary>Theme help</summary>
        <p>Themes change app chrome: backgrounds, panels, borders, controls, and accent highlights. Rarity colors are not themeable because they should match Hero Siege.</p>
        <p>Theme JSON supports a base theme, accent color, and optional tokens for app surfaces. Useful tokens: appText, appHeading, appBg, appBgGradient, surface, surfaceStrong, surfaceCell, surfaceSelected, border, borderStrong, accentBorder, accentWarm, inputBg, buttonPrimary, buttonPrimaryText, danger, scrollbar, shadow.</p>
        <code>{"kind":"theme","themeId":"cyberpunk","accent":"#00f0ff","tokens":{"surface":"rgba(8, 4, 6, 0.94)","border":"rgba(0, 240, 255, 0.48)","buttonPrimary":"#fff200"}}</code>
      </details>
    </section>
  </div>
</template>
