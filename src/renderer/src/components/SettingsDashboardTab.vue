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
  standardTile,
  type CompactRunTileConfig,
  type CompactRunTileKind,
  type CompactRunTilePreset,
} from "../lib/compact-tiles";
import { eventChecked, eventValue } from "../lib/dom-events";
import type { ItemFilterGroup } from "../lib/item-filters";

defineProps<{
  itemFilterGroups: ItemFilterGroup[];
  itemSuggestions: string[];
}>();

const draftCompactRunTiles = defineModel<CompactRunTileConfig[]>("compactRunTiles", { required: true });
const compactStandardOptions = STANDARD_COMPACT_RUN_TILE_OPTIONS;
const compactRunTilePresets = COMPACT_RUN_TILE_PRESETS;
const pendingCompactPresetId = ref<string | null>(null);
const pendingCompactPreset = computed(() => compactRunTilePresets.find((preset) => preset.id === pendingCompactPresetId.value) ?? null);

function isCompactStandardEnabled(kind: Exclude<CompactRunTileKind, "custom">): boolean {
  return draftCompactRunTiles.value.some((tile) => tile.kind === kind);
}

function toggleCompactStandardTile(kind: Exclude<CompactRunTileKind, "custom">, enabled: boolean) {
  if (kind === "duration") return;
  if (enabled) {
    if (isCompactStandardEnabled(kind) || draftCompactRunTiles.value.length >= COMPACT_RUN_TILE_LIMIT) return;
    draftCompactRunTiles.value = [...draftCompactRunTiles.value, standardTile(kind)];
    return;
  }
  draftCompactRunTiles.value = draftCompactRunTiles.value.filter((tile) => tile.kind !== kind);
}

function addCompactCustomTile() {
  const custom = createCustomCompactRunTile(compactRunCustomTileCount(draftCompactRunTiles.value));
  const base = draftCompactRunTiles.value.length >= COMPACT_RUN_TILE_LIMIT
    ? draftCompactRunTiles.value.slice(0, COMPACT_RUN_TILE_LIMIT - 1)
    : draftCompactRunTiles.value;
  draftCompactRunTiles.value = [...base, custom];
}

function chooseCompactTilePreset(preset: CompactRunTilePreset) {
  if (!compactPresetIsActive(preset) && compactRunTilesHaveCustomSources(draftCompactRunTiles.value)) {
    pendingCompactPresetId.value = preset.id;
    return;
  }
  applyCompactTilePreset(preset);
}

function confirmCompactTilePreset() {
  if (!pendingCompactPreset.value) return;
  applyCompactTilePreset(pendingCompactPreset.value);
}

function cancelCompactTilePreset() {
  pendingCompactPresetId.value = null;
}

function applyCompactTilePreset(preset: CompactRunTilePreset) {
  draftCompactRunTiles.value = cloneCompactRunTiles(preset.tiles);
  pendingCompactPresetId.value = null;
}

function compactPresetIsActive(preset: CompactRunTilePreset): boolean {
  return compactRunTilesEqual(draftCompactRunTiles.value, preset.tiles);
}

function removeCompactTile(tile: CompactRunTileConfig) {
  if (tile.kind === "duration") return;
  draftCompactRunTiles.value = draftCompactRunTiles.value.filter((candidate) => candidate.id !== tile.id);
}

function updateCompactCustomTile(tile: CompactRunTileConfig, patch: Partial<CompactRunTileConfig>) {
  draftCompactRunTiles.value = draftCompactRunTiles.value.map((candidate) => (candidate.id === tile.id ? { ...candidate, ...patch } : candidate));
}

function compactCustomTileSource(tile: CompactRunTileConfig): "filterGroup" | "item" {
  return tile.source === "item" ? "item" : "filterGroup";
}

function updateCompactCustomTileSource(tile: CompactRunTileConfig, value: string) {
  updateCompactCustomTile(tile, { source: value === "item" ? "item" : "filterGroup" });
}

</script>

<template>
  <div class="settings-grid settings-grid-single">
    <section class="settings-wide compact-settings-section settings-compact-run-section">
      <div class="compact-settings-heading">
        <strong>Run dashboard tiles</strong>
        <span>{{ draftCompactRunTiles.length }}/{{ COMPACT_RUN_TILE_LIMIT }} shown</span>
      </div>
      <div class="compact-settings-heading">
        <strong>Tile presets</strong>
        <span>Replace the visible dashboard tile set.</span>
      </div>
      <div class="compact-preset-grid">
        <button
          v-for="preset in compactRunTilePresets"
          :key="preset.id"
          :class="['compact-preset-button', { active: compactPresetIsActive(preset) }]"
          type="button"
          @click="chooseCompactTilePreset(preset)"
        >
          <strong>{{ preset.name }}</strong>
          <span>{{ preset.description }}</span>
        </button>
      </div>
      <div v-if="pendingCompactPreset" class="report-preset-confirm compact-preset-confirm" role="alert">
        <span>{{ pendingCompactPreset.name }} will replace existing custom dashboard tiles.</span>
        <button class="icon-button danger" type="button" @click="confirmCompactTilePreset">Replace</button>
        <button class="icon-button ghost" type="button" @click="cancelCompactTilePreset">Keep Current</button>
      </div>
      <div class="compact-settings-chip-grid compact-settings-chip-grid-wide">
        <label v-for="option in compactStandardOptions" :key="option.kind" class="filter-box">
          <input
            :checked="isCompactStandardEnabled(option.kind)"
            :disabled="option.kind === 'duration' || (!isCompactStandardEnabled(option.kind) && draftCompactRunTiles.length >= COMPACT_RUN_TILE_LIMIT)"
            type="checkbox"
            @change="toggleCompactStandardTile(option.kind, eventChecked($event))"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
      <div class="compact-settings-heading">
        <strong>Custom tiles</strong>
        <button class="icon-button ghost" type="button" title="Add a custom tile; if all eight slots are full, the last slot is replaced." @click="addCompactCustomTile">Add Custom</button>
      </div>
      <div v-if="draftCompactRunTiles.some((tile) => tile.kind === 'custom')" class="compact-custom-tile-list">
        <div v-for="tile in draftCompactRunTiles.filter((candidate) => candidate.kind === 'custom')" :key="tile.id" class="compact-custom-tile-row settings-custom-tile-row">
          <input :value="tile.label" type="text" placeholder="Tile label" @input="updateCompactCustomTile(tile, { label: eventValue($event) })" />
          <select :value="compactCustomTileSource(tile)" @change="updateCompactCustomTileSource(tile, eventValue($event))">
            <option value="filterGroup">Filter group</option>
            <option value="item">Item</option>
          </select>
          <select v-if="compactCustomTileSource(tile) === 'filterGroup'" :value="tile.groupId" @change="updateCompactCustomTile(tile, { groupId: eventValue($event) })">
            <option value="">Choose group</option>
            <option v-for="group in itemFilterGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
          <input v-else :value="tile.itemName" list="settings-compact-item-suggestions" type="text" placeholder="Exact item name" @input="updateCompactCustomTile(tile, { itemName: eventValue($event) })" />
          <button class="shopping-remove" type="button" title="Remove custom tile" @click="removeCompactTile(tile)">x</button>
        </div>
      </div>
      <datalist id="settings-compact-item-suggestions">
        <option v-for="item in itemSuggestions" :key="item" :value="item" />
      </datalist>
    </section>
  </div>
</template>
