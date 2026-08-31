<script setup lang="ts">
import { computed, ref } from "vue";
import { ITEM_FILTER_SUGGESTION_LIMIT, itemTypeLabelForName, type ItemFilterGroup } from "../lib/item-filters";
import { ITEM_TYPE_OPTIONS, shoppingAutocompleteNames } from "../lib/item-options";
import { TRACKED_RARITY_ORDER } from "../lib/past-runs";
import { eventChecked, eventValue } from "../lib/dom-events";
import { useModalFocus } from "../lib/modal-focus";
import {
  POST_RUN_REPORT_PRESETS,
  clonePostRunReportConfig,
  createReportItemGroup,
  defaultPostRunReportConfig,
  hasMeaningfulPostRunReportGroups,
  isDefaultPostRunReportConfig,
  REPORT_METRIC_OPTIONS,
  REPORT_SUMMARY_ITEM_LIMIT,
  REPORT_TOP_DROP_LIMIT_OPTIONS,
  reportItemFilterGroupItemId,
  reportItemGroupItemId,
  reportMetricItemId,
  reportRarityItemId,
  type PostRunReportConfig,
  type PostRunReportPreset,
  type ReportItemGroup,
  type ReportSummaryItemId,
  withPostRunReportSummaryItems,
} from "../lib/report-config";

const props = defineProps<{
  reportConfig: PostRunReportConfig;
  itemFilterGroups: ItemFilterGroup[];
}>();

const emit = defineEmits<{
  close: [];
  "update:reportConfig": [value: PostRunReportConfig];
}>();

const reportDraftItem = ref("");
const reportDraftGroupName = ref("");
const selectedReportGroupId = ref("");
const reportDialog = ref<HTMLElement | null>(null);
const pendingReportPresetId = ref<string | null>(null);
const { handleModalFocusKeydown } = useModalFocus(reportDialog);

const reportItemGroups = computed(() => props.reportConfig.itemGroups);
const selectedReportGroup = computed(() => reportItemGroups.value.find((group) => group.id === selectedReportGroupId.value) ?? reportItemGroups.value[0] ?? null);
const availableSummaryItemIds = computed(() => new Set(reportSummaryOptions.value.map((option) => option.id)));
const visibleSummaryItems = computed(() => props.reportConfig.summaryItems.filter((itemId) => availableSummaryItemIds.value.has(itemId)));
const selectedSummaryItemSet = computed(() => new Set(visibleSummaryItems.value));
const selectedSummaryItemCount = computed(() => visibleSummaryItems.value.length);
const selectedItemFilterGroupCount = computed(() => props.itemFilterGroups.filter((group) => selectedSummaryItemSet.value.has(reportItemFilterGroupItemId(group.id))).length);
const selectedCustomReportGroupCount = computed(() => reportItemGroups.value.filter((group) => selectedSummaryItemSet.value.has(reportItemGroupItemId(group.id))).length);
const isDefaultReportConfig = computed(() => isDefaultPostRunReportConfig(props.reportConfig));
const reportModeLabel = computed(() => (isDefaultReportConfig.value ? "Default report" : "Custom report"));
const selectedReportGroupedItems = computed(() => groupedReportItems(selectedReportGroup.value));
const reportItemSuggestions = computed(() => {
  const query = reportDraftItem.value.trim().toLowerCase();
  const existing = new Set((selectedReportGroup.value?.items ?? []).map((item) => item.toLowerCase()));
  if (!query) return shoppingAutocompleteNames.filter((name) => !existing.has(name.toLowerCase())).slice(0, ITEM_FILTER_SUGGESTION_LIMIT);
  return shoppingAutocompleteNames
    .filter((name) => !existing.has(name.toLowerCase()) && name.toLowerCase().includes(query))
    .slice(0, ITEM_FILTER_SUGGESTION_LIMIT);
});
const reportGroupHelp = computed(() => {
  if (selectedCustomReportGroupCount.value > 0 || selectedItemFilterGroupCount.value > 0) {
    return "Selected groups are combined. Empty custom group rules include all tracked drops; linked Item Filter groups use their own rules.";
  }
  if (props.reportConfig.dropRarities.length === 0) return "No custom groups or rarity recaps are selected.";
  return "No custom groups selected, so drop recaps use the selected rarity recaps.";
});

