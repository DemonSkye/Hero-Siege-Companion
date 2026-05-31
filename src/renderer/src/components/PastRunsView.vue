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
import {
  aggregatePastRuns,
  createPastRunsAggregateCsv,
  createPastRunsDiscordSummary,
  createPastRunsExportPayload,
  type PastRunDropFilterGroup,
  type PastRunsExportPayload,
} from "../lib/past-runs";
import type { PostRunReportConfig } from "../lib/report-config";
import { itemFilterHasTimelineCriteria, type ItemFilterGroup } from "../lib/item-filters";

const props = defineProps<{
  pastRuns: PastRunSummary[];
  reportConfig: PostRunReportConfig;
  itemFilterGroups: ItemFilterGroup[];
}>();

const emit = defineEmits<{
  "update:reportConfig": [value: PostRunReportConfig];
  "update-run-tags": [runId: string, tags: string[]];
  "export-runs-json": [payload: PastRunsExportPayload];
  "export-runs-csv": [csv: string];
  "copy-summary": [summary: string];
}>();

const showReportConfig = ref(false);
const runSearchQuery = ref("");
const activeTagRunId = ref<string | null>(null);
const expandedRunId = ref<string | null>(null);

const activeReportGroups = computed<PastRunDropFilterGroup[]>(() => [
  ...props.reportConfig.itemGroups
    .filter((group) => props.reportConfig.summaryItems.includes(`group:${group.id}`))
    .map((group) => ({ ...group, enabled: true, emptyCriteriaMatchesAll: true })),
  ...props.itemFilterGroups
    .filter((group) => props.reportConfig.summaryItems.includes(`filter:${group.id}`) && itemFilterHasTimelineCriteria(group))
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
const filteredRunAggregate = computed(() => aggregatePastRuns(filteredPastRuns.value, props.reportConfig.dropRarities, props.reportConfig.topDropLimit, [], activeReportGroups.value));
const aggregatePanelTitle = computed(() => (searchTerms.value.length ? "Matching Runs" : "All Runs"));
const aggregatePanelSubtitle = computed(() => (searchTerms.value.length ? `${filteredRunAggregate.value.runCount} shown` : `${filteredRunAggregate.value.runCount} saved`));
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

function toggleExpandedRun(runId: string) {
  expandedRunId.value = expandedRunId.value === runId ? null : runId;
}

function exportMatchingRuns() {
  emit("export-runs-json", createPastRunsExportPayload(filteredPastRuns.value, runSearchQuery.value, filteredRunAggregate.value));
}

function aggregateShareOptions() {
  return {
    title: aggregatePanelTitle.value,
    query: runSearchQuery.value,
    runs: filteredPastRuns.value,
    aggregate: filteredRunAggregate.value,
    reportConfig: props.reportConfig,
    itemFilterGroups: props.itemFilterGroups,
  };
}

function exportMatchingRunsCsv() {
  emit("export-runs-csv", createPastRunsAggregateCsv(aggregateShareOptions()));
}

function copyMatchingRunsSummary() {
  emit("copy-summary", createPastRunsDiscordSummary(aggregateShareOptions()));
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
          <button class="icon-button ghost past-run-copy-filtered-summary" type="button" :disabled="!filteredPastRuns.length" @click="copyMatchingRunsSummary">Copy Summary</button>
          <button class="icon-button ghost past-run-export-csv" type="button" :disabled="!filteredPastRuns.length" @click="exportMatchingRunsCsv">Export CSV</button>
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
      <p v-if="pastRuns.length" class="past-run-report-note">
        Past Runs counts: total drops are tracked item drops, magic-find flagged is the server flag count, and unique is distinct item names.
      </p>

      <div v-if="filteredPastRuns.length" class="past-run-aggregate-grid">
        <PastRunAggregatePanel
          panel-key="filtered"
          :title="aggregatePanelTitle"
          :subtitle="aggregatePanelSubtitle"
          :runs="filteredPastRuns"
          :aggregate="filteredRunAggregate"
          :report-config="reportConfig"
          :item-filter-groups="itemFilterGroups"
        />
      </div>

      <div v-if="filteredPastRuns.length" class="past-runs-list">
        <PastRunCard
          v-for="run in filteredPastRuns"
          :key="run.id"
          :run="run"
          :report-config="reportConfig"
          :active-report-groups="activeReportGroups"
          :item-filter-groups="itemFilterGroups"
          :expanded="expandedRunId === run.id"
          :all-run-tags="allRunTags"
          :tag-menu-open="activeTagRunId === run.id"
          @toggle-expanded="toggleExpandedRun"
          @toggle-tag-menu="toggleTagMenu"
          @close-tag-menu="closeTagMenu"
          @update-run-tags="forwardRunTags"
          @copy-run-summary="$emit('copy-summary', $event)"
        />
      </div>
      <p v-else-if="pastRuns.length" class="empty-copy past-run-filter-empty">No saved runs match this search.</p>
      <p v-else class="empty-copy">Click End Run to save the current session here. Closing the app also saves the run, and it will appear on the next launch.</p>
    </article>
  </section>
</template>
