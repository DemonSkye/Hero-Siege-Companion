<script setup lang="ts">
import { computed, ref } from "vue";
import {
  COMPACT_RUN_TILE_LIMIT,
  COMPACT_RUN_TILE_PRESETS,
  STANDARD_COMPACT_RUN_TILE_OPTIONS,
  cloneCompactRunTiles,
  compactRunCustomTileCount,
  compactRunTilesEqual,
  compactRunTilesHaveCustomSources,
  createCustomCompactRunTile,
  defaultCompactRunTiles,
  standardTile,
  type CompactRunTileConfig,
  type CompactRunTileKind,
  type CompactRunTilePreset,
} from "../lib/compact-tiles";
import { eventValue } from "../lib/dom-events";
import type { ItemFilterGroup } from "../lib/item-filters";
import { useModalFocus } from "../lib/modal-focus";
import SettingsActionDialog from "./SettingsActionDialog.vue";

withDefaults(defineProps<{
  itemFilterGroups: ItemFilterGroup[];
  itemSuggestions: string[];
  saveStatus?: "saved" | "saving" | "error";
}>(), {
  saveStatus: "saved",
});

const emit = defineEmits<{
  close: [];
  reset: [];
  retrySave: [];
}>();

const compactRunTiles = defineModel<CompactRunTileConfig[]>("compactRunTiles", { required: true });
const dialog = ref<HTMLElement | null>(null);
const addMenuOpen = ref(false);
const pendingPreset = ref<CompactRunTilePreset | null>(null);
const resetConfirmationOpen = ref(false);
const { handleModalFocusKeydown } = useModalFocus(dialog);

const availableStandardTiles = computed(() => STANDARD_COMPACT_RUN_TILE_OPTIONS.filter((option) => (
  option.kind !== "duration" && !compactRunTiles.value.some((tile) => tile.kind === option.kind)
)));
const customTiles = computed(() => compactRunTiles.value.filter((tile) => tile.kind === "custom"));

function tileLabel(tile: CompactRunTileConfig): string {
  if (tile.kind === "custom") return tile.label?.trim() || "Custom tile";
  return STANDARD_COMPACT_RUN_TILE_OPTIONS.find((option) => option.kind === tile.kind)?.label ?? tile.kind;
}

function addStandardTile(kind: Exclude<CompactRunTileKind, "custom">) {
  if (compactRunTiles.value.length >= COMPACT_RUN_TILE_LIMIT || compactRunTiles.value.some((tile) => tile.kind === kind)) return;
  compactRunTiles.value = [...compactRunTiles.value, standardTile(kind)];
  addMenuOpen.value = false;
}

function addCustomTile() {
  const custom = createCustomCompactRunTile(compactRunCustomTileCount(compactRunTiles.value));
  const base = compactRunTiles.value.length >= COMPACT_RUN_TILE_LIMIT
    ? compactRunTiles.value.slice(0, COMPACT_RUN_TILE_LIMIT - 1)
    : compactRunTiles.value;
  compactRunTiles.value = [...base, custom];
}

function removeTile(tile: CompactRunTileConfig) {
  if (tile.kind === "duration") return;
  compactRunTiles.value = compactRunTiles.value.filter((candidate) => candidate.id !== tile.id);
}

function moveTile(tile: CompactRunTileConfig, direction: -1 | 1) {
  const index = compactRunTiles.value.findIndex((candidate) => candidate.id === tile.id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= compactRunTiles.value.length) return;
  const next = [...compactRunTiles.value];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  compactRunTiles.value = next;
}

function choosePreset(preset: CompactRunTilePreset) {
  if (compactRunTilesEqual(compactRunTiles.value, preset.tiles)) return;
  if (compactRunTilesHaveCustomSources(compactRunTiles.value)) {
    pendingPreset.value = preset;
    return;
  }
  applyPreset(preset);
}

function applyPreset(preset: CompactRunTilePreset) {
  compactRunTiles.value = cloneCompactRunTiles(preset.tiles);
  pendingPreset.value = null;
}

