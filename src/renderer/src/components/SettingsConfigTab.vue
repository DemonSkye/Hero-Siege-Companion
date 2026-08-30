<script setup lang="ts">
import { ref } from "vue";
import { THEME_TOKEN_OPTIONS } from "../lib/themes";

withDefaults(defineProps<{
  legacyResearchAvailable?: boolean;
}>(), {
  legacyResearchAvailable: false,
});

defineEmits<{
  importTheme: [];
  exportTheme: [];
  exportThemeTemplate: [];
  copyThemeTokenReference: [];
  exportLegacyResearch: [];
}>();

const referenceView = ref<"schema" | "tokens">("schema");
</script>

<template>
  <div class="settings-ledger-panel-heading">
    <h2>Developers</h2>
    <p>Advanced theme-authoring resources. Built-in themes remain canonical and intentionally non-editable.</p>
  </div>

  <section class="settings-ledger-section" aria-labelledby="settings-theme-tools-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-theme-tools-title">Theme tools</h3>
      <p>Custom themes are the supported route for manual color, texture, fill, and token overrides.</p>
    </div>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Custom theme files</span>
        <p>Import a theme or export the current custom theme for sharing.</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <button class="icon-button ghost" type="button" @click="$emit('importTheme')">Import Theme</button>
        <button class="icon-button ghost" type="button" @click="$emit('exportTheme')">Export Current Theme</button>
      </div>
    </div>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Start a new theme</span>
        <p>Download a complete editable template using the current schema.</p>
      </div>
      <div class="settings-ledger-control">
        <button class="icon-button ghost" type="button" @click="$emit('exportThemeTemplate')">Download Starter Theme</button>
      </div>
    </div>

    <details class="settings-disclosure">
      <summary>
        <span><strong>Schema &amp; token reference</strong><small>Theme structure and supported application tokens.</small></span>
        <span class="settings-nav-tag">JSON</span>
      </summary>
      <div class="settings-disclosure-body">
        <p>Invalid values are ignored; omitted values inherit from the selected base theme. Rarity colors always remain game-matched.</p>
        <div class="settings-reference-tabs" role="group" aria-label="Theme developer reference">
          <button :class="['icon-button', referenceView === 'schema' ? 'primary' : 'ghost']" type="button" @click="referenceView = 'schema'">Theme Schema</button>
          <button :class="['icon-button', referenceView === 'tokens' ? 'primary' : 'ghost']" type="button" @click="referenceView = 'tokens'">Token Reference</button>
          <button class="icon-button ghost" type="button" @click="$emit('copyThemeTokenReference')">Copy Reference</button>
        </div>
        <pre v-if="referenceView === 'schema'" class="settings-code">{
  "kind": "theme",
  "themeId": "voidglass",
  "accent": "#69e6d0",
  "texture": "void-fracture",
  "foregroundFill": 78,
  "tokens": {
    "surface": "rgba(8, 20, 24, 0.94)",
    "border": "rgba(105, 230, 208, 0.42)"
  }
}</pre>
        <div v-else class="settings-theme-token-list" aria-label="Theme token reference">
          <span v-for="token in THEME_TOKEN_OPTIONS" :key="token.key">
            <code>{{ token.key }}</code>
            <small>{{ token.cssVar }} · {{ token.label }}</small>
          </span>
        </div>
      </div>
    </details>
  </section>

  <section v-if="legacyResearchAvailable" class="settings-ledger-section" aria-labelledby="settings-legacy-research-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-legacy-research-title">Legacy data export</h3>
      <p>Player-facing Item Research has been retired.</p>
    </div>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span class="settings-ledger-title">Previous Item Research</span>
        <p>Export the existing authored research once before the companion stops loading those legacy entries.</p>
      </div>
      <div class="settings-ledger-control">
        <button class="icon-button ghost" type="button" @click="$emit('exportLegacyResearch')">Export Legacy Research</button>
      </div>
    </div>
  </section>
</template>