const reportMetricOptions = REPORT_METRIC_OPTIONS;
const reportTopDropLimitOptions = REPORT_TOP_DROP_LIMIT_OPTIONS;
const reportPresets = POST_RUN_REPORT_PRESETS;
const itemTypeOptions = ITEM_TYPE_OPTIONS;
const pendingReportPreset = computed(() => reportPresets.find((preset) => preset.id === pendingReportPresetId.value) ?? null);
const reportSummaryOptions = computed(() => [
  ...reportMetricOptions.map((option) => ({
    id: reportMetricItemId(option.id),
    label: option.label,
    detail: "Stat / resource",
  })),
  ...TRACKED_RARITY_ORDER.map((rarity) => ({
    id: reportRarityItemId(rarity),
    label: rarity,
    detail: "Rarity group",
  })),
  ...props.itemFilterGroups.map((group) => ({
    id: reportItemFilterGroupItemId(group.id),
    label: group.name,
    detail: "Item Filter group",
  })),
  ...reportItemGroups.value.map((group) => ({
    id: reportItemGroupItemId(group.id),
    label: group.name,
    detail: "Custom group",
  })),
]);

function updateTopDropLimit(event: Event) {
  const value = Number(eventValue(event));
  emit("update:reportConfig", { ...props.reportConfig, topDropLimit: value });
}

function chooseReportPreset(preset: PostRunReportPreset) {
  if (hasMeaningfulPostRunReportGroups(props.reportConfig)) {
    pendingReportPresetId.value = preset.id;
    return;
  }
  applyReportPreset(preset);
}

function confirmReportPreset() {
  if (!pendingReportPreset.value) return;
  applyReportPreset(pendingReportPreset.value);
}

function cancelReportPreset() {
  pendingReportPresetId.value = null;
}

function applyReportPreset(preset: PostRunReportPreset) {
  emit("update:reportConfig", {
    ...clonePostRunReportConfig(preset.config),
    exactTrackedItems: [...props.reportConfig.exactTrackedItems],
  });
  reportDraftItem.value = "";
  reportDraftGroupName.value = "";
  selectedReportGroupId.value = "";
  pendingReportPresetId.value = null;
}

function resetReportConfig() {
  emit("update:reportConfig", clonePostRunReportConfig(defaultPostRunReportConfig));
  reportDraftItem.value = "";
  reportDraftGroupName.value = "";
  selectedReportGroupId.value = "";
  pendingReportPresetId.value = null;
}

function addReportItemGroup() {
  const group = createReportItemGroup(reportDraftGroupName.value, reportItemGroups.value.length);
  const nextConfig = {
    ...props.reportConfig,
    trackedItems: [],
    itemGroups: [...reportItemGroups.value, group],
  };
  emit("update:reportConfig", withPostRunReportSummaryItems(
    nextConfig,
    withSummaryItem(visibleSummaryItems.value, reportItemGroupItemId(group.id), selectedSummaryItemCount.value < REPORT_SUMMARY_ITEM_LIMIT),
  ));
  selectedReportGroupId.value = group.id;
  reportDraftGroupName.value = "";
  reportDraftItem.value = "";
}

function selectReportItemGroup(group: ReportItemGroup) {
  selectedReportGroupId.value = group.id;
  reportDraftItem.value = "";
}

function removeReportItemGroup(group: ReportItemGroup) {
  const groups = reportItemGroups.value.filter((candidate) => candidate.id !== group.id);
  const nextConfig = {
    ...props.reportConfig,
    trackedItems: [],
    itemGroups: groups,
  };
  emit("update:reportConfig", withPostRunReportSummaryItems(
    nextConfig,
    props.reportConfig.summaryItems.filter((itemId) => itemId !== reportItemGroupItemId(group.id)),
  ));
  if (selectedReportGroupId.value === group.id) selectedReportGroupId.value = groups[0]?.id ?? "";
  reportDraftItem.value = "";
}

