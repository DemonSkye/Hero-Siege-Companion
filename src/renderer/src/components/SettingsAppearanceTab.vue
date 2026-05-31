<script setup lang="ts">
import {
  DEFAULT_THEME_FOREGROUND_FILLS,
  DEFAULT_THEME_TEXTURES,
  THEME_BACKGROUND_TEXTURE_OPTIONS,
  THEME_FOREGROUND_FILL_MAX,
  THEME_FOREGROUND_FILL_MIN,
  THEME_TEXTURE_DEFAULT_ID,
  THEME_TOKEN_OPTIONS,
  normalizeThemeForegroundFill,
  normalizeThemeTexture,
  themeTextureLabel,
  type ThemeAccentMap,
  type ThemeForegroundFillMap,
  type ThemeId,
  type ThemeTextureMap,
  type ThemeTextureSelectionId,
} from "../lib/themes";
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
  exportThemeTemplate: [];
}>();

const draftThemeId = defineModel<ThemeId>("themeId", { required: true });
const draftCompactThemeId = defineModel<ThemeId>("compactThemeId", { required: true });
const draftThemeAccents = defineModel<ThemeAccentMap>("themeAccents", { required: true });
const draftThemeTextures = defineModel<ThemeTextureMap>("themeTextures", { required: true });
const draftCompactThemeTextures = defineModel<ThemeTextureMap>("compactThemeTextures", { required: true });
const draftThemeForegroundFills = defineModel<ThemeForegroundFillMap>("themeForegroundFills", { required: true });
const draftCompactThemeForegroundFills = defineModel<ThemeForegroundFillMap>("compactThemeForegroundFills", { required: true });

function selectedTexture(textures: ThemeTextureMap, themeId: ThemeId): ThemeTextureSelectionId {
  return textures[themeId] ?? THEME_TEXTURE_DEFAULT_ID;
}

function updateTextureMap(textures: ThemeTextureMap, themeId: ThemeId, value: string): ThemeTextureMap {
  const next = { ...textures };
  if (value === THEME_TEXTURE_DEFAULT_ID) {
    delete next[themeId];
    return next;
  }
  const texture = normalizeThemeTexture(value);
  if (!texture) return textures;
  next[themeId] = texture;
  return next;
}

function defaultTextureLabel(themeId: ThemeId): string {
  return themeTextureLabel(DEFAULT_THEME_TEXTURES[themeId]);
}

function selectedForegroundFill(fills: ThemeForegroundFillMap, themeId: ThemeId): number {
  return fills[themeId] ?? DEFAULT_THEME_FOREGROUND_FILLS[themeId];
}

function updateForegroundFillMap(fills: ThemeForegroundFillMap, themeId: ThemeId, value: string): ThemeForegroundFillMap {
  const fill = normalizeThemeForegroundFill(value);
  return fill === null ? fills : { ...fills, [themeId]: fill };
}

function defaultForegroundFillLabel(themeId: ThemeId): string {
  return `${DEFAULT_THEME_FOREGROUND_FILLS[themeId]}%`;
}
</script>

