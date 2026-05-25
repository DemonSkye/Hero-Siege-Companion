<script setup lang="ts">
import {
  COMPACT_RUN_TILE_LIMIT,
  STANDARD_COMPACT_RUN_TILE_OPTIONS,
  compactRunCustomTileCount,
  createCustomCompactRunTile,
  standardTile,
  type CompactRunTileConfig,
  type CompactRunTileKind,
} from "../lib/compact-tiles";
import { eventChecked, eventValue } from "../lib/dom-events";
import type { ItemFilterGroup } from "../lib/item-filters";

defineProps<{
  itemFilterGroups: ItemFilterGroup[];
  itemSuggestions: string[];
}>();

const draftCompactRunTiles = defineModel<CompactRunTileConfig[]>("compactRunTiles", { required: true });
const compactStandardOptions = STANDARD_COMPACT_RUN_TILE_OPTIONS;

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