function updateReportItemGroup(group: ReportItemGroup, patch: Partial<ReportItemGroup>) {
  const groups = reportItemGroups.value.map((candidate) => (candidate.id === group.id ? { ...candidate, ...patch } : candidate));
  emit("update:reportConfig", { ...props.reportConfig, trackedItems: [], itemGroups: groups });
}

function updateReportGroupName(group: ReportItemGroup, event: Event) {
  updateReportItemGroup(group, { name: eventValue(event) });
}

function toggleReportGroupRarity(group: ReportItemGroup, rarity: string, enabled: boolean) {
  updateReportItemGroup(group, { rarities: toggledList(group.rarities, rarity, enabled) });
}

function toggleReportGroupType(group: ReportItemGroup, type: number, enabled: boolean) {
  updateReportItemGroup(group, { types: toggledNumberList(group.types, type, enabled) });
}

function addTrackedReportItem(group: ReportItemGroup, value = reportDraftItem.value) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const canonical = shoppingAutocompleteNames.find((name) => name.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
  const exists = group.items.some((item) => item.toLowerCase() === canonical.toLowerCase());
  if (!exists) updateReportItemGroup(group, { items: [...group.items, canonical] });
  reportDraftItem.value = "";
}

function removeTrackedReportItem(group: ReportItemGroup, item: string) {
  updateReportItemGroup(group, {
    items: group.items.filter((candidate) => candidate.toLowerCase() !== item.toLowerCase()),
  });
}

function toggledList<T extends string>(values: T[], value: T, enabled: boolean): T[] {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return Array.from(next);
}

function isSummaryItemSelected(itemId: ReportSummaryItemId): boolean {
  return selectedSummaryItemSet.value.has(itemId);
}

function isSummaryItemDisabled(itemId: ReportSummaryItemId): boolean {
  return !isSummaryItemSelected(itemId) && selectedSummaryItemCount.value >= REPORT_SUMMARY_ITEM_LIMIT;
}

function toggleSummaryItem(itemId: ReportSummaryItemId, enabled: boolean): void {
  emit("update:reportConfig", withPostRunReportSummaryItems(props.reportConfig, withSummaryItem(visibleSummaryItems.value, itemId, enabled)));
}

function withSummaryItem(items: ReportSummaryItemId[], itemId: ReportSummaryItemId, enabled: boolean): ReportSummaryItemId[] {
  const next = items.filter((candidate) => candidate !== itemId);
  if (!enabled) return next;
  if (items.includes(itemId)) return items;
  if (next.length >= REPORT_SUMMARY_ITEM_LIMIT) return items;
  return [...next, itemId];
}

function toggledNumberList(values: number[], value: number, enabled: boolean): number[] {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return Array.from(next).sort((a, b) => a - b);
}