<template>
  <div class="settings-grid settings-grid-single">
    <section class="settings-wide compact-settings-section">
      <div class="compact-settings-heading">
        <strong>Theme</strong>
        <span>Rarity colors stay game-matched.</span>
      </div>
      <div class="settings-theme-sections">
        <div class="settings-theme-group">
          <div class="settings-theme-group-heading">
            <strong>Full App</strong>
          </div>
          <div class="settings-theme-group-grid">
            <label class="settings-row">
              <span class="settings-label">Theme <span class="info-bubble" data-tip="Changes app surfaces, borders, and background chrome. Drop rarity colors are intentionally unchanged.">i</span></span>
              <select v-model="draftThemeId" title="Application theme">
                <option v-for="theme in themeOptions" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
              </select>
            </label>
            <label class="settings-row settings-color-row">
              <span class="settings-label">Accent <span class="info-bubble" data-tip="Tunes the selected full app theme's accent color for controls and highlights.">i</span></span>
              <span class="settings-color-control">
                <input :value="draftThemeAccents[draftThemeId]" type="color" title="Theme accent color" @input="$emit('updateThemeAccent', eventValue($event), draftThemeId)" />
                <code>{{ draftThemeAccents[draftThemeId] }}</code>
              </span>
            </label>
            <label class="settings-row">
              <span class="settings-label">Texture <span class="info-bubble" data-tip="Overrides the selected full app theme's background texture. Theme default follows the built-in theme material.">i</span></span>
              <select
                :value="selectedTexture(draftThemeTextures, draftThemeId)"
                title="Full app background texture"
                @change="draftThemeTextures = updateTextureMap(draftThemeTextures, draftThemeId, eventValue($event))"
              >
                <option :value="THEME_TEXTURE_DEFAULT_ID">Theme default ({{ defaultTextureLabel(draftThemeId) }})</option>
                <option v-for="texture in THEME_BACKGROUND_TEXTURE_OPTIONS" :key="texture.id" :value="texture.id">{{ texture.label }}</option>
              </select>
            </label>
            <label class="settings-row settings-range-row">
              <span class="settings-label">Foreground fill <span class="info-bubble" :data-tip="`Controls the opacity of main foreground panels. Theme default is ${defaultForegroundFillLabel(draftThemeId)}.`">i</span></span>
              <span class="settings-range-control">
                <input
                  :value="selectedForegroundFill(draftThemeForegroundFills, draftThemeId)"
                  type="range"
                  :min="THEME_FOREGROUND_FILL_MIN"
                  :max="THEME_FOREGROUND_FILL_MAX"
                  step="1"
                  title="Full app foreground fill"
                  @input="draftThemeForegroundFills = updateForegroundFillMap(draftThemeForegroundFills, draftThemeId, eventValue($event))"
                />
                <code>{{ selectedForegroundFill(draftThemeForegroundFills, draftThemeId) }}%</code>
              </span>
            </label>
          </div>
        </div>
        <div class="settings-theme-group">
          <div class="settings-theme-group-heading">
            <strong>Compact Mode</strong>
          </div>
          <div class="settings-theme-group-grid">
            <label class="settings-row">
              <span class="settings-label">Theme <span class="info-bubble" data-tip="Used only while compact mode is active, so the overlay can differ from the full dashboard.">i</span></span>
              <select v-model="draftCompactThemeId" title="Compact mode theme">
                <option v-for="theme in themeOptions" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
              </select>
            </label>
            <label class="settings-row settings-color-row">
              <span class="settings-label">Accent <span class="info-bubble" data-tip="Tunes the selected compact theme's accent color. Shared theme accents still export with app settings.">i</span></span>
              <span class="settings-color-control">
                <input :value="draftThemeAccents[draftCompactThemeId]" type="color" title="Compact theme accent color" @input="$emit('updateThemeAccent', eventValue($event), draftCompactThemeId)" />
                <code>{{ draftThemeAccents[draftCompactThemeId] }}</code>
              </span>
            </label>
            <label class="settings-row">
              <span class="settings-label">Texture <span class="info-bubble" data-tip="Overrides the selected compact theme's tray texture while compact mode is active.">i</span></span>
              <select
                :value="selectedTexture(draftCompactThemeTextures, draftCompactThemeId)"
                title="Compact background texture"
                @change="draftCompactThemeTextures = updateTextureMap(draftCompactThemeTextures, draftCompactThemeId, eventValue($event))"
              >
                <option :value="THEME_TEXTURE_DEFAULT_ID">Theme default ({{ defaultTextureLabel(draftCompactThemeId) }})</option>
                <option v-for="texture in THEME_BACKGROUND_TEXTURE_OPTIONS" :key="texture.id" :value="texture.id">{{ texture.label }}</option>
              </select>
            </label>
            <label class="settings-row settings-range-row">
              <span class="settings-label">Foreground fill <span class="info-bubble" :data-tip="`Controls the opacity of compact overlay panels. Theme default is ${defaultForegroundFillLabel(draftCompactThemeId)}.`">i</span></span>
              <span class="settings-range-control">
                <input
                  :value="selectedForegroundFill(draftCompactThemeForegroundFills, draftCompactThemeId)"
                  type="range"
                  :min="THEME_FOREGROUND_FILL_MIN"
                  :max="THEME_FOREGROUND_FILL_MAX"
                  step="1"
                  title="Compact foreground fill"
                  @input="draftCompactThemeForegroundFills = updateForegroundFillMap(draftCompactThemeForegroundFills, draftCompactThemeId, eventValue($event))"
                />
                <code>{{ selectedForegroundFill(draftCompactThemeForegroundFills, draftCompactThemeId) }}%</code>
              </span>
            </label>
          </div>
        </div>
      </div>
      <div class="settings-theme-actions">
        <button class="icon-button ghost" type="button" @click="$emit('importTheme')">Import Theme</button>
        <button class="icon-button ghost" type="button" @click="$emit('exportTheme')">Export Theme</button>
        <button class="icon-button ghost" type="button" @click="$emit('exportThemeTemplate')">Export Starter Theme</button>
      </div>
      <details class="settings-theme-help">
        <summary>Theme file reference</summary>
        <p>Import Theme reads JSON. Export Starter Theme saves an editable template to your machine with every supported token listed.</p>
        <p>Use a built-in base theme id, an accent color, and optional texture, foreground fill, or token overrides. Missing values keep the base theme value, invalid values are ignored, and rarity colors stay game-matched.</p>
        <pre>{
  "kind": "theme",
  "themeId": "cyberpunk",
  "accent": "#00f0ff",
  "texture": "neon-grid",
  "foregroundFill": 68,
  "tokens": {
    "surface": "rgba(8, 4, 6, 0.94)",
    "border": "rgba(0, 240, 255, 0.48)",
    "buttonPrimary": "#fff200"
  }
}</pre>
        <div class="settings-theme-token-list" aria-label="Theme token reference">
          <span v-for="token in THEME_TOKEN_OPTIONS" :key="token.key">
            <code>{{ token.key }}</code>
            <small>{{ token.cssVar }} - {{ token.label }}</small>
          </span>
        </div>
      </details>
    </section>
  </div>
</template>
