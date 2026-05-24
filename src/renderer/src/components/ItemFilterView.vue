<script setup lang="ts">
import { computed } from "vue";
import {
  ITEM_FILTER_RARITIES,
  ITEM_FILTER_SOUNDS,
  soundName,
  toggleFilterRarity,
  toggleFilterType,
  type ItemFilterGroup,
  type ItemFilterSpecificItem,
} from "../lib/item-filters";
import type { ItemResearchEntry } from "../lib/item-research";

interface ItemTypeOption {
  value: string;
  label: string;
}

const props = defineProps<{
  itemFilterGroups: ItemFilterGroup[];
  selectedItemFilterGroup: ItemFilterGroup | null;
  selectedItemFilterGroupedItems: Array<{ typeLabel: string; items: ItemFilterSpecificItem[] }>;
  itemFilterDraftGroupName: string;
  itemFilterDraftItem: string;
  itemFilterSuggestions: string[];
  itemTypeOptions: ItemTypeOption[];
  itemFilterMuted: boolean;
  developerItemResearchEnabled: boolean;
  itemResearchEntries: ItemResearchEntry[];
  unresolvedItemResearchCount: number;
}>();

const emit = defineEmits<{
  "update:itemFilterMuted": [value: boolean];
  "update:itemFilterDraftGroupName": [value: string];
  "update:itemFilterDraftItem": [value: string];
  addGroup: [];
  selectGroup: [group: ItemFilterGroup];
  removeGroup: [group: ItemFilterGroup];
  addItemToGroup: [group: ItemFilterGroup, value?: string];
  removeItemFromGroup: [group: ItemFilterGroup, item: ItemFilterSpecificItem];
  testSound: [soundId?: string, volume?: number];
  exportItemResearch: [];
  saveItemResearchEntry: [signature: string, value: { resolvedName: string; notes: string }];
  ignoreItemResearchEntry: [signature: string];
  resetItemResearchEntry: [signature: string];
  clearResolvedItemResearchEntries: [];
}>();

const mutedModel = computed({
  get: () => props.itemFilterMuted,
  set: (value: boolean) => emit("update:itemFilterMuted", value),
});

const groupNameModel = computed({
  get: () => props.itemFilterDraftGroupName,
  set: (value: string) => emit("update:itemFilterDraftGroupName", value),
});

const itemDraftModel = computed({
  get: () => props.itemFilterDraftItem,
  set: (value: string) => emit("update:itemFilterDraftItem", value),
});

function eventChecked(event: Event): boolean {
  return Boolean((event.target as HTMLInputElement | null)?.checked);
}

function saveResearchEntry(entry: ItemResearchEntry) {
  emit("saveItemResearchEntry", entry.signature, { resolvedName: entry.resolvedName, notes: entry.notes });
}

function entryTypeLabel(entry: ItemResearchEntry): string {
  return props.itemTypeOptions.find((option) => Number(option.value) === entry.type)?.label ?? `Type ${entry.type}`;
}

