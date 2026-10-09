<script setup lang="ts">
import { computed, ref } from "vue";
import {
  COMPACT_PAGE_LIMIT,
  COMPACT_PAGE_PRESETS,
  COMPACT_PAGE_TILE_LIMIT,
  cloneCompactPages,
  compactPagesEqual,
  compactPageTiles,
  createCompactPage,
  defaultCompactPages,
  type CompactNavigationConfig,
  type CompactPageConfig,
  type CompactPagePreset,
} from "../lib/compact-pages";
import {
  STANDARD_COMPACT_RUN_TILE_OPTIONS,
  compactRunCustomTileCount,
  createCustomCompactRunTile,
  standardTile,
  type CompactRunTileConfig,
  type CompactRunTileKind,
} from "../lib/compact-tiles";
import { eventChecked, eventValue } from "../lib/dom-events";
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

const compactPages = defineModel<CompactPageConfig[]>("compactPages", { required: true });
const compactNavigation = defineModel<CompactNavigationConfig>("compactNavigation", { required: true });
const dialog = ref<HTMLElement | null>(null);
const pendingPreset = ref<CompactPagePreset | null>(null);
const resetConfirmationOpen = ref(false);
const { handleModalFocusKeydown } = useModalFocus(dialog);

const hasCustomTiles = computed(() => compactPageTiles(compactPages.value).some((tile) => tile.kind === "custom"));
const slots = Array.from({ length: COMPACT_PAGE_TILE_LIMIT }, (_, index) => index);
const navigationOptions: Array<{ key: keyof CompactNavigationConfig; label: string; detail: string }> = [
  { key: "wheel", label: "Mouse wheel", detail: "Scroll over the compact window to change pages." },
  { key: "arrowKeys", label: "Arrow keys", detail: "Up/Down (or Left/Right) while the compact window is focused. Home and End jump to the first and last page." },
  { key: "pageKeys", label: "Page Up / Page Down", detail: "Page keys while the compact window is focused." },
  { key: "wrap", label: "Loop around", detail: "Moving past the last page returns to the first." },
];

function updatePage(page: CompactPageConfig, patch: Partial<CompactPageConfig>) {
  compactPages.value = compactPages.value.map((candidate) => candidate.id === page.id ? { ...candidate, ...patch } : candidate);
}

function addPage() {
  if (compactPages.value.length >= COMPACT_PAGE_LIMIT) return;
  compactPages.value = [...compactPages.value, createCompactPage(compactPages.value)];
}

function removePage(page: CompactPageConfig) {
  if (compactPages.value.length <= 1) return;
  compactPages.value = compactPages.value.filter((candidate) => candidate.id !== page.id);
}

function movePage(page: CompactPageConfig, direction: -1 | 1) {
  const index = compactPages.value.findIndex((candidate) => candidate.id === page.id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= compactPages.value.length) return;
  const next = [...compactPages.value];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  compactPages.value = next;
}

function setPageKind(page: CompactPageConfig, value: string) {
  const kind = value === "zone" ? "zone" : "tiles";
  updatePage(page, { kind, tiles: kind === "zone" ? [] : page.tiles, name: kind === "zone" && /^Page \d+$/.test(page.name) ? "Satanic Zone" : page.name });
}

function slotValue(page: CompactPageConfig, slot: number): string {
  return page.tiles[slot]?.kind ?? "";
}

function standardOptions(page: CompactPageConfig, slot: number) {
  const usedElsewhere = new Set(page.tiles.filter((_, index) => index !== slot).map((tile) => tile.kind));
  return STANDARD_COMPACT_RUN_TILE_OPTIONS.filter((option) => !usedElsewhere.has(option.kind));
}

function setSlot(page: CompactPageConfig, slot: number, value: string) {
  const tiles = [...page.tiles];
  if (!value) {
    tiles.splice(slot, 1);
  } else {
    const tile: CompactRunTileConfig = value === "custom"
      ? createCustomCompactRunTile(compactRunCustomTileCount(compactPageTiles(compactPages.value)))
      : standardTile(value as Exclude<CompactRunTileKind, "custom">);
    if (slot < tiles.length) tiles[slot] = tile;
    else tiles.push(tile);
  }
  updatePage(page, { tiles });
}

