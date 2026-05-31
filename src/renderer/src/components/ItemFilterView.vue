<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ITEM_FILTER_RARITIES,
  resolveItemFilterSound,
  toggledNumberList,
  toggledStringList,
  type ItemFilterGroup,
  type ItemFilterSoundOption,
  type ItemFilterSpecificItem,
} from "../lib/item-filters";
import { eventChecked, eventValue } from "../lib/dom-events";
import {
  isKnownMissingIconResearchEntry,
  isKnownItemResearchName,
  itemResearchClassificationLabel,
  type ItemResearchEntry,
  type ItemResearchExportScope,
} from "../lib/item-research";
import { useModalFocus } from "../lib/modal-focus";

interface ItemTypeOption {
  value: string;
  label: string;
}

interface CompactFilterGroupRecoveryOption {
  id: string;
  name: string;
  tileCount: number;
}

const props = withDefaults(defineProps<{
  itemFilterGroups: ItemFilterGroup[];
  recoverableCompactFilterGroups?: CompactFilterGroupRecoveryOption[];
  itemFilterSounds: ItemFilterSoundOption[];
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
}>(), {
  recoverableCompactFilterGroups: () => [],
});

const emit = defineEmits<{
  "update:itemFilterMuted": [value: boolean];
  "update:itemFilterDraftGroupName": [value: string];
  "update:itemFilterDraftItem": [value: string];
  addGroup: [];
  selectGroup: [group: ItemFilterGroup];
  updateGroup: [group: ItemFilterGroup];
  removeGroup: [group: ItemFilterGroup];
  restoreMissingGroup: [group: CompactFilterGroupRecoveryOption];
  addItemToGroup: [group: ItemFilterGroup, value?: string];
  removeItemFromGroup: [group: ItemFilterGroup, item: ItemFilterSpecificItem];
  testSound: [soundId?: string, volume?: number];
  exportItemResearch: [scope?: ItemResearchExportScope];
  saveItemResearchEntry: [signature: string, value: { resolvedName: string; notes: string }];
  ignoreItemResearchEntry: [signature: string];
  resetItemResearchEntry: [signature: string];
  clearResolvedItemResearchEntries: [];
  clearIgnoredItemResearchEntries: [];
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

const itemResearchOpen = ref(props.unresolvedItemResearchCount > 0);
const groupPendingRemoval = ref<ItemFilterGroup | null>(null);
const removeGroupDialog = ref<HTMLElement | null>(null);
const {
  openModalFocus: openRemoveGroupDialogFocus,
  closeModalFocus: closeRemoveGroupDialogFocus,
  handleModalFocusKeydown: handleRemoveGroupDialogKeydown,
} = useModalFocus(removeGroupDialog, { manual: true });
interface ItemResearchDraft {
  resolvedName: string;
  notes: string;
  baseResolvedName: string;
  baseNotes: string;
  baseIgnored: boolean;
}

type ItemResearchStatusFilter = "all" | "unresolved" | "missing-icon" | "resolved" | "ignored";

const itemResearchDrafts = ref<Record<string, ItemResearchDraft>>({});
const itemResearchStatusFilter = ref<ItemResearchStatusFilter>("all");
const itemResearchTypeFilter = ref("all");
const itemResearchRarityFilter = ref("all");
const itemResearchStatusOptions: Array<{ value: ItemResearchStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unresolved", label: "Unresolved" },
  { value: "missing-icon", label: "App Icon Missing" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];
const pendingRemovalSummary = computed(() => {
  const group = groupPendingRemoval.value;
  if (!group) return "";
  const parts = [
    group.items.length ? `${group.items.length} watched item${group.items.length === 1 ? "" : "s"}` : "",
    group.rarities.length ? `${group.rarities.length} rarit${group.rarities.length === 1 ? "y" : "ies"}` : "",
    group.types.length ? `${group.types.length} item type${group.types.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "No rules configured";
});
const selectedGroupSoundResolution = computed(() =>
  props.selectedItemFilterGroup ? resolveItemFilterSound(props.selectedItemFilterGroup.soundId, props.itemFilterSounds) : null,
);
const unresolvedResearchTaskCount = computed(() => props.itemResearchEntries.filter((entry) => entryMatchesResearchStatus(entry, "unresolved")).length);
const missingIconResearchCount = computed(() => props.itemResearchEntries.filter((entry) => entryMatchesResearchStatus(entry, "missing-icon")).length);
const itemResearchSummary = computed(() => {
  const parts = [`${unresolvedResearchTaskCount.value} need naming`];
  if (missingIconResearchCount.value) parts.push(`${missingIconResearchCount.value} app icon backlog`);
  parts.push("developer notebook");
  return parts.join(" \u00b7 ");
});
const resolvedItemResearchCount = computed(() => props.itemResearchEntries.filter((entry) => entryMatchesResearchStatus(entry, "resolved")).length);
const ignoredItemResearchCount = computed(() => props.itemResearchEntries.filter((entry) => entry.ignored).length);
const filteredItemResearchEntries = computed(() =>
  props.itemResearchEntries.filter((entry) =>
    entryMatchesResearchStatus(entry, itemResearchStatusFilter.value) &&
    (itemResearchTypeFilter.value === "all" || String(entry.type) === itemResearchTypeFilter.value) &&
    (itemResearchRarityFilter.value === "all" || entry.rarity === itemResearchRarityFilter.value),
  ),
);
const itemResearchTypeFilterOptions = computed(() =>
  Array.from(new Set(props.itemResearchEntries.map((entry) => entry.type)))
    .sort((left, right) => entryTypeLabelValue(left).localeCompare(entryTypeLabelValue(right)))
    .map((type) => ({ value: String(type), label: entryTypeLabelValue(type) })),
);
const itemResearchRarityFilterOptions = computed(() =>
  Array.from(new Set(props.itemResearchEntries.map((entry) => entry.rarity).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
);

watch(unresolvedResearchTaskCount, (unresolvedCount) => {
  if (unresolvedCount > 0) itemResearchOpen.value = true;
});

watch(
  () => props.itemFilterGroups.map((group) => group.id).join("\n"),
  () => {
    if (groupPendingRemoval.value && !props.itemFilterGroups.some((group) => group.id === groupPendingRemoval.value?.id)) {
      groupPendingRemoval.value = null;
    }
  },
);

watch(
  () => props.itemResearchEntries.map((entry) => `${entry.signature}\0${entry.resolvedName}\0${entry.notes}\0${entry.ignored}`).join("\n"),
  () => {
    const entriesBySignature = new Map(props.itemResearchEntries.map((entry) => [entry.signature, entry]));
    const nextDrafts = { ...itemResearchDrafts.value };
    let changed = false;
    for (const [signature, draft] of Object.entries(nextDrafts)) {
      const entry = entriesBySignature.get(signature);
      const parentChanged = !entry || entry.resolvedName !== draft.baseResolvedName || entry.notes !== draft.baseNotes || entry.ignored !== draft.baseIgnored;
      if (parentChanged) {
        delete nextDrafts[signature];
        changed = true;
      }
    }
    if (changed) itemResearchDrafts.value = nextDrafts;
  },
);

function requestRemoveGroup(group: ItemFilterGroup, event?: MouseEvent) {
  if (event?.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  groupPendingRemoval.value = group;
  openRemoveGroupDialogFocus();
}

function cancelRemoveGroup() {
  groupPendingRemoval.value = null;
  closeRemoveGroupDialogFocus();
}

function confirmRemoveGroup() {
  if (!groupPendingRemoval.value) return;
  emit("removeGroup", groupPendingRemoval.value);
  groupPendingRemoval.value = null;
  closeRemoveGroupDialogFocus();
}

function updateSelectedGroup(patch: Partial<ItemFilterGroup>) {
  if (!props.selectedItemFilterGroup) return;
  emit("updateGroup", { ...props.selectedItemFilterGroup, ...patch });
}

function updateSelectedGroupNumber(field: "volume" | "cooldownMs", event: Event) {
  const value = Number(eventValue(event));
  if (!Number.isFinite(value)) return;
  updateSelectedGroup({ [field]: value } as Partial<ItemFilterGroup>);
}

function toggleSelectedGroupRarity(rarity: string, enabled: boolean) {
  const group = props.selectedItemFilterGroup;
  if (!group) return;
  updateSelectedGroup({ rarities: toggledStringList(group.rarities, rarity, enabled) });
}

function toggleSelectedGroupType(type: number, enabled: boolean) {
  const group = props.selectedItemFilterGroup;
  if (!group) return;
  updateSelectedGroup({ types: toggledNumberList(group.types, type, enabled) });
}

function updateSpecificItemSound(item: ItemFilterSpecificItem, soundId: string) {
  const group = props.selectedItemFilterGroup;
  if (!group) return;
  updateSelectedGroup({
    items: group.items.map((candidate) => (candidate.name === item.name ? { ...candidate, soundId } : candidate)),
  });
}

function researchDraft(entry: ItemResearchEntry): { resolvedName: string; notes: string } {
  const draft = itemResearchDrafts.value[entry.signature];
  return draft ? { resolvedName: draft.resolvedName, notes: draft.notes } : { resolvedName: entry.resolvedName, notes: entry.notes };
}

function updateResearchDraft(entry: ItemResearchEntry, patch: Partial<{ resolvedName: string; notes: string }>) {
  const current = itemResearchDrafts.value[entry.signature] ?? {
    resolvedName: entry.resolvedName,
    notes: entry.notes,
    baseResolvedName: entry.resolvedName,
    baseNotes: entry.notes,
    baseIgnored: entry.ignored,
  };
  itemResearchDrafts.value = {
    ...itemResearchDrafts.value,
    [entry.signature]: { ...current, ...patch },
  };
}

function saveResearchEntry(entry: ItemResearchEntry) {
  const draft = researchDraft(entry);
  emit("saveItemResearchEntry", entry.signature, {
    resolvedName: isKnownMissingIconEntry(entry) ? "" : draft.resolvedName,
    notes: draft.notes,
  });
}

function resetResearchEntry(entry: ItemResearchEntry) {
  clearResearchDraft(entry.signature);
  emit("resetItemResearchEntry", entry.signature);
}

function clearResearchDraft(signature: string) {
  if (!(signature in itemResearchDrafts.value)) return;
  const nextDrafts = { ...itemResearchDrafts.value };
  delete nextDrafts[signature];
  itemResearchDrafts.value = nextDrafts;
}

function entryTypeLabel(entry: ItemResearchEntry): string {
  return entryTypeLabelValue(entry.type);
}

function entryTypeLabelValue(type: number): string {
  return props.itemTypeOptions.find((option) => Number(option.value) === type)?.label ?? `Type ${type}`;
}

function researchClassificationLabel(entry: ItemResearchEntry): string {
  return itemResearchClassificationLabel(entry.classification);
}

function entryMatchesResearchStatus(entry: ItemResearchEntry, status: ItemResearchStatusFilter): boolean {
  const missingIcon = isKnownMissingIconEntry(entry);
  if (status === "ignored") return entry.ignored;
  if (status === "missing-icon") return !entry.ignored && missingIcon;
  if (status === "resolved") return !entry.ignored && !missingIcon && Boolean(entry.resolvedName.trim());
  if (status === "unresolved") return !entry.ignored && !missingIcon && !entry.resolvedName.trim();
  return true;
}

function isKnownMissingIconEntry(entry: ItemResearchEntry): boolean {
  return isKnownMissingIconResearchEntry(entry);
}

function wikiItemPageUrl(entry: ItemResearchEntry): string {
  return `https://herosiege.wiki.gg/wiki/${encodeURIComponent(entry.label.trim().replace(/\s+/g, "_"))}`;
}

function canResetResearchEntry(entry: ItemResearchEntry): boolean {
  const draft = researchDraft(entry);
  return entry.ignored || Boolean(draft.resolvedName.trim() || draft.notes.trim());
}

function hasUnknownResolvedName(entry: ItemResearchEntry): boolean {
  const resolvedName = researchDraft(entry).resolvedName.trim();
  return Boolean(resolvedName && !isKnownItemResearchName(resolvedName));
}

function formatSeen(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function soundSummary(soundId: string): string {
  const resolution = resolveItemFilterSound(soundId, props.itemFilterSounds);
  return resolution.missingCustomSound ? `${resolution.name} - uses ${resolution.fallbackName}` : resolution.name;
}

function missingCustomSound(soundId: string): boolean {
  return resolveItemFilterSound(soundId, props.itemFilterSounds).missingCustomSound;
}

function fallbackSoundName(soundId: string): string {
  return resolveItemFilterSound(soundId, props.itemFilterSounds).fallbackName;
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
            <span>{{ itemResearchSummary }}</span>
          </div>
          <div class="item-research-heading-actions">
            <button class="icon-button ghost" type="button" @click="itemResearchOpen = !itemResearchOpen">{{ itemResearchOpen ? "Hide Research" : "Show Research" }}</button>
            <button class="icon-button ghost" type="button" @click="$emit('exportItemResearch')">Export Research JSON</button>
          </div>
        </div>
        <template v-if="itemResearchOpen">
          <p class="item-research-share">
            Unknown drops need names. Known items with missing app icons are maintainer asset backlog, not player research. Share exported research as a
            <a href="https://gist.github.com/" target="_blank" rel="noreferrer">GitHub Gist</a>
            with sarevok9 on Reddit or Snyne on the Hero Siege Discord.
          </p>
          <template v-if="itemResearchEntries.length">
            <div class="item-research-toolbar">
              <label>
                <span>Status</span>
                <select v-model="itemResearchStatusFilter">
                  <option v-for="option in itemResearchStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>Type</span>
                <select v-model="itemResearchTypeFilter">
                  <option value="all">All types</option>
                  <option v-for="option in itemResearchTypeFilterOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>Rarity</span>
                <select v-model="itemResearchRarityFilter">
                  <option value="all">All rarities</option>
                  <option v-for="rarity in itemResearchRarityFilterOptions" :key="rarity" :value="rarity">{{ rarity }}</option>
                </select>
              </label>
              <div class="item-research-batch-actions">
                <button class="icon-button ghost" type="button" @click="$emit('exportItemResearch', 'resolved')">Export Resolved</button>
                <button class="icon-button ghost" type="button" @click="$emit('exportItemResearch', 'unresolved')">Export Unresolved</button>
                <button v-if="resolvedItemResearchCount" class="icon-button ghost" type="button" @click="$emit('clearResolvedItemResearchEntries')">Clear Resolved</button>
                <button v-if="ignoredItemResearchCount" class="icon-button ghost" type="button" @click="$emit('clearIgnoredItemResearchEntries')">Clear Ignored</button>
              </div>
            </div>
            <div v-if="filteredItemResearchEntries.length" class="item-research-list">
              <article v-for="entry in filteredItemResearchEntries" :key="entry.signature" :class="['item-research-row', { resolved: entry.resolvedName && !isKnownMissingIconEntry(entry), ignored: entry.ignored, 'missing-icon': isKnownMissingIconEntry(entry) }]">
                <div class="item-research-meta">
                  <strong>{{ researchDraft(entry).resolvedName || entry.label }}</strong>
                  <div class="item-research-details">
                    <span class="item-research-classification">{{ researchClassificationLabel(entry) }}</span>
                    <span class="item-research-stats">{{ entry.rarity }} &middot; {{ entryTypeLabel(entry) }} #{{ entry.id }} &middot; Q{{ entry.dropQuality }} &middot; {{ entry.count }} seen &middot; {{ formatSeen(entry.lastSeenAt) }}</span>
                  </div>
                </div>
                <div v-if="isKnownMissingIconEntry(entry)" class="item-research-field item-research-missing-icon-note">
                  <span>App icon missing</span>
                  <small>No player action needed; included in maintainer exports.</small>
                  <a :href="wikiItemPageUrl(entry)" target="_blank" rel="noreferrer">Wiki</a>
                </div>
                <div v-else class="item-research-field">
                  <input :value="researchDraft(entry).resolvedName" type="text" placeholder="Actual item name" spellcheck="false" @input="updateResearchDraft(entry, { resolvedName: eventValue($event) })" />
                  <small v-if="hasUnknownResolvedName(entry)">Name is not in known item options.</small>
                </div>
                <input v-if="!isKnownMissingIconEntry(entry)" :value="researchDraft(entry).notes" type="text" placeholder="Notes" spellcheck="false" @input="updateResearchDraft(entry, { notes: eventValue($event) })" />
                <div v-if="!isKnownMissingIconEntry(entry)" class="item-research-actions">
                  <button class="sound-test-button" type="button" @click="saveResearchEntry(entry)">Save</button>
                  <button v-if="canResetResearchEntry(entry)" class="sound-test-button" type="button" @click="resetResearchEntry(entry)">Reset</button>
                  <button v-else class="shopping-remove" type="button" @click="$emit('ignoreItemResearchEntry', entry.signature)" :aria-label="`Ignore ${entry.label}`">x</button>
                </div>
                <div v-else class="item-research-actions">
                  <button class="sound-test-button" type="button" @click="$emit('ignoreItemResearchEntry', entry.signature)">Dismiss</button>
                </div>
              </article>
            </div>
            <p v-else class="empty-copy">No research entries match the current filters.</p>
          </template>
          <p v-else class="empty-copy">Item signatures will appear here after developer item research is enabled.</p>
        </template>
      </section>

      <div class="item-filter-layout">
        <aside class="item-filter-group-sidebar" aria-label="Item filter groups">
          <form class="item-filter-add-group" @submit.prevent="$emit('addGroup')">
            <input v-model="groupNameModel" type="text" placeholder="New group" spellcheck="false" />
            <button class="icon-button primary" type="submit">Add</button>
          </form>
          <div v-if="recoverableCompactFilterGroups.length" class="item-filter-recovery-panel">
            <div class="item-filter-rule-heading">
              <strong>Missing Compact Groups</strong>
              <span>{{ recoverableCompactFilterGroups.length }}</span>
            </div>
            <button v-for="group in recoverableCompactFilterGroups" :key="group.id" class="icon-button ghost" type="button" @click="emit('restoreMissingGroup', group)">
              Restore {{ group.name }}
            </button>
          </div>
          <div class="item-filter-group-list">
            <button
              v-for="group in itemFilterGroups"
              :key="group.id"
              type="button"
              :class="['item-filter-group-button', { active: selectedItemFilterGroup?.id === group.id, disabled: !group.enabled, 'missing-sound': missingCustomSound(group.soundId) }]"
              @click="$emit('selectGroup', group)"
            >
              <strong>{{ group.name }}</strong>
              <span>{{ group.enabled ? "Enabled" : "Disabled" }} &middot; {{ soundSummary(group.soundId) }}</span>
            </button>
          </div>
        </aside>

        <section v-if="selectedItemFilterGroup" class="item-filter-editor">
          <div class="item-filter-editor-head">
            <label class="settings-check">
              <input :checked="selectedItemFilterGroup.enabled" type="checkbox" @change="updateSelectedGroup({ enabled: eventChecked($event) })" />
              <span>Enabled</span>
            </label>
            <button class="icon-button ghost" type="button" @click="requestRemoveGroup(selectedItemFilterGroup, $event)">Remove Group</button>
          </div>

          <div class="item-filter-editor-grid">
            <label class="settings-row">
              <span>Group name</span>
              <input :value="selectedItemFilterGroup.name" type="text" spellcheck="false" @input="updateSelectedGroup({ name: eventValue($event) })" />
            </label>
            <label class="settings-row">
              <span>Sound</span>
              <div class="sound-picker">
                <select :value="selectedItemFilterGroup.soundId" @change="updateSelectedGroup({ soundId: eventValue($event) })">
                  <option v-if="selectedGroupSoundResolution?.missingCustomSound" :value="selectedItemFilterGroup.soundId" disabled>Missing custom sound</option>
                  <option v-for="sound in itemFilterSounds" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
                </select>
                <button class="sound-test-button" type="button" @click="$emit('testSound', selectedItemFilterGroup.soundId, selectedItemFilterGroup.volume)" title="Play sound" aria-label="Play selected group sound">Play</button>
              </div>
              <small v-if="selectedGroupSoundResolution?.missingCustomSound" class="item-filter-sound-warning">
                Missing custom sound. Alerts use {{ selectedGroupSoundResolution.fallbackName }} until another sound is selected or the sound is re-imported.
              </small>
            </label>
            <label class="settings-row">
              <span>Volume</span>
              <input :value="selectedItemFilterGroup.volume" type="range" min="0" max="100" @input="updateSelectedGroupNumber('volume', $event)" />
            </label>
            <label class="settings-row">
              <span>Cooldown</span>
              <div class="number-setting">
                <input :value="selectedItemFilterGroup.cooldownMs" type="number" min="0" max="30000" step="100" @input="updateSelectedGroupNumber('cooldownMs', $event)" />
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
                <input :checked="selectedItemFilterGroup.rarities.includes(rarity)" type="checkbox" @change="toggleSelectedGroupRarity(rarity, eventChecked($event))" />
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
                <input :checked="selectedItemFilterGroup.types.includes(Number(option.value))" type="checkbox" @change="toggleSelectedGroupType(Number(option.value), eventChecked($event))" />
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
                  <div class="sound-picker-stack">
                    <div class="sound-picker">
                      <select :value="item.soundId" @change="updateSpecificItemSound(item, eventValue($event))">
                        <option value="">Group sound</option>
                        <option v-if="missingCustomSound(item.soundId)" :value="item.soundId" disabled>Missing custom sound</option>
                        <option v-for="sound in itemFilterSounds" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
                      </select>
                      <button class="sound-test-button" type="button" @click="$emit('testSound', item.soundId || selectedItemFilterGroup.soundId, selectedItemFilterGroup.volume)" title="Play sound" :aria-label="`Play sound for ${item.name}`">Play</button>
                    </div>
                    <small v-if="missingCustomSound(item.soundId)" class="item-filter-sound-warning item-filter-specific-warning">Uses {{ fallbackSoundName(item.soundId) }} until another sound is selected.</small>
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
    <div v-if="groupPendingRemoval" class="modal-backdrop" @click.self="cancelRemoveGroup" @keydown="handleRemoveGroupDialogKeydown" @keydown.esc="cancelRemoveGroup">
      <section ref="removeGroupDialog" class="settings-panel item-filter-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-filter-group-title" tabindex="-1">
        <div class="settings-heading">
          <div>
            <p class="eyebrow">Confirm Remove</p>
            <h2 id="remove-filter-group-title">Remove "{{ groupPendingRemoval.name }}"?</h2>
          </div>
          <button class="settings-close" type="button" aria-label="Cancel remove group" @click="cancelRemoveGroup">x</button>
        </div>
        <div class="item-filter-confirm-body">
          <strong>{{ pendingRemovalSummary }}</strong>
          <p>This removes the group from loot alerts. Compact tiles tied to it will stop counting unless the group is restored or reassigned.</p>
        </div>
        <div class="settings-actions item-filter-confirm-actions">
          <button class="icon-button ghost" type="button" @click="cancelRemoveGroup">Cancel</button>
          <button class="icon-button danger item-filter-confirm-remove" type="button" @click="confirmRemoveGroup">Remove Group</button>
        </div>
      </section>
    </div>
  </section>
</template>
