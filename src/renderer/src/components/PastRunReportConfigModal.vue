<script setup lang="ts">
import { computed, ref } from "vue";
import { ITEM_FILTER_SUGGESTION_LIMIT, itemTypeLabelForName } from "../lib/item-filters";
import { shoppingAutocompleteNames } from "../lib/item-options";
import { TRACKED_RARITY_ORDER } from "../lib/past-runs";
import { eventChecked } from "../lib/dom-events";
import {
  createReportItemGroup,
  defaultPostRunReportConfig,
  isDefaultPostRunReportConfig,
  REPORT_METRIC_OPTIONS,
  REPORT_RESOURCE_DRAWER_OPTIONS,
  REPORT_TOP_DROP_LIMIT_OPTIONS,
  type PostRunReportConfig,
  type ReportItemGroup,
  type ReportMetricId,
  type ReportResourceDrawerId,
} from "../lib/report-config";

const props = defineProps<{
  reportConfig: PostRunReportConfig;
}>();

const emit = defineEmits<{
  close: [];
  "update:reportConfig": [value: PostRunReportConfig];
}>();

const reportDraftItem = ref("");
const reportDraftGroupName = ref("");
const selectedReportGroupId = ref("");

const reportItemGroups = computed(() => props.reportConfig.itemGroups);
const selectedReportGroup = computed(() => reportItemGroups.value.find((group) => group.id === selectedReportGroupId.value) ?? reportItemGroups.value[0] ?? null);
const activeReportGroups = computed(() => reportItemGroups.value.filter((group) => group.enabled));
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
  if (activeReportGroups.value.length > 0) {
    return "Enabled groups are combined. Empty rarities mean any rarity; empty watched items mean any item in the selected rarities.";
  }
  return "No enabled groups, so drop recaps include every saved drop from the default rarities.";
});

const reportMetricOptions = REPORT_METRIC_OPTIONS;
const reportResourceDrawerOptions = REPORT_RESOURCE_DRAWER_OPTIONS;
const reportTopDropLimitOptions = REPORT_TOP_DROP_LIMIT_OPTIONS;

function toggleReportMetric(metric: ReportMetricId, enabled: boolean) {
  emit("update:reportConfig", { ...props.reportConfig, summaryMetrics: toggledList(props.reportConfig.summaryMetrics, metric, enabled) });
}

function toggleReportResourceDrawer(drawer: ReportResourceDrawerId, enabled: boolean) {
  emit("update:reportConfig", { ...props.reportConfig, resourceDrawers: toggledList(props.reportConfig.resourceDrawers, drawer, enabled) });
}

function updateTopDropLimit(event: Event) {
  const value = Number((event.target as HTMLSelectElement | null)?.value);
  emit("update:reportConfig", { ...props.reportConfig, topDropLimit: value });
}

function resetReportConfig() {
  emit("update:reportConfig", defaultPostRunReportConfig);
  reportDraftItem.value = "";
  reportDraftGroupName.value = "";
  selectedReportGroupId.value = "";
}

function addReportItemGroup() {
  const group = createReportItemGroup(reportDraftGroupName.value, reportItemGroups.value.length);
  emit("update:reportConfig", { ...props.reportConfig, trackedItems: [], itemGroups: [...reportItemGroups.value, group] });
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
  emit("update:reportConfig", { ...props.reportConfig, trackedItems: [], itemGroups: groups });
  if (selectedReportGroupId.value === group.id) selectedReportGroupId.value = groups[0]?.id ?? "";
  reportDraftItem.value = "";
}

function updateReportItemGroup(group: ReportItemGroup, patch: Partial<ReportItemGroup>) {
  const groups = reportItemGroups.value.map((candidate) => (candidate.id === group.id ? { ...candidate, ...patch } : candidate));
  emit("update:reportConfig", { ...props.reportConfig, trackedItems: [], itemGroups: groups });
}

function updateReportGroupName(group: ReportItemGroup, event: Event) {
  updateReportItemGroup(group, { name: (event.target as HTMLInputElement | null)?.value ?? "" });
}

function toggleReportGroupRarity(group: ReportItemGroup, rarity: string, enabled: boolean) {
  updateReportItemGroup(group, { rarities: toggledList(group.rarities, rarity, enabled) });
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
    <div class="modal-backdrop" @click.self="$emit('close')">
      <section class="settings-panel report-config-modal" role="dialog" aria-modal="true" aria-labelledby="report-config-title">
        <div class="settings-heading">
          <div>
            <p class="eyebrow">Past Runs</p>
            <h2 id="report-config-title">Configure Report</h2>
            <p class="settings-note">{{ reportModeLabel }} settings change what appears here without changing saved run data.</p>
          </div>
          <button class="settings-close" type="button" title="Close tracked report settings" aria-label="Close tracked report settings" @click="$emit('close')">x</button>
        </div>

        <div class="report-config-modal-body">
          <section class="item-filter-rule-section">
            <div class="item-filter-rule-heading">
              <strong>Recap item groups</strong>
              <span>Enabled groups include exact items in drop recaps.</span>
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
                    :class="['item-filter-group-button', { active: selectedReportGroup?.id === group.id, disabled: !group.enabled }]"
                    @click="selectReportItemGroup(group)"
                  >
                    <strong>{{ group.name }}</strong>
                    <span>{{ group.enabled ? "Included" : "Disabled" }} &middot; {{ group.items.length }} items</span>
                  </button>
                </div>
                <p v-else class="empty-copy">Create a group when you want the report to focus on exact drops.</p>
              </aside>

              <div v-if="selectedReportGroup" class="report-item-group-editor">
                <div class="item-filter-editor-head">
                  <label class="settings-check">
                    <input :checked="selectedReportGroup.enabled" type="checkbox" @change="updateReportItemGroup(selectedReportGroup, { enabled: eventChecked($event) })" />
                    <span>Enabled</span>
                  </label>
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
                    <strong>Watched items</strong>
                    <span>Empty means any item matching the selected rarities.</span>
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
            <div class="item-filter-rule-section">
              <div class="item-filter-rule-heading">
                <strong>Cards</strong>
                <span>Summary cards shown in aggregate and run recaps.</span>
              </div>
              <div class="item-filter-chip-grid">
                <label v-for="option in reportMetricOptions" :key="option.id" class="filter-box">
                  <input :checked="reportConfig.summaryMetrics.includes(option.id)" type="checkbox" @change="toggleReportMetric(option.id, eventChecked($event))" />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </div>

            <div class="item-filter-rule-section">
              <div class="item-filter-rule-heading">
                <strong>Drawers</strong>
                <span>Resource drawers under each run.</span>
              </div>
              <div class="item-filter-chip-grid">
                <label v-for="option in reportResourceDrawerOptions" :key="option.id" class="filter-box">
                  <input :checked="reportConfig.resourceDrawers.includes(option.id)" type="checkbox" @change="toggleReportResourceDrawer(option.id, eventChecked($event))" />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </div>

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
