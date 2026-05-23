<script setup lang="ts">
import { computed, ref } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDateTime, formatDuration, formatNumber, formatTime } from "../lib/format";
import { itemIconUrl, resourceImage } from "../lib/item-assets";
import { ITEM_FILTER_SUGGESTION_LIMIT } from "../lib/item-filters";
import { shoppingAutocompleteNames } from "../lib/item-options";
import { aggregatePastRuns, pastRunDropKey, runResourceTotal, runResourceTypeCount, runTrackedItems, type PastRunAggregate } from "../lib/past-runs";
import {
  createReportItemGroup,
  defaultPostRunReportConfig,
  isDefaultPostRunReportConfig,
  REPORT_METRIC_OPTIONS,
  REPORT_RESOURCE_DRAWER_OPTIONS,
  REPORT_TOP_DROP_LIMIT_OPTIONS,
  reportConfigTrackedItems,
  type PostRunReportConfig,
  type ReportItemGroup,
  type ReportMetricId,
  type ReportResourceDrawerId,
} from "../lib/report-config";

const props = defineProps<{
  pastRuns: PastRunSummary[];
  expandedDropKey: string | null;
  reportConfig: PostRunReportConfig;
}>();

const emit = defineEmits<{
  "update:expandedDropKey": [value: string | null];
  "update:reportConfig": [value: PostRunReportConfig];
}>();

const showReportConfig = ref(false);
const reportDraftItem = ref("");
const reportDraftGroupName = ref("");
const selectedReportGroupId = ref("");

const activeReportItems = computed(() => reportConfigTrackedItems(props.reportConfig));
const reportItemGroups = computed(() => props.reportConfig.itemGroups);
const selectedReportGroup = computed(() => reportItemGroups.value.find((group) => group.id === selectedReportGroupId.value) ?? reportItemGroups.value[0] ?? null);
const allRunAggregate = computed(() => aggregatePastRuns(props.pastRuns, props.reportConfig.dropRarities, props.reportConfig.topDropLimit, activeReportItems.value));
const recentRunAggregate = computed(() => aggregatePastRuns(props.pastRuns.slice(0, 10), props.reportConfig.dropRarities, props.reportConfig.topDropLimit, activeReportItems.value));
const aggregatePanels = computed(() => [
  { key: "all", title: "All Runs", subtitle: `${allRunAggregate.value.runCount} saved`, aggregate: allRunAggregate.value },
  { key: "recent", title: "Last 10 Runs", subtitle: `${recentRunAggregate.value.runCount} included`, aggregate: recentRunAggregate.value },
]);
const reportMetricOptions = REPORT_METRIC_OPTIONS;
const reportResourceDrawerOptions = REPORT_RESOURCE_DRAWER_OPTIONS;
const reportTopDropLimitOptions = REPORT_TOP_DROP_LIMIT_OPTIONS;
const isDefaultReportConfig = computed(() => isDefaultPostRunReportConfig(props.reportConfig));
const reportModeLabel = computed(() => (isDefaultReportConfig.value ? "Default report" : "Custom report"));
const reportGroupHelp = computed(() => {
  if (activeReportItems.value.length > 0) {
    return `${activeReportItems.value.length} exact items included from enabled recap groups.`;
  }
  return "No enabled group has items, so drop recaps include every saved drop from the selected rarities.";
});
const reportItemSuggestions = computed(() => {
  const query = reportDraftItem.value.trim().toLowerCase();
  const existing = new Set((selectedReportGroup.value?.items ?? []).map((item) => item.toLowerCase()));
  if (!query) return shoppingAutocompleteNames.filter((name) => !existing.has(name.toLowerCase())).slice(0, ITEM_FILTER_SUGGESTION_LIMIT);
  return shoppingAutocompleteNames
    .filter((name) => !existing.has(name.toLowerCase()) && name.toLowerCase().includes(query))
    .slice(0, ITEM_FILTER_SUGGESTION_LIMIT);
});

function togglePastRunDropBreakdown(run: PastRunSummary, rarity: string) {
  const key = pastRunDropKey(run, rarity);
  emit("update:expandedDropKey", props.expandedDropKey === key ? null : key);
}

function isPastRunDropExpanded(run: PastRunSummary, rarity: string): boolean {
  return props.expandedDropKey === pastRunDropKey(run, rarity);
}

function runTitle(run: PastRunSummary): string {
  return run.accountName || "Hero Siege Run";
}

function toggleReportMetric(metric: ReportMetricId, enabled: boolean) {
  emit("update:reportConfig", { ...props.reportConfig, summaryMetrics: toggledList(props.reportConfig.summaryMetrics, metric, enabled) });
}