function updateCustomTile(page: CompactPageConfig, tile: CompactRunTileConfig, patch: Partial<CompactRunTileConfig>) {
  updatePage(page, { tiles: page.tiles.map((candidate) => candidate.id === tile.id ? { ...candidate, ...patch } : candidate) });
}

function customTileLabel(tile: CompactRunTileConfig): string {
  return tile.label?.trim() || "Custom tile";
}

function choosePreset(preset: CompactPagePreset) {
  if (compactPagesEqual(compactPages.value, preset.pages)) return;
  if (hasCustomTiles.value) {
    pendingPreset.value = preset;
    return;
  }
  applyPreset(preset);
}

function applyPreset(preset: CompactPagePreset) {
  compactPages.value = cloneCompactPages(preset.pages);
  pendingPreset.value = null;
}

function setNavigation(key: keyof CompactNavigationConfig, value: boolean) {
  compactNavigation.value = { ...compactNavigation.value, [key]: value };
}

function confirmReset() {
  compactPages.value = cloneCompactPages(defaultCompactPages);
  resetConfirmationOpen.value = false;
  emit("reset");
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
          <p>Compact mode shows one page at a time. Each page holds up to {{ COMPACT_PAGE_TILE_LIMIT }} tiles.</p>
        </div>
        <div class="settings-ledger-header-actions">
          <button v-if="saveStatus === 'error'" class="settings-save-state error" type="button" @click="$emit('retrySave')">{{ saveStatusLabel(saveStatus) }} · Retry</button>
          <span v-else :class="['settings-save-state', saveStatus]" role="status" aria-live="polite">{{ saveStatusLabel(saveStatus) }}</span>
          <button class="settings-close" type="button" aria-label="Close compact customization" @click="$emit('close')">×</button>
        </div>
      </header>

      <div class="compact-customize-content">
        <section class="settings-ledger-section" aria-labelledby="compact-pages-title">
          <div class="settings-ledger-section-heading compact-selected-heading">
            <div>
              <h3 id="compact-pages-title">Pages</h3>
              <p>{{ compactPages.length }}/{{ COMPACT_PAGE_LIMIT }} pages, shown in this order.</p>
            </div>
            <button class="icon-button primary" type="button" :disabled="compactPages.length >= COMPACT_PAGE_LIMIT" @click="addPage">Add Page</button>
          </div>

          <ol class="compact-page-list">
            <li v-for="(page, index) in compactPages" :key="page.id" class="compact-page-editor">
              <div class="compact-page-editor-head">
                <span class="compact-selected-position">{{ index + 1 }}</span>
                <label class="compact-page-name">
                  <span>Page name</span>
                  <input :value="page.name" type="text" maxlength="20" @input="updatePage(page, { name: eventValue($event) })" />
                </label>
                <label class="compact-page-kind">
                  <span>Shows</span>
                  <select :value="page.kind" @change="setPageKind(page, eventValue($event))">
                    <option value="tiles">Tiles</option>
                    <option value="zone">Satanic Zone</option>
                  </select>
                </label>
                <div class="compact-selected-actions">
                  <button class="shopping-remove" type="button" :disabled="index === 0" :aria-label="`Move ${page.name} page up`" @click="movePage(page, -1)">↑</button>
                  <button class="shopping-remove" type="button" :disabled="index === compactPages.length - 1" :aria-label="`Move ${page.name} page down`" @click="movePage(page, 1)">↓</button>
                  <button class="shopping-remove" type="button" :disabled="compactPages.length <= 1" :aria-label="`Remove ${page.name} page`" @click="removePage(page)">×</button>
                </div>
              </div>

              <p v-if="page.kind === 'zone'" class="compact-page-zone-note">Shows the current Satanic Zone, its reset timer, and its pros and cons.</p>
              <template v-else>
                <div class="compact-slot-grid">
                  <label v-for="slot in slots" :key="slot" :class="{ empty: !page.tiles[slot] }">
                    <span>Tile {{ slot + 1 }}</span>
                    <select
                      :value="slotValue(page, slot)"
                      :disabled="slot > page.tiles.length"
                      :aria-label="`${page.name} tile ${slot + 1}`"
                      @change="setSlot(page, slot, eventValue($event))"
                    >
                      <option value="">Empty</option>
                      <option v-for="option in standardOptions(page, slot)" :key="option.kind" :value="option.kind">{{ option.label }}</option>
                      <option value="custom">Custom: item or filter group</option>
                    </select>
                  </label>
                </div>
                <fieldset v-for="tile in page.tiles.filter((candidate) => candidate.kind === 'custom')" :key="tile.id" class="compact-custom-ledger-row">
                  <legend>{{ customTileLabel(tile) }}</legend>
                  <label>
                    <span>Label</span>
                    <input :value="tile.label" type="text" placeholder="Tile label" @input="updateCustomTile(page, tile, { label: eventValue($event) })" />
                  </label>
                  <label>
                    <span>Source</span>
                    <select :value="tile.source === 'item' ? 'item' : 'filterGroup'" @change="updateCustomTile(page, tile, { source: eventValue($event) === 'item' ? 'item' : 'filterGroup' })">
                      <option value="filterGroup">Filter group</option>
                      <option value="item">Exact item</option>
                    </select>
                  </label>
                  <label v-if="tile.source === 'item'">
                    <span>Item name</span>
                    <input :value="tile.itemName" list="compact-customize-item-suggestions" type="text" placeholder="Exact item name" @input="updateCustomTile(page, tile, { itemName: eventValue($event) })" />
                  </label>
                  <label v-else>
                    <span>Filter group</span>
                    <select :value="tile.groupId" @change="updateCustomTile(page, tile, { groupId: eventValue($event) })">
                      <option value="">Choose group</option>
                      <option v-for="group in itemFilterGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
                    </select>
                  </label>
                </fieldset>
              </template>
            </li>
          </ol>
          <datalist id="compact-customize-item-suggestions">
            <option v-for="item in itemSuggestions" :key="item" :value="item" />
          </datalist>
        </section>

        <section class="settings-ledger-section" aria-labelledby="compact-navigation-title">
          <div class="settings-ledger-section-heading">
            <h3 id="compact-navigation-title">Changing pages</h3>
            <p>The page dots on the right always work. Choose which other inputs change pages.</p>
          </div>
          <div class="compact-navigation-options">
            <label v-for="option in navigationOptions" :key="option.key" class="compact-navigation-option">
              <input type="checkbox" :checked="compactNavigation[option.key]" @change="setNavigation(option.key, eventChecked($event))" />
              <span><strong>{{ option.label }}</strong><small>{{ option.detail }}</small></span>
            </label>
          </div>
        </section>

        <section class="settings-ledger-section" aria-labelledby="compact-presets-title">
          <div class="settings-ledger-section-heading">
            <h3 id="compact-presets-title">Presets</h3>
            <p>Replace all pages with a ready-made set, then adjust it above.</p>
          </div>
          <div class="compact-preset-grid compact-preset-grid-ledger">
            <button
              v-for="preset in COMPACT_PAGE_PRESETS"
              :key="preset.id"
              :class="['compact-preset-button', { active: compactPagesEqual(compactPages, preset.pages) }]"
              type="button"
              @click="choosePreset(preset)"
            >
              <strong>{{ preset.name }}</strong>
              <span>{{ preset.description }}</span>
            </button>
          </div>
        </section>

        <div class="compact-customize-reset">
          <div>
            <strong>Reset Compact Layout</strong>
            <p>Return to the recommended Run, Loot and Satanic Zone pages.</p>
          </div>
          <button class="icon-button ghost" type="button" @click="resetConfirmationOpen = true">Reset Layout…</button>
        </div>
      </div>

      <SettingsActionDialog
        v-if="pendingPreset"
        :title="`Use ${pendingPreset.name}?`"
        confirm-label="Replace Pages"
        @close="pendingPreset = null"
        @confirm="applyPreset(pendingPreset)"
      >
        <p>This preset replaces every page, including custom item and Item Filter tiles.</p>
      </SettingsActionDialog>
      <SettingsActionDialog
        v-else-if="resetConfirmationOpen"
        title="Reset compact layout?"
        confirm-label="Reset Layout"
        @close="resetConfirmationOpen = false"
        @confirm="confirmReset"
      >
        <p>This replaces your pages with the recommended default layout.</p>
      </SettingsActionDialog>
    </section>
  </div>
</template>
