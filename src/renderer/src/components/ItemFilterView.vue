<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ItemFilterGroupCard from "./ItemFilterGroupCard.vue";
import ItemFilterPackActions from "./ItemFilterPackActions.vue";
import ItemFilterSoundLibrary from "./ItemFilterSoundLibrary.vue";
import {
  type CustomItemFilterSound,
  type ItemFilterGroup,
  type ItemFilterPackImportPreview,
  type ItemFilterSoundOption,
  type ItemFilterSpecificItem,
} from "../lib/item-filters";
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
  customItemFilterSounds?: CustomItemFilterSound[];
  selectedItemFilterGroup: ItemFilterGroup | null;
  selectedItemFilterGroupedItems?: Array<{ typeLabel: string; items: ItemFilterSpecificItem[] }>;
  itemFilterDraftGroupName: string;
  itemFilterDraftItem: string;
  itemFilterSuggestions: string[];
  itemTypeOptions: ItemTypeOption[];
  itemFilterMuted: boolean;
  pendingItemFilterPackImport?: ItemFilterPackImportPreview | null;
  itemFilterPackImportBusy?: boolean;
}>(), {
  recoverableCompactFilterGroups: () => [],
  customItemFilterSounds: () => [],
  selectedItemFilterGroupedItems: () => [],
  pendingItemFilterPackImport: null,
  itemFilterPackImportBusy: false,
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
  importSounds: [];
  exportSoundpack: [];
  removeSound: [sound: CustomItemFilterSound];
  importFilterPack: [];
  exportFilterPack: [];
  confirmFilterPackImport: [];
  cancelFilterPackImport: [];
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

const expandedGroupId = ref(props.selectedItemFilterGroup?.id ?? props.itemFilterGroups[0]?.id ?? "");
const soundLibraryOpen = ref(false);
const groupPendingRemoval = ref<ItemFilterGroup | null>(null);
const removeGroupDialog = ref<HTMLElement | null>(null);
const {
  openModalFocus: openRemoveGroupDialogFocus,
  closeModalFocus: closeRemoveGroupDialogFocus,
  handleModalFocusKeydown: handleRemoveGroupDialogKeydown,
} = useModalFocus(removeGroupDialog, { manual: true });

const enabledGroupCount = computed(() => props.itemFilterGroups.filter((group) => group.enabled).length);
const watchedItemCount = computed(() => props.itemFilterGroups.reduce((total, group) => total + group.items.length, 0));
const pendingRemovalSummary = computed(() => {
  const group = groupPendingRemoval.value;
  if (!group) return "";
  const parts = [
    group.items.length ? `${group.items.length} watched item${group.items.length === 1 ? "" : "s"}` : "",
    group.rarities.length ? `${group.rarities.length} rarit${group.rarities.length === 1 ? "y" : "ies"}` : "",
    group.types.length ? `${group.types.length} item type${group.types.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No rules configured";
});

watch(
  () => props.selectedItemFilterGroup?.id,
  (nextId, previousId) => {
    if (nextId && nextId !== previousId) expandedGroupId.value = nextId;
  },
);

watch(
  () => props.itemFilterGroups.map((group) => group.id).join("\n"),
  () => {
    if (groupPendingRemoval.value && !props.itemFilterGroups.some((group) => group.id === groupPendingRemoval.value?.id)) {
      groupPendingRemoval.value = null;
    }
    if (expandedGroupId.value && !props.itemFilterGroups.some((group) => group.id === expandedGroupId.value)) {
      expandedGroupId.value = props.selectedItemFilterGroup?.id ?? props.itemFilterGroups[0]?.id ?? "";
    }
  },
);

function toggleGroup(group: ItemFilterGroup) {
  if (expandedGroupId.value === group.id) {
    expandedGroupId.value = "";
    return;
  }
  expandedGroupId.value = group.id;
  emit("selectGroup", group);
}

function forwardAddItem(group: ItemFilterGroup, value?: string) {
  emit("addItemToGroup", group, value);
}

function forwardRemoveItem(group: ItemFilterGroup, item: ItemFilterSpecificItem) {
  emit("removeItemFromGroup", group, item);
}

function forwardTestSound(soundId?: string, volume?: number) {
  emit("testSound", soundId, volume);
}

function requestRemoveGroup(group: ItemFilterGroup, event: MouseEvent) {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
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
</script>

<template>
  <section class="item-filter-view">
    <article class="panel item-filter-page">
      <div class="panel-heading item-filter-page-heading">
        <div>
          <p class="eyebrow">Loot alerts</p>
          <h2>Item Filters <span class="info-bubble" data-tip="Alerts are driven by captured network traffic and can arrive a couple seconds after the item appears in game.">i</span></h2>
          <p>{{ enabledGroupCount }} of {{ itemFilterGroups.length }} groups active · {{ watchedItemCount }} exact items watched</p>
        </div>
      </div>

      <section :class="['item-filter-master-control', { muted: mutedModel }]" aria-live="polite">
        <span class="item-filter-master-status" aria-hidden="true"></span>
        <div>
          <strong>{{ mutedModel ? "Loot alerts are muted" : "Loot alerts are active" }}</strong>
          <small>{{ mutedModel ? "Filters continue matching, but no alert sounds play." : "All enabled filter groups can play their configured sounds." }}</small>
        </div>
        <div class="item-filter-actions">
          <button class="icon-button ghost" type="button" @click="$emit('testSound')">Test selected</button>
          <button :class="['icon-button', mutedModel ? 'primary' : 'danger']" type="button" @click="mutedModel = !mutedModel">{{ mutedModel ? "Unmute all" : "Mute all" }}</button>
        </div>
      </section>

      <ItemFilterPackActions
        :group-count="itemFilterGroups.length"
        :pending-import="pendingItemFilterPackImport"
        :import-busy="itemFilterPackImportBusy"
        @import-pack="emit('importFilterPack')"
        @export-pack="emit('exportFilterPack')"
        @confirm-import="emit('confirmFilterPackImport')"
        @cancel-import="emit('cancelFilterPackImport')"
      />

      <ItemFilterSoundLibrary
        :open="soundLibraryOpen"
        :sounds="itemFilterSounds"
        :custom-sounds="customItemFilterSounds"
        :groups="itemFilterGroups"
        @toggle="soundLibraryOpen = !soundLibraryOpen"
        @import-sounds="emit('importSounds')"
        @export-soundpack="emit('exportSoundpack')"
        @remove-sound="emit('removeSound', $event)"
        @test-sound="forwardTestSound"
      />

      <section class="filter-stack-shell" aria-labelledby="filter-stack-title">
        <div class="filter-stack-heading">
          <div>
            <p class="eyebrow">Filter Stack</p>
            <h3 id="filter-stack-title">Alert groups</h3>
            <small>Groups are checked from top to bottom. Exact watched items win before broader rarity and type rules.</small>
          </div>
          <form class="item-filter-add-group" @submit.prevent="emit('addGroup')">
            <input v-model="groupNameModel" type="text" placeholder="New group name" spellcheck="false" aria-label="New filter group name" />
            <button class="icon-button primary" type="submit">Add group</button>
          </form>
        </div>

        <section v-if="recoverableCompactFilterGroups.length" class="item-filter-recovery-panel">
          <div class="item-filter-rule-heading">
            <div>
              <strong>Missing Compact groups</strong>
              <small>Restore groups still referenced by Compact Mode tiles.</small>
            </div>
            <span>{{ recoverableCompactFilterGroups.length }}</span>
          </div>
          <div class="item-filter-recovery-actions">
            <button v-for="group in recoverableCompactFilterGroups" :key="group.id" class="icon-button ghost" type="button" @click="emit('restoreMissingGroup', group)">
              Restore {{ group.name }} · {{ group.tileCount }} tile{{ group.tileCount === 1 ? "" : "s" }}
            </button>
          </div>
        </section>

        <div v-if="itemFilterGroups.length" class="filter-stack-list">
          <ItemFilterGroupCard
            v-for="group in itemFilterGroups"
            :key="group.id"
            :group="group"
            :open="expandedGroupId === group.id"
            :sounds="itemFilterSounds"
            :item-type-options="itemTypeOptions"
            :draft-item="expandedGroupId === group.id ? itemDraftModel : ''"
            :suggestions="expandedGroupId === group.id ? itemFilterSuggestions : []"
            @toggle="toggleGroup"
            @update-group="emit('updateGroup', $event)"
            @request-remove="requestRemoveGroup"
            @update:draft-item="itemDraftModel = $event"
            @add-item="forwardAddItem"
            @remove-item="forwardRemoveItem"
            @test-sound="forwardTestSound"
          />
        </div>
        <p v-else class="empty-copy">Add a group to start building an item filter.</p>
      </section>
    </article>

    <div v-if="groupPendingRemoval" class="modal-backdrop" @click.self="cancelRemoveGroup" @keydown="handleRemoveGroupDialogKeydown" @keydown.esc="cancelRemoveGroup">
      <section ref="removeGroupDialog" class="settings-panel item-filter-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-filter-group-title" tabindex="-1">
        <div class="settings-heading">
          <div>
            <p class="eyebrow">Confirm remove</p>
            <h2 id="remove-filter-group-title">Remove “{{ groupPendingRemoval.name }}”?</h2>
          </div>
          <button class="settings-close" type="button" aria-label="Cancel remove group" @click="cancelRemoveGroup">×</button>
        </div>
        <div class="item-filter-confirm-body">
          <strong>{{ pendingRemovalSummary }}</strong>
          <p>This removes the group from loot alerts. Compact tiles tied to it stop counting unless the group is restored or reassigned.</p>
        </div>
        <div class="settings-actions item-filter-confirm-actions">
          <button class="icon-button ghost" type="button" @click="cancelRemoveGroup">Cancel</button>
          <button class="icon-button danger item-filter-confirm-remove" type="button" @click="confirmRemoveGroup">Remove group</button>
        </div>
      </section>
    </div>
  </section>
</template>