function toggleReportRarity(rarity: string, enabled: boolean) {
  emit("update:reportConfig", { ...props.reportConfig, dropRarities: toggledList(props.reportConfig.dropRarities, rarity, enabled) });
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
  const groups = reportItemGroups.value.map((candidate) =>
    candidate.id === group.id
      ? {
          ...candidate,
          ...patch,
        }
      : candidate,
  );
  emit("update:reportConfig", { ...props.reportConfig, trackedItems: [], itemGroups: groups });
}

function addTrackedReportItem(group: ReportItemGroup, value = reportDraftItem.value) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const canonical = shoppingAutocompleteNames.find((name) => name.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
  const exists = group.items.some((item) => item.toLowerCase() === canonical.toLowerCase());
  if (!exists) {
    updateReportItemGroup(group, { items: [...group.items, canonical] });
  }
  reportDraftItem.value = "";
}

function removeTrackedReportItem(group: ReportItemGroup, item: string) {
  updateReportItemGroup(group, {
    items: group.items.filter((candidate) => candidate.toLowerCase() !== item.toLowerCase()),
  });
}

function aggregateMetricCards(aggregate: PastRunAggregate) {
  const cards: Record<ReportMetricId, { label: string; value: number; detail: string }> = {
    gold: { label: "Gold/h", value: aggregate.goldPerHour, detail: `Best ${formatNumber(aggregate.bestGoldPerHour)}` },
    xp: { label: "XP/h", value: aggregate.xpPerHour, detail: `Best ${formatNumber(aggregate.bestXpPerHour)}` },
    keys: { label: "Keys", value: aggregate.totalKeys, detail: `${formatNumber(averagePerRun(aggregate.totalKeys, aggregate.runCount))}/run` },
    ores: { label: "Ore", value: aggregate.totalOres, detail: `${formatNumber(averagePerRun(aggregate.totalOres, aggregate.runCount))}/run` },
    materials: { label: "Materials", value: aggregate.totalMaterials, detail: `${formatNumber(averagePerRun(aggregate.totalMaterials, aggregate.runCount))}/run` },
    mfDrops: { label: "MF drops", value: aggregate.totalMfDrops, detail: `${formatNumber(aggregate.totalGold)} gold` },
  };
  return props.reportConfig.summaryMetrics.map((metric) => cards[metric]).filter(Boolean);
}

function runMetricCards(run: PastRunSummary) {
  const cards: Record<ReportMetricId, { label: string; value: number; detail: string }> = {
    gold: { label: "Gold", value: run.totalGoldGained, detail: `${formatNumber(ratePerHour(run.totalGoldGained, run.durationMs))}/h` },
    xp: { label: "XP", value: run.totalXpGained, detail: `${formatNumber(ratePerHour(run.totalXpGained, run.durationMs))}/h` },
    keys: { label: "Keys", value: runResourceTotal(run.keys), detail: `${runResourceTypeCount(run.keys)} types` },
    ores: { label: "Ore", value: runResourceTotal(run.ores), detail: `${runResourceTypeCount(run.ores)} types` },
    materials: { label: "Materials", value: runResourceTotal(run.materials ?? []), detail: `${runResourceTypeCount(run.materials)} types` },
    mfDrops: { label: "MF drops", value: runMfDropTotal(run), detail: `${runDropTotal(run)} tracked` },
  };
  return props.reportConfig.summaryMetrics.map((metric) => cards[metric]).filter(Boolean);
}

function resourceDrawers(run: PastRunSummary) {
  const drawers: Record<ReportResourceDrawerId, { id: ReportResourceDrawerId; title: string; empty: string; resources: NonNullable<PastRunSummary["materials"]>; imageKind: "key" | "ore" | "material" }> = {
    materials: { id: "materials", title: "Materials", empty: "No materials logged.", resources: run.materials ?? [], imageKind: "material" },
    keys: { id: "keys", title: "Non-basic keys", empty: "No non-basic keys logged.", resources: run.keys, imageKind: "key" },
    ores: { id: "ores", title: "Ore mined", empty: "No ore logged.", resources: run.ores, imageKind: "ore" },
  };
  return props.reportConfig.resourceDrawers.map((drawer) => drawers[drawer]).filter(Boolean);
}

function runDrops(run: PastRunSummary) {
  return runTrackedItems(run, props.reportConfig.dropRarities, activeReportItems.value);
}

function runMfDropTotal(run: PastRunSummary): number {
  return runDrops(run).reduce((total, item) => total + item.mf, 0);
}

function runDropTotal(run: PastRunSummary): number {
  return runDrops(run).reduce((total, item) => total + item.total, 0);
}

function ratePerHour(value: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.trunc(value / (durationMs / 3_600_000));
}

function averagePerRun(value: number, runCount: number): number {
  return runCount ? Math.trunc(value / runCount) : 0;
}

function toggledList<T extends string>(values: T[], value: T, enabled: boolean): T[] {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return Array.from(next);
}

