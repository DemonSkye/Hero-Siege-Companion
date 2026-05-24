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
import type { ItemFilterGroup } from "../lib/item-filters";

interface ItemTypeOption {
  value: string;
  label: string;
}

defineProps<{
  logLimitOptions: number[];
  itemTypeOptions: ItemTypeOption[];
  itemFilterGroups: ItemFilterGroup[];
  itemSuggestions: string[];
}>();

defineEmits<{
  close: [];
  chooseGameExecutable: [];
  exportConfiguration: [];
  importConfiguration: [];
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
const draftDeveloperItemResearchEnabled = defineModel<boolean>("developerItemResearchEnabled", { required: true });
const draftUnknownItemAudioPrompt = defineModel<boolean>("unknownItemAudioPrompt", { required: true });
const configIncludeAppSettings = defineModel<boolean>("configIncludeAppSettings", { required: true });
const configIncludeRunSaving = defineModel<boolean>("configIncludeRunSaving", { required: true });
const configIncludeReportTracking = defineModel<boolean>("configIncludeReportTracking", { required: true });
const configIncludeLootFilters = defineModel<boolean>("configIncludeLootFilters", { required: true });
const configIncludeItemResearch = defineModel<boolean>("configIncludeItemResearch", { required: true });
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

function eventChecked(event: Event): boolean {
  return Boolean((event.target as HTMLInputElement | null)?.checked);
}

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
}
</script>

<template>
  <div class="modal-backdrop">
    <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Preferences</p>
          <h2 id="settings-title">Settings</h2>
          <p class="settings-note">These preferences are saved on this device and restored between sessions.</p>
        </div>
        <button class="settings-close" type="button" title="Close settings" aria-label="Close settings" @click="$emit('close')">x</button>
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
          <span class="settings-label">Verbose live logging <span class="info-bubble" data-tip="Writes a wider packet trace to capture-wide-debug.log for loot correlation diagnostics. Parsed item events still appear in Live Log.">i</span></span>
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
          <input v-model="draftDeveloperItemResearchEnabled" type="checkbox" />
          <span class="settings-label">Developer item research <span class="info-bubble" data-tip="Adds an opt-in local research queue for unresolved item IDs so drops can help build better lookup data.">i</span></span>
        </label>
        <label class="settings-check">
          <input v-model="draftUnknownItemAudioPrompt" :disabled="!draftDeveloperItemResearchEnabled" type="checkbox" />
          <span class="settings-label">Prompt on unknown drops <span class="info-bubble" data-tip="Plays a quiet cue when a new unresolved item signature appears while developer item research is enabled.">i</span></span>
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
        <div class="settings-config-row settings-wide">
          <span class="settings-label">Configuration JSON <span class="info-bubble" data-tip="These checkboxes control what gets exported and what gets applied when importing. Unchecked areas are left alone on import.">i</span></span>
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

      <div class="settings-actions">
        <button class="icon-button ghost" type="button" @click="$emit('reset')">Reset Preferences</button>
        <button class="icon-button primary" type="button" @click="$emit('apply')">Done</button>
      </div>
    </section>
  </div>
</template>
