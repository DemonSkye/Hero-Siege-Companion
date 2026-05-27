<script setup lang="ts">
import { computed, ref } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import PastRunAggregatePanel from "./PastRunAggregatePanel.vue";
import PastRunCard from "./PastRunCard.vue";
import PastRunReportConfigModal from "./PastRunReportConfigModal.vue";
import {
  appendSearchTag,
  filterPastRunsBySearch,
  searchTerms as termsForSearch,
  uniquePastRunTags,
} from "../lib/past-run-search";
import { aggregatePastRuns, comparePastRunAggregates, createPastRunsExportPayload, type PastRunDropFilterGroup, type PastRunsExportPayload } from "../lib/past-runs";
import { formatDuration, formatNumber } from "../lib/format";
import type { PostRunReportConfig } from "../lib/report-config";
import { itemFilterHasTimelineCriteria, type ItemFilterGroup } from "../lib/item-filters";

const props = defineProps<{
  pastRuns: PastRunSummary[];
  expandedDropKey: string | null;
  reportConfig: PostRunReportConfig;
  itemFilterGroups: ItemFilterGroup[];
}>();

const emit = defineEmits<{
  "update:expandedDropKey": [value: string | null];
  "update:reportConfig": [value: PostRunReportConfig];
  "update-run-tags": [runId: string, tags: string[]];
  "export-runs-json": [payload: PastRunsExportPayload];
}>();

const showReportConfig = ref(false);
const compareMode = ref(false);
const runSearchQuery = ref("");
const activeTagRunId = ref<string | null>(null);

const activeReportGroups = computed<PastRunDropFilterGroup[]>(() => [
  ...props.reportConfig.itemGroups
    .filter((group) => group.enabled)
    .map((group) => ({ ...group, emptyCriteriaMatchesAll: true })),
  ...props.reportConfig.itemFilterGroupIds
    .map((groupId) => props.itemFilterGroups.find((group) => group.id === groupId))
    .filter((group): group is ItemFilterGroup => Boolean(group) && itemFilterHasTimelineCriteria(group))
    .map((group) => ({
      enabled: true,
      rarities: group.rarities,
      types: group.types,
      items: group.items,
      emptyCriteriaMatchesAll: false,
    })),
]);
const allRunTags = computed(() => uniquePastRunTags(props.pastRuns));
const searchTerms = computed(() => termsForSearch(runSearchQuery.value));
const filteredPastRuns = computed(() => filterPastRunsBySearch(props.pastRuns, searchTerms.value));
const allRunAggregate = computed(() => aggregatePastRuns(filteredPastRuns.value, props.reportConfig.dropRarities, props.reportConfig.topDropLimit, [], activeReportGroups.value));
const recentRunAggregate = computed(() => aggregatePastRuns(filteredPastRuns.value.slice(0, 10), props.reportConfig.dropRarities, props.reportConfig.topDropLimit, [], activeReportGroups.value));
const aggregatePanels = computed(() => [
  { key: "all", title: searchTerms.value.length ? "Matching Runs" : "All Runs", subtitle: `${allRunAggregate.value.runCount} saved`, aggregate: allRunAggregate.value },
  { key: "recent", title: searchTerms.value.length ? "Recent Matches" : "Last 10 Runs", subtitle: `${recentRunAggregate.value.runCount} included`, aggregate: recentRunAggregate.value },
]);
const comparisonTitle = computed(() => `${aggregatePanels.value[1].title} vs ${aggregatePanels.value[0].title}`);
const comparisonRows = computed(() => comparePastRunAggregates(recentRunAggregate.value, allRunAggregate.value));
const pastRunCountLabel = computed(() => {
  if (!searchTerms.value.length) return `${props.pastRuns.length}/100 saved`;
  return `${filteredPastRuns.value.length}/${props.pastRuns.length} shown`;
});

function toggleTagMenu(run: PastRunSummary) {
  activeTagRunId.value = activeTagRunId.value === run.id ? null : run.id;
}

function closeTagMenu() {
  activeTagRunId.value = null;
}

function addSearchTag(tag: string) {
  runSearchQuery.value = appendSearchTag(runSearchQuery.value, tag);
}

function forwardRunTags(runId: string, tags: string[]) {
  emit("update-run-tags", runId, tags);
}