function eventChecked(event: Event): boolean {
  return Boolean((event.target as HTMLInputElement | null)?.checked);
}
</script>

<template>
  <section class="past-runs-view">
    <article class="panel past-runs-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">History</p>
          <h2>Past Runs</h2>
        </div>
        <div class="past-runs-heading-actions">
          <button class="icon-button ghost" type="button" @click="showReportConfig = true">Configure Report</button>
          <span class="info-bubble" data-tip="The default report shows all saved drops from the selected rarities. Configure Report changes the view only, not saved run data.">i</span>
          <span class="past-run-count">{{ pastRuns.length }}/100 saved</span>
        </div>
      </div>

      <Teleport to="body">
        <div v-if="showReportConfig" class="modal-backdrop" @click.self="showReportConfig = false">
          <section class="settings-panel report-config-modal" role="dialog" aria-modal="true" aria-labelledby="report-config-title">
          <div class="settings-heading">
            <div>
              <p class="eyebrow">Past Runs</p>
              <h2 id="report-config-title">Configure Report</h2>
              <p class="settings-note">{{ reportModeLabel }} settings change what appears here without changing saved run data.</p>
            </div>
            <button class="settings-close" type="button" title="Close tracked report settings" aria-label="Close tracked report settings" @click="showReportConfig = false">x</button>
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
                    <div>
                      <h3>{{ selectedReportGroup.name }}</h3>
                      <span>{{ selectedReportGroup.enabled ? "Included in report" : "Disabled" }}</span>
                    </div>
                    <label class="settings-inline-check">
                      <input :checked="selectedReportGroup.enabled" type="checkbox" @change="updateReportItemGroup(selectedReportGroup, { enabled: eventChecked($event) })" />
                      <span class="settings-label">Include group</span>
                    </label>
                    <button class="icon-button ghost" type="button" @click="removeReportItemGroup(selectedReportGroup)">Remove</button>
                  </div>

                  <div class="item-filter-search-wrap">
                    <form class="item-filter-add-item" @submit.prevent="addTrackedReportItem(selectedReportGroup)">
                      <input v-model="reportDraftItem" type="search" placeholder="Search item name" autocomplete="off" spellcheck="false" />
                      <button class="icon-button primary" type="submit">Add Item</button>
                    </form>
                    <div v-if="reportDraftItem.trim().length >= 3 && reportItemSuggestions.length" class="item-filter-suggestions">
                      <button v-for="name in reportItemSuggestions" :key="name" type="button" @click="addTrackedReportItem(selectedReportGroup, name)">
                        {{ name }}
                      </button>
                    </div>
                    <p v-else-if="reportDraftItem.trim().length > 0 && reportDraftItem.trim().length < 3" class="item-filter-search-hint">Type at least 3 characters for suggestions.</p>
                    <p v-else-if="reportDraftItem.trim().length >= 3" class="item-filter-search-hint">No matching known items.</p>
                  </div>

                  <div v-if="selectedReportGroup.items.length" class="tracked-report-item-list">
                    <div v-for="item in selectedReportGroup.items" :key="item" class="item-filter-specific-row tracked-report-item-row">
                      <span>{{ item }}</span>
                      <button class="shopping-remove" type="button" @click="removeTrackedReportItem(selectedReportGroup, item)" :aria-label="`Remove ${item}`">x</button>
                    </div>
                  </div>
                  <p v-else class="empty-copy">This group has no items yet.</p>
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
                  <strong>Drops</strong>
                  <span>Rarity groups included in item recaps.</span>
                </div>
                <div class="item-filter-chip-grid">
                  <label v-for="rarity in ['Set', 'Satanic', 'Heroic', 'Angelic']" :key="rarity" class="filter-box">
                    <input :checked="reportConfig.dropRarities.includes(rarity)" type="checkbox" @change="toggleReportRarity(rarity, eventChecked($event))" />
                    <span>{{ rarity }}</span>
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
            <button class="icon-button primary" type="button" @click="showReportConfig = false">Done</button>
          </div>
          </section>
        </div>
      </Teleport>

      <div v-if="pastRuns.length" class="past-run-aggregate-grid">
        <section v-for="panel in aggregatePanels" :key="panel.key" class="past-run-aggregate">
          <div class="aggregate-heading">
            <div>
              <h3>{{ panel.title }}</h3>
              <span>{{ panel.subtitle }} &middot; Avg {{ formatDuration(panel.aggregate.averageDurationMs) }}</span>
            </div>
            <strong>{{ formatDuration(panel.aggregate.totalDurationMs) }}</strong>
          </div>
          <div class="aggregate-metrics dynamic-metrics">
            <div v-for="metric in aggregateMetricCards(panel.aggregate)" :key="`${panel.key}-${metric.label}`">
              <span>{{ metric.label }}</span>
              <strong>{{ formatNumber(metric.value) }}</strong>
              <small>{{ metric.detail }}</small>
            </div>
          </div>
          <div class="aggregate-drop-grid">
            <div v-for="drop in panel.aggregate.drops" :key="`${panel.key}-${drop.rarity}`" :class="['aggregate-drop', drop.rarity.toLowerCase()]">
              <span>{{ drop.rarity }}</span>
              <strong>{{ formatNumber(drop.total) }}</strong>
              <small>{{ formatNumber(drop.mf) }} MF &middot; {{ formatNumber(drop.unique) }} unique</small>
            </div>
          </div>
          <div class="aggregate-top-drops">
            <span>Top drops</span>
            <div v-if="panel.aggregate.topDrops.length" class="aggregate-top-list">
              <div v-for="drop in panel.aggregate.topDrops" :key="`${panel.key}-${drop.name}`">
                <span>{{ drop.name }}</span>
                <strong>{{ formatNumber(drop.total) }}</strong>
              </div>
            </div>
            <small v-else>No tracked drops yet.</small>
          </div>
        </section>
      </div>

      <div v-if="pastRuns.length" class="past-runs-list">
        <section v-for="run in pastRuns" :key="run.id" class="past-run-card">
          <div class="past-run-header">
            <div>
              <h3>{{ runTitle(run) }}</h3>
              <span>{{ formatDateTime(run.sessionStartedAt) }} &middot; {{ formatDuration(run.durationMs) }}</span>
            </div>
            <div class="past-run-time">{{ formatTime(run.sessionEndedAt) }}</div>
          </div>

          <div class="past-run-metrics dynamic-metrics">
            <div v-for="metric in runMetricCards(run)" :key="`${run.id}-${metric.label}`">
              <span>{{ metric.label }}</span>
              <strong>{{ formatNumber(metric.value) }}</strong>
              <small>{{ metric.detail }}</small>
            </div>
          </div>

          <div class="past-run-drops">
            <div class="past-run-drop-grid">
              <button
                v-for="item in runDrops(run)"
                :key="`${run.id}-${item.rarity}`"
                type="button"
                :class="['item-counter', item.rarity.toLowerCase(), { expanded: isPastRunDropExpanded(run, item.rarity) }]"
                @click="togglePastRunDropBreakdown(run, item.rarity)"
              >
                <span>{{ item.rarity }}</span>
                <strong>{{ formatNumber(item.total) }}</strong>
                <small>{{ formatNumber(item.mf) }} MF &middot; {{ item.drops.length }} unique</small>
              </button>
            </div>
            <template v-for="item in runDrops(run)" :key="`${run.id}-${item.rarity}-details`">
              <div v-if="isPastRunDropExpanded(run, item.rarity)" class="drop-breakdown past-run-drop-breakdown" :class="item.rarity.toLowerCase()">
                <div class="drop-breakdown-head">
                  <strong>{{ item.rarity }} drops</strong>
                  <span>{{ item.drops.length }} unique</span>
                </div>
                <div v-if="item.drops.length" class="drop-breakdown-list">
                  <div v-for="drop in item.drops" :key="`${run.id}-${item.rarity}-${drop.name}`" class="drop-breakdown-row">
                    <img v-if="itemIconUrl(drop.name)" class="drop-breakdown-icon" :src="itemIconUrl(drop.name)" :alt="drop.name" />
                    <span v-else class="drop-breakdown-icon drop-breakdown-icon-empty" aria-hidden="true"></span>
                    <span class="drop-breakdown-name">{{ drop.name }}</span>
                    <strong>{{ formatNumber(drop.total) }}</strong>
                  </div>
                </div>
                <p v-else class="empty-copy">No saved {{ item.rarity.toLowerCase() }} item detail for this run.</p>
              </div>
            </template>
          </div>

          <div class="resource-columns">
            <div v-for="drawer in resourceDrawers(run)" :key="`${run.id}-${drawer.id}`" class="resource-column">
              <h4>{{ drawer.title }}</h4>
              <div v-if="drawer.resources.length" class="resource-list">
                <div
                  v-for="resource in drawer.resources"
                  :key="`${run.id}-${drawer.id}-${resource.name}`"
                  class="resource-chip"
                  :class="{ 'resource-chip-no-image': !resourceImage(resource, drawer.imageKind) }"
                >
                  <img v-if="resourceImage(resource, drawer.imageKind)" :src="resourceImage(resource, drawer.imageKind)" :alt="resource.name" />
                  <span>{{ resource.name }}</span>
                  <strong>{{ formatNumber(resource.total) }}</strong>
                </div>
              </div>
              <p v-else class="empty-copy">{{ drawer.empty }}</p>
            </div>
          </div>
        </section>
      </div>
      <p v-else class="empty-copy">Click End Run to save the current session here. Closing the app also saves the run, and it will appear on the next launch.</p>
    </article>
  </section>
</template>