function reportGroupCriteriaSummary(group: ReportItemGroup): string {
  const parts = [
    group.rarities.length ? `${group.rarities.length} rarit${group.rarities.length === 1 ? "y" : "ies"}` : "",
    group.types.length ? `${group.types.length} type${group.types.length === 1 ? "" : "s"}` : "",
    group.items.length ? `${group.items.length} item${group.items.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "All tracked drops";
}

function groupedReportItems(group: ReportItemGroup | null): Array<{ typeLabel: string; items: string[] }> {
  if (!group) return [];
  const groups = new Map<string, string[]>();
  for (const item of [...group.items].sort((left, right) => itemTypeLabelForName(left).localeCompare(itemTypeLabelForName(right)) || left.localeCompare(right))) {
    const typeLabel = itemTypeLabelForName(item);
    const items = groups.get(typeLabel) ?? [];
    items.push(item);
    groups.set(typeLabel, items);
  }
  return Array.from(groups.entries()).map(([typeLabel, items]) => ({ typeLabel, items }));
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="$emit('close')" @keydown="handleModalFocusKeydown" @keydown.esc="$emit('close')">
      <section ref="reportDialog" class="settings-panel report-config-modal" role="dialog" aria-modal="true" aria-labelledby="report-config-title" tabindex="-1">
        <div class="settings-heading">
          <div>
            <p class="eyebrow">Past Runs</p>
            <h2 id="report-config-title">Configure Report</h2>
            <p class="settings-note">{{ reportModeLabel }} settings change what appears here without changing saved run data.</p>
          </div>
          <button class="settings-close" type="button" title="Close tracked report settings" aria-label="Close tracked report settings" @click="$emit('close')">x</button>
        </div>

        <div class="report-config-modal-body">
          <section class="item-filter-rule-section report-preset-section">
            <div class="item-filter-rule-heading">
              <strong>Report presets</strong>
              <span>Replace report items, custom groups, and the top-drop limit. Exact tracked items stay.</span>
            </div>
            <div class="report-preset-grid">
              <button v-for="preset in reportPresets" :key="preset.id" class="report-preset-button" type="button" @click="chooseReportPreset(preset)">
                <strong>{{ preset.name }}</strong>
                <span>{{ preset.description }}</span>
              </button>
            </div>
            <div v-if="pendingReportPreset" class="report-preset-confirm" role="alert">
              <span>{{ pendingReportPreset.name }} will replace existing recap groups and linked Item Filter groups.</span>
              <button class="icon-button danger" type="button" @click="confirmReportPreset">Replace</button>
              <button class="icon-button ghost" type="button" @click="cancelReportPreset">Keep Current</button>
            </div>
          </section>

          <section class="item-filter-rule-section report-summary-row-section">
            <div class="item-filter-rule-heading">
              <strong>Report items</strong>
              <span>{{ selectedSummaryItemCount }}/{{ REPORT_SUMMARY_ITEM_LIMIT }} selected</span>
            </div>
            <div class="report-summary-list">
              <label v-for="option in reportSummaryOptions" :key="option.id" class="filter-box report-summary-item-option">
                <input
                  :checked="isSummaryItemSelected(option.id)"
                  :disabled="isSummaryItemDisabled(option.id)"
                  type="checkbox"
                  @change="toggleSummaryItem(option.id, eventChecked($event))"
                />
                <span class="report-summary-item-text">
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.detail }}</small>
                </span>
              </label>
            </div>
          </section>

          <section class="item-filter-rule-section">
            <div class="item-filter-rule-heading">
              <strong>Recap item groups</strong>
              <span>Custom groups include rarity, type, and exact item rules.</span>
            </div>

            <div class="report-item-group-layout">
              <aside class="item-filter-group-sidebar" aria-label="Recap item groups">
                <form class="item-filter-add-group" @submit.prevent="addReportItemGroup">
                  <input v-model="reportDraftGroupName" type="text" placeholder="New group name" />
                  <button class="icon-button primary" type="submit">Add Group</button>
                </form>
                <div v-if="reportItemGroups.length" class="item-filter-group-list report-item-group-list">
                  <button
                    v-for="group in reportItemGroups"
                    :key="group.id"
                    type="button"
                    :class="['item-filter-group-button', { active: selectedReportGroup?.id === group.id }]"
                    @click="selectReportItemGroup(group)"
                  >
                    <strong>{{ group.name }}</strong>
                    <span>{{ isSummaryItemSelected(reportItemGroupItemId(group.id)) ? "Selected" : "Not selected" }} &middot; {{ reportGroupCriteriaSummary(group) }}</span>
                  </button>
                </div>
                <p v-else class="empty-copy">Create a group when you want the report to focus on exact drops.</p>
              </aside>

              <div v-if="selectedReportGroup" class="report-item-group-editor">
                <div class="item-filter-editor-head">
                  <div>
                    <h3>{{ selectedReportGroup.name }}</h3>
                    <span>{{ reportGroupCriteriaSummary(selectedReportGroup) }}</span>
                  </div>
                  <button class="icon-button ghost" type="button" @click="removeReportItemGroup(selectedReportGroup)">Remove Group</button>
                </div>

                <label class="settings-row">
                  <span>Group name</span>
                  <input :value="selectedReportGroup.name" type="text" spellcheck="false" @input="updateReportGroupName(selectedReportGroup, $event)" />
                </label>

                <div class="item-filter-rule-section">
                  <div class="item-filter-rule-heading">
                    <strong>Rarities</strong>
                    <span>Empty means any rarity.</span>
                  </div>
                  <div class="item-filter-chip-grid">
                    <label v-for="rarity in TRACKED_RARITY_ORDER" :key="rarity" class="filter-box">
                      <input :checked="selectedReportGroup.rarities.includes(rarity)" type="checkbox" @change="toggleReportGroupRarity(selectedReportGroup, rarity, eventChecked($event))" />
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
                      <input :checked="selectedReportGroup.types.includes(Number(option.value))" type="checkbox" @change="toggleReportGroupType(selectedReportGroup, Number(option.value), eventChecked($event))" />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                </div>

                <div class="item-filter-rule-section">
                  <div class="item-filter-rule-heading">
                    <strong>Watched items</strong>
                    <span>Exact names match before rarity and type rules.</span>
                  </div>
                  <div class="item-filter-search-wrap">
                    <form class="item-filter-add-item" @submit.prevent="addTrackedReportItem(selectedReportGroup)">
                      <input v-model="reportDraftItem" type="search" placeholder="Search item name" autocomplete="off" spellcheck="false" />
                      <button class="icon-button primary" type="submit">Add</button>
                    </form>
                    <div v-if="reportDraftItem.trim().length >= 3 && reportItemSuggestions.length" class="item-filter-suggestions">
                      <button v-for="name in reportItemSuggestions" :key="name" type="button" @click="addTrackedReportItem(selectedReportGroup, name)">
                        {{ name }}
                      </button>
                    </div>
                    <p v-else-if="reportDraftItem.trim().length > 0 && reportDraftItem.trim().length < 3" class="item-filter-search-hint">Type at least 3 characters for suggestions.</p>
                    <p v-else-if="reportDraftItem.trim().length >= 3" class="item-filter-search-hint">No matching known items.</p>
                  </div>

                  <div v-if="selectedReportGroupedItems.length" class="item-filter-specific-list report-specific-list">
                    <section v-for="itemGroup in selectedReportGroupedItems" :key="itemGroup.typeLabel" class="item-filter-specific-type">
                      <h4>{{ itemGroup.typeLabel }}</h4>
                      <div v-for="item in itemGroup.items" :key="`${itemGroup.typeLabel}-${item}`" class="item-filter-specific-row tracked-report-item-row">
                        <span>{{ item }}</span>
                        <button class="shopping-remove" type="button" @click="removeTrackedReportItem(selectedReportGroup, item)" :aria-label="`Remove ${item}`">x</button>
                      </div>
                    </section>
                  </div>
                  <p v-else class="empty-copy">Add exact item names when this group should only count specific drops.</p>
                </div>
              </div>
              <div v-else class="report-item-group-editor report-item-group-empty">
                <div class="item-filter-editor-head">
                  <div>
                    <h3>No recap group selected</h3>
                    <span>Create a group to customize which drops appear in Past Runs.</span>
                  </div>
                </div>
                <div class="item-filter-rule-section">
                  <div class="item-filter-rule-heading">
                    <strong>Rarities</strong>
                    <span>Groups can include Set, Satanic, Heroic, or Angelic drops.</span>
                  </div>
                  <p class="empty-copy">After adding a group, rarity checkboxes appear here just like the Item Filter rules.</p>
                </div>
                <div class="item-filter-rule-section">
                  <div class="item-filter-rule-heading">
                    <strong>Item types</strong>
                    <span>Groups can include matching item categories.</span>
                  </div>
                  <p class="empty-copy">Type checkboxes appear here after a group exists.</p>
                </div>
                <div class="item-filter-rule-section">
                  <div class="item-filter-rule-heading">
                    <strong>Watched items</strong>
                    <span>Groups can include all matching drops or exact item names.</span>
                  </div>
                  <p class="empty-copy">Exact item search appears here after a group exists.</p>
                </div>
              </div>
            </div>
            <p class="empty-copy">{{ reportGroupHelp }}</p>
          </section>

          <section class="report-config-modal-grid">
            <label class="settings-row">
              <span>Top drops</span>
              <select :value="reportConfig.topDropLimit" @change="updateTopDropLimit">
                <option v-for="option in reportTopDropLimitOptions" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
          </section>
        </div>

        <div class="settings-actions">
          <button class="icon-button ghost" type="button" :disabled="isDefaultReportConfig" @click="resetReportConfig">Restore Default Report</button>
          <button class="icon-button primary" type="button" @click="$emit('close')">Done</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