function confirmReset() {
  compactRunTiles.value = cloneCompactRunTiles(defaultCompactRunTiles);
  resetConfirmationOpen.value = false;
  emit("reset");
}

function updateCustomTile(tile: CompactRunTileConfig, patch: Partial<CompactRunTileConfig>) {
  compactRunTiles.value = compactRunTiles.value.map((candidate) => candidate.id === tile.id ? { ...candidate, ...patch } : candidate);
}

function updateCustomSource(tile: CompactRunTileConfig, value: string) {
  updateCustomTile(tile, { source: value === "item" ? "item" : "filterGroup" });
}

function saveStatusLabel(status: "saved" | "saving" | "error"): string {
  if (status === "saving") return "Saving…";
  if (status === "error") return "Couldn’t save";
  return "Saved";
}
</script>

<template>
  <div class="modal-backdrop settings-ledger-backdrop" @keydown="handleModalFocusKeydown" @keydown.esc="$emit('close')">
    <section
      ref="dialog"
      class="settings-panel compact-customize-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compact-customize-title"
      tabindex="-1"
    >
      <header class="settings-ledger-header">
        <div>
          <p class="eyebrow">Compact Mode</p>
          <h2 id="compact-customize-title">Customize Compact Mode</h2>
          <p>Choose the small set of run tiles that stays visible over the game.</p>
        </div>
        <div class="settings-ledger-header-actions">
          <button v-if="saveStatus === 'error'" class="settings-save-state error" type="button" @click="$emit('retrySave')">{{ saveStatusLabel(saveStatus) }} · Retry</button>
          <span v-else :class="['settings-save-state', saveStatus]" role="status" aria-live="polite">{{ saveStatusLabel(saveStatus) }}</span>
          <button class="settings-close" type="button" aria-label="Close compact customization" @click="$emit('close')">×</button>
        </div>
      </header>

      <div class="compact-customize-content">
        <section class="settings-ledger-section" aria-labelledby="compact-presets-title">
          <div class="settings-ledger-section-heading">
            <h3 id="compact-presets-title">Presets</h3>
            <p>Start with an opinionated layout, then adjust the selected tiles below.</p>
          </div>
          <div class="compact-preset-grid compact-preset-grid-ledger">
            <button
              v-for="preset in COMPACT_RUN_TILE_PRESETS"
              :key="preset.id"
              :class="['compact-preset-button', { active: compactRunTilesEqual(compactRunTiles, preset.tiles) }]"
              type="button"
              @click="choosePreset(preset)"
            >
              <strong>{{ preset.name }}</strong>
              <span>{{ preset.description }}</span>
            </button>
          </div>
        </section>

        <section class="settings-ledger-section" aria-labelledby="compact-selected-tiles-title">
          <div class="settings-ledger-section-heading compact-selected-heading">
            <div>
              <h3 id="compact-selected-tiles-title">Selected tiles</h3>
              <p>{{ compactRunTiles.length }}/{{ COMPACT_RUN_TILE_LIMIT }} visible. Duration is always included.</p>
            </div>
            <div class="compact-add-tile">
              <button
                class="icon-button primary"
                type="button"
                :disabled="compactRunTiles.length >= COMPACT_RUN_TILE_LIMIT || !availableStandardTiles.length"
                :aria-expanded="addMenuOpen"
                aria-controls="compact-add-tile-menu"
                @click="addMenuOpen = !addMenuOpen"
              >Add Tile</button>
              <div v-if="addMenuOpen" id="compact-add-tile-menu" class="compact-add-tile-menu" role="menu">
                <button v-for="option in availableStandardTiles" :key="option.kind" type="button" role="menuitem" @click="addStandardTile(option.kind)">{{ option.label }}</button>
              </div>
            </div>
          </div>

          <ol class="compact-selected-list">
            <li v-for="(tile, index) in compactRunTiles" :key="tile.id">
              <span class="compact-selected-position">{{ index + 1 }}</span>
              <div>
                <strong>{{ tileLabel(tile) }}</strong>
                <small v-if="tile.kind === 'custom'">{{ tile.source === "item" ? tile.itemName || "Choose an item" : "Filter group" }}</small>
                <small v-else>{{ tile.kind === "duration" ? "Required" : "Standard tile" }}</small>
              </div>
              <div class="compact-selected-actions">
                <button class="shopping-remove" type="button" :disabled="index === 0" :aria-label="`Move ${tileLabel(tile)} up`" @click="moveTile(tile, -1)">↑</button>
                <button class="shopping-remove" type="button" :disabled="index === compactRunTiles.length - 1" :aria-label="`Move ${tileLabel(tile)} down`" @click="moveTile(tile, 1)">↓</button>
                <button v-if="tile.kind !== 'duration'" class="shopping-remove" type="button" :aria-label="`Remove ${tileLabel(tile)}`" @click="removeTile(tile)">×</button>
              </div>
            </li>
          </ol>
        </section>

        <details class="settings-disclosure compact-advanced-tiles">
          <summary>
            <span><strong>Advanced</strong><small>Create tiles from an exact item name or one of your Item Filter groups.</small></span>
            <span class="settings-nav-tag">{{ customTiles.length }} custom</span>
          </summary>
          <div class="settings-disclosure-body">
            <div class="compact-advanced-heading">
              <p>Custom tiles share the eight-tile limit with standard tiles.</p>
              <button class="icon-button ghost" type="button" :disabled="compactRunTiles.length >= COMPACT_RUN_TILE_LIMIT" @click="addCustomTile">Add Custom Tile</button>
            </div>
            <div v-if="customTiles.length" class="compact-custom-tile-list compact-custom-ledger-list">
              <fieldset v-for="tile in customTiles" :key="tile.id" class="compact-custom-ledger-row">
                <legend>{{ tileLabel(tile) }}</legend>
                <label>
                  <span>Label</span>
                  <input :value="tile.label" type="text" placeholder="Tile label" @input="updateCustomTile(tile, { label: eventValue($event) })" />
                </label>
                <label>
                  <span>Source</span>
                  <select :value="tile.source === 'item' ? 'item' : 'filterGroup'" @change="updateCustomSource(tile, eventValue($event))">
                    <option value="filterGroup">Filter group</option>
                    <option value="item">Exact item</option>
                  </select>
                </label>
                <label v-if="tile.source === 'item'">
                  <span>Item name</span>
                  <input :value="tile.itemName" list="compact-customize-item-suggestions" type="text" placeholder="Exact item name" @input="updateCustomTile(tile, { itemName: eventValue($event) })" />
                </label>
                <label v-else>
                  <span>Filter group</span>
                  <select :value="tile.groupId" @change="updateCustomTile(tile, { groupId: eventValue($event) })">
                    <option value="">Choose group</option>
                    <option v-for="group in itemFilterGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
                  </select>
                </label>
                <button class="icon-button danger" type="button" @click="removeTile(tile)">Remove</button>
              </fieldset>
            </div>
            <p v-else class="empty-copy">No custom tiles. Standard tiles cover the common dashboard metrics.</p>
            <datalist id="compact-customize-item-suggestions">
              <option v-for="item in itemSuggestions" :key="item" :value="item" />
            </datalist>
          </div>
        </details>

        <div class="compact-customize-reset">
          <div>
            <strong>Reset Compact Layout</strong>
            <p>Return to the recommended default tile order.</p>
          </div>
          <button class="icon-button ghost" type="button" @click="resetConfirmationOpen = true">Reset Layout…</button>
        </div>
      </div>

      <SettingsActionDialog
        v-if="pendingPreset"
        :title="`Use ${pendingPreset.name}?`"
        confirm-label="Replace Layout"
        @close="pendingPreset = null"
        @confirm="applyPreset(pendingPreset)"
      >
        <p>This preset replaces the current tile list, including custom item and Item Filter tiles.</p>
      </SettingsActionDialog>
      <SettingsActionDialog
        v-else-if="resetConfirmationOpen"
        title="Reset compact layout?"
        confirm-label="Reset Layout"
        @close="resetConfirmationOpen = false"
        @confirm="confirmReset"
      >
        <p>This replaces the current tile order with the recommended default layout.</p>
      </SettingsActionDialog>
    </section>
  </div>
</template>