function formatSeen(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
</script>

<template>
  <section class="item-filter-view">
    <article class="panel item-filter-page">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Loot Audio</p>
          <h2>Item Filter <span class="info-bubble" data-tip="Sounds are triggered from captured network traffic, so alerts can arrive a couple seconds after the item appears in game.">i</span></h2>
        </div>
        <div class="item-filter-actions">
          <button class="icon-button ghost" type="button" @click="mutedModel = !mutedModel">{{ mutedModel ? "Unmute All" : "Mute All" }}</button>
          <button class="icon-button primary" type="button" @click="$emit('testSound')">Test Selected</button>
        </div>
      </div>

      <section v-if="developerItemResearchEnabled" class="item-research-panel">
        <div class="item-filter-rule-heading item-research-heading">
          <div>
            <strong>Item Research</strong>
            <span>{{ unresolvedItemResearchCount }} unresolved &middot; local developer notebook</span>
          </div>
          <button class="icon-button ghost" type="button" @click="$emit('exportItemResearch')">Export Research JSON</button>
        </div>
        <p class="item-research-share">
          Names are case-normalized on save and export. Share exported research as a
          <a href="https://gist.github.com/" target="_blank" rel="noreferrer">GitHub Gist</a>
          with sarevok9 on Reddit or Snyne on the Hero Siege Discord.
        </p>
        <div v-if="itemResearchEntries.length" class="item-research-list">
          <article v-for="entry in itemResearchEntries" :key="entry.signature" :class="['item-research-row', { resolved: entry.resolvedName, ignored: entry.ignored }]">
            <div class="item-research-meta">
              <strong>{{ entry.resolvedName || entry.label }}</strong>
              <span>{{ entry.rarity }} &middot; {{ entryTypeLabel(entry) }} #{{ entry.id }} &middot; Q{{ entry.dropQuality }} &middot; {{ entry.count }} seen &middot; {{ formatSeen(entry.lastSeenAt) }}</span>
            </div>
            <input v-model="entry.resolvedName" type="text" placeholder="Actual item name" spellcheck="false" />
            <input v-model="entry.notes" type="text" placeholder="Notes" spellcheck="false" />
            <div class="item-research-actions">
              <button class="sound-test-button" type="button" @click="saveResearchEntry(entry)">Save</button>
              <button v-if="entry.ignored || entry.resolvedName" class="sound-test-button" type="button" @click="$emit('resetItemResearchEntry', entry.signature)">Reset</button>
              <button v-else class="shopping-remove" type="button" @click="$emit('ignoreItemResearchEntry', entry.signature)" :aria-label="`Ignore ${entry.label}`">x</button>
            </div>
          </article>
        </div>
        <p v-else class="empty-copy">Unresolved item signatures will appear here after developer item research is enabled.</p>
        <button v-if="itemResearchEntries.some((entry) => entry.resolvedName || entry.ignored)" class="icon-button ghost item-research-clear" type="button" @click="$emit('clearResolvedItemResearchEntries')">Clear Resolved</button>
      </section>

      <div class="item-filter-layout">
        <aside class="item-filter-group-sidebar" aria-label="Item filter groups">
          <form class="item-filter-add-group" @submit.prevent="$emit('addGroup')">
            <input v-model="groupNameModel" type="text" placeholder="New group" spellcheck="false" />
            <button class="icon-button primary" type="submit">Add</button>
          </form>
          <div class="item-filter-group-list">
            <button
              v-for="group in itemFilterGroups"
              :key="group.id"
              type="button"
              :class="['item-filter-group-button', { active: selectedItemFilterGroup?.id === group.id, disabled: !group.enabled }]"
              @click="$emit('selectGroup', group)"
            >
              <strong>{{ group.name }}</strong>
              <span>{{ group.enabled ? "Enabled" : "Disabled" }} &middot; {{ soundName(group.soundId) }}</span>
            </button>
          </div>
        </aside>

        <section v-if="selectedItemFilterGroup" class="item-filter-editor">
          <div class="item-filter-editor-head">
            <label class="settings-check">
              <input v-model="selectedItemFilterGroup.enabled" type="checkbox" />
              <span>Enabled</span>
            </label>
            <button class="icon-button ghost" type="button" @click="$emit('removeGroup', selectedItemFilterGroup)">Remove Group</button>
          </div>

          <div class="item-filter-editor-grid">
            <label class="settings-row">
              <span>Group name</span>
              <input v-model="selectedItemFilterGroup.name" type="text" spellcheck="false" />
            </label>
            <label class="settings-row">
              <span>Sound</span>
              <div class="sound-picker">
                <select v-model="selectedItemFilterGroup.soundId">
                  <option v-for="sound in ITEM_FILTER_SOUNDS" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
                </select>
                <button class="sound-test-button" type="button" @click="$emit('testSound', selectedItemFilterGroup.soundId, selectedItemFilterGroup.volume)" title="Play sound" aria-label="Play selected group sound">Play</button>
              </div>
            </label>
            <label class="settings-row">
              <span>Volume</span>
              <input v-model.number="selectedItemFilterGroup.volume" type="range" min="0" max="100" />
            </label>
            <label class="settings-row">
              <span>Cooldown</span>
              <div class="number-setting">
                <input v-model.number="selectedItemFilterGroup.cooldownMs" type="number" min="0" max="30000" step="100" />
                <small>ms</small>
              </div>
            </label>
          </div>

          <div class="item-filter-rule-section">
            <div class="item-filter-rule-heading">
              <strong>Rarities</strong>
              <span>Empty means any rarity.</span>
            </div>
            <div class="item-filter-chip-grid">
              <label v-for="rarity in ITEM_FILTER_RARITIES" :key="rarity" class="filter-box">
                <input :checked="selectedItemFilterGroup.rarities.includes(rarity)" type="checkbox" @change="toggleFilterRarity(selectedItemFilterGroup, rarity, eventChecked($event))" />
                <span>{{ rarity }}</span>
              </label>
            </div>
          </div>

          <div class="item-filter-rule-section">
            <div class="item-filter-rule-heading">
              <strong>Item types</strong>
              <span>Empty means any type.</span>
            </div>
            <div class="item-filter-type-grid">
              <label v-for="option in itemTypeOptions" :key="option.value" class="filter-box">
                <input :checked="selectedItemFilterGroup.types.includes(Number(option.value))" type="checkbox" @change="toggleFilterType(selectedItemFilterGroup, Number(option.value), eventChecked($event))" />
                <span>{{ option.label }}</span>
              </label>
            </div>
          </div>

          <div class="item-filter-rule-section">
            <div class="item-filter-rule-heading">
              <strong>Watched items</strong>
              <span>Search known item names. Exact matches can override the group sound.</span>
            </div>
            <div class="item-filter-search-wrap">
              <form class="item-filter-add-item" @submit.prevent="$emit('addItemToGroup', selectedItemFilterGroup)">
                <input v-model="itemDraftModel" type="search" placeholder="Search item name" autocomplete="off" spellcheck="false" />
                <button class="icon-button primary" type="submit">Add</button>
              </form>
              <div v-if="itemFilterDraftItem.trim().length >= 3 && itemFilterSuggestions.length" class="item-filter-suggestions">
                <button v-for="name in itemFilterSuggestions" :key="name" type="button" @click="$emit('addItemToGroup', selectedItemFilterGroup, name)">
                  {{ name }}
                </button>
              </div>
              <p v-else-if="itemFilterDraftItem.trim().length > 0 && itemFilterDraftItem.trim().length < 3" class="item-filter-search-hint">Type at least 3 characters for suggestions.</p>
              <p v-else-if="itemFilterDraftItem.trim().length >= 3" class="item-filter-search-hint">No matching known items.</p>
            </div>
            <div v-if="selectedItemFilterGroupedItems.length" class="item-filter-specific-list">
              <section v-for="itemGroup in selectedItemFilterGroupedItems" :key="itemGroup.typeLabel" class="item-filter-specific-type">
                <h4>{{ itemGroup.typeLabel }}</h4>
                <div v-for="item in itemGroup.items" :key="`${itemGroup.typeLabel}-${item.name}`" class="item-filter-specific-row">
                  <span>{{ item.name }}</span>
                  <div class="sound-picker">
                    <select v-model="item.soundId">
                      <option value="">Group sound</option>
                      <option v-for="sound in ITEM_FILTER_SOUNDS" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
                    </select>
                    <button class="sound-test-button" type="button" @click="$emit('testSound', item.soundId || selectedItemFilterGroup.soundId, selectedItemFilterGroup.volume)" title="Play sound" :aria-label="`Play sound for ${item.name}`">Play</button>
                  </div>
                  <button class="shopping-remove" type="button" @click="$emit('removeItemFromGroup', selectedItemFilterGroup, item)" :aria-label="`Remove ${item.name}`">×</button>
                </div>
              </section>
            </div>
            <p v-else class="empty-copy">Add exact item names for high-priority watched drops.</p>
          </div>
        </section>
        <p v-else class="empty-copy">Add a group to start building an item filter.</p>
      </div>
    </article>
  </section>
</template>