function exportMatchingRuns() {
  emit("export-runs-json", createPastRunsExportPayload(filteredPastRuns.value, runSearchQuery.value, allRunAggregate.value));
}

function comparisonValue(row: ReturnType<typeof comparePastRunAggregates>[number], value: number): string {
  return row.format === "duration" ? formatDuration(value) : formatNumber(value);
}

function comparisonDelta(row: ReturnType<typeof comparePastRunAggregates>[number]): string {
  const prefix = row.delta > 0 ? "+" : "";
  const percent = row.deltaPercent === null ? "" : ` (${prefix}${Math.round(row.deltaPercent * 100)}%)`;
  return `${prefix}${comparisonValue(row, Math.abs(row.delta))}${percent}`;
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
          <button class="icon-button ghost" type="button" :disabled="!filteredPastRuns.length" @click="compareMode = !compareMode">{{ compareMode ? "Hide Compare" : "Compare" }}</button>
          <button class="icon-button ghost" type="button" :disabled="!filteredPastRuns.length" @click="exportMatchingRuns">Export JSON</button>
          <span class="info-bubble" data-tip="The default report shows all saved drops from the selected rarities. Configure Report changes the view only, not saved run data.">i</span>
          <span class="past-run-count">{{ pastRunCountLabel }}</span>
        </div>
      </div>

      <PastRunReportConfigModal
        v-if="showReportConfig"
        :report-config="reportConfig"
        :item-filter-groups="itemFilterGroups"
        @close="showReportConfig = false"
        @update:report-config="$emit('update:reportConfig', $event)"
      />

      <div v-if="pastRuns.length" class="past-run-toolbar">
        <label class="past-run-search">
          <span>Search runs</span>
          <input v-model="runSearchQuery" type="search" placeholder="Tags, drops, resources, character, stats" autocomplete="off" spellcheck="false" />
        </label>
        <div v-if="allRunTags.length" class="past-run-tag-filters" aria-label="Saved run tags">
          <button v-for="tag in allRunTags" :key="tag" class="past-run-tag-filter" type="button" @click="addSearchTag(tag)">#{{ tag }}</button>
        </div>
        <button v-if="runSearchQuery.trim()" class="icon-button ghost past-run-clear-search" type="button" @click="runSearchQuery = ''">Clear</button>
      </div>

      <div v-if="filteredPastRuns.length" class="past-run-aggregate-grid">
        <PastRunAggregatePanel
          v-for="panel in aggregatePanels"
          :key="panel.key"
          :panel-key="panel.key"
          :title="panel.title"
          :subtitle="panel.subtitle"
          :aggregate="panel.aggregate"
          :summary-metrics="reportConfig.summaryMetrics"
        />
      </div>

      <section v-if="filteredPastRuns.length && compareMode" class="past-run-compare-panel" aria-label="Past run compare mode">
        <div class="aggregate-heading">
          <div>
            <h3>{{ comparisonTitle }}</h3>
            <span>Recent strategy slice compared with the full matching set</span>
          </div>
        </div>
        <div class="past-run-compare-grid">
          <div v-for="row in comparisonRows" :key="row.id" :class="['past-run-compare-row', row.direction]">
            <span>{{ row.label }}</span>
            <strong>{{ comparisonValue(row, row.primary) }}</strong>
            <small>{{ comparisonDelta(row) }} from {{ comparisonValue(row, row.baseline) }}</small>
          </div>
        </div>
      </section>

      <div v-if="filteredPastRuns.length" class="past-runs-list">
        <PastRunCard
          v-for="run in filteredPastRuns"
          :key="run.id"
          :run="run"
          :report-config="reportConfig"
          :active-report-groups="activeReportGroups"
          :expanded-drop-key="expandedDropKey"
          :all-run-tags="allRunTags"
          :tag-menu-open="activeTagRunId === run.id"
          @toggle-tag-menu="toggleTagMenu"
          @close-tag-menu="closeTagMenu"
          @update:expanded-drop-key="$emit('update:expandedDropKey', $event)"
          @update-run-tags="forwardRunTags"
        />
      </div>
      <p v-else-if="pastRuns.length" class="empty-copy past-run-filter-empty">No saved runs match this search.</p>
      <p v-else class="empty-copy">Click End Run to save the current session here. Closing the app also saves the run, and it will appear on the next launch.</p>
    </article>
  </section>
</template>
