<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDuration } from "../lib/format";
import {
  appendSearchTag,
  filterPastRunsBySearch,
  searchTerms as termsForSearch,
  uniquePastRunTags,
} from "../lib/past-run-search";
import {
  aggregatePastRuns,
  createPastRunDiscordSummary,
  createPastRunsAggregateCsv,
  createPastRunsDiscordSummary,
  createPastRunsExportPayload,
  type PastRunDropFilterGroup,
  type PastRunsExportPayload,
} from "../lib/past-runs";
import type { PostRunReportConfig } from "../lib/report-config";
import { itemFilterHasTimelineCriteria, type ItemFilterGroup } from "../lib/item-filters";
import PastRunAggregatePanel from "./PastRunAggregatePanel.vue";
import PastRunCard from "./PastRunCard.vue";
import PastRunDetailReport from "./PastRunDetailReport.vue";
import PastRunReportConfigModal from "./PastRunReportConfigModal.vue";
import TrashIcon from "./TrashIcon.vue";

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
  "delete-run": [runId: string];
  "delete-all-runs": [];
}>();

interface PastRunDateGroup {
  key: string;
  label: string;
  runs: PastRunSummary[];
}

const showReportConfig = ref(false);
const runSearchQuery = ref("");
const selectedRunId = ref<string | null>(null);
const activeTagRunId = ref<string | null>(null);
const activeActionRunId = ref<string | null>(null);
const deleteAllConfirmOpen = ref(false);
const mobileReportOpen = ref(true);
const reportPaper = ref<HTMLElement | null>(null);
const aggregateLibraryButton = ref<HTMLButtonElement | null>(null);

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
const groupedPastRuns = computed(() => groupRunsByDate(filteredPastRuns.value));
const selectedRun = computed(() => filteredPastRuns.value.find((run) => run.id === selectedRunId.value) ?? null);
const filteredRunAggregate = computed(() => aggregatePastRuns(
  filteredPastRuns.value,
  props.reportConfig.dropRarities,
  props.reportConfig.topDropLimit,
  [],
  activeReportGroups.value,
));
const aggregatePanelTitle = computed(() => (searchTerms.value.length ? "Matching Runs" : "All Runs"));
const aggregatePanelSubtitle = computed(() => (searchTerms.value.length
  ? `${filteredRunAggregate.value.runCount} shown`
  : `${filteredRunAggregate.value.runCount} saved`));
const pastRunCountLabel = computed(() => {
  if (!searchTerms.value.length) return `${props.pastRuns.length} saved`;
  return `${filteredPastRuns.value.length}/${props.pastRuns.length} shown`;
});
const deleteAllRunLabel = computed(() => `${props.pastRuns.length} saved ${props.pastRuns.length === 1 ? "run" : "runs"}`);

watch(() => props.pastRuns.length, (runCount) => {
  if (!runCount) {
    deleteAllConfirmOpen.value = false;
    selectedRunId.value = null;
    closeRunMenus();
  }
});

watch(filteredPastRuns, (runs) => {
  if (selectedRunId.value && !runs.some((run) => run.id === selectedRunId.value)) selectedRunId.value = null;
  if (activeTagRunId.value && !runs.some((run) => run.id === activeTagRunId.value)) activeTagRunId.value = null;
  if (activeActionRunId.value && !runs.some((run) => run.id === activeActionRunId.value)) activeActionRunId.value = null;
});

function toggleTagMenu(run: PastRunSummary) {
  activeActionRunId.value = null;
  activeTagRunId.value = activeTagRunId.value === run.id ? null : run.id;
}

function closeTagMenu() {
  activeTagRunId.value = null;
}

function toggleActionMenu(run: PastRunSummary) {
  activeTagRunId.value = null;
  activeActionRunId.value = activeActionRunId.value === run.id ? null : run.id;
}

function closeActionMenu() {
  activeActionRunId.value = null;
}

function closeRunMenus() {
  activeTagRunId.value = null;
  activeActionRunId.value = null;
}

function addSearchTag(tag: string) {
  runSearchQuery.value = appendSearchTag(runSearchQuery.value, tag);
}

function forwardRunTags(runId: string, tags: string[]) {
  emit("update-run-tags", runId, tags);
}

function forwardDeleteRun(runId: string) {
  closeRunMenus();
  if (selectedRunId.value === runId) selectedRunId.value = null;
  emit("delete-run", runId);
}

async function focusReportHeading() {
  await nextTick();
  reportPaper.value?.querySelector<HTMLElement>("[data-past-run-report-heading]")?.focus();
}

function viewAggregateReport() {
  selectedRunId.value = null;
  mobileReportOpen.value = true;
  closeRunMenus();
  void focusReportHeading();
}

function viewRunReport(runId: string) {
  selectedRunId.value = runId;
  mobileReportOpen.value = true;
  closeRunMenus();
  void focusReportHeading();
}

async function showRunLibrary() {
  mobileReportOpen.value = false;
  closeRunMenus();
  await nextTick();
  aggregateLibraryButton.value?.focus();
}

function requestDeleteAllRuns() {
  if (!props.pastRuns.length) return;
  deleteAllConfirmOpen.value = true;
}

function cancelDeleteAllRuns() {
  deleteAllConfirmOpen.value = false;
}

function confirmDeleteAllRuns() {
  if (!props.pastRuns.length) {
    deleteAllConfirmOpen.value = false;
    return;
  }
  selectedRunId.value = null;
  closeRunMenus();
  deleteAllConfirmOpen.value = false;
  emit("delete-all-runs");
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

function exportMatchingRuns() {
  emit("export-runs-json", createPastRunsExportPayload(filteredPastRuns.value, runSearchQuery.value, filteredRunAggregate.value));
}

function exportMatchingRunsCsv() {
  emit("export-runs-csv", createPastRunsAggregateCsv(aggregateShareOptions()));
}

function copyMatchingRunsSummary() {
  emit("copy-summary", createPastRunsDiscordSummary(aggregateShareOptions()));
}

function copyRunSummary(run: PastRunSummary) {
  emit("copy-summary", createPastRunDiscordSummary(run, {
    reportConfig: props.reportConfig,
    itemFilterGroups: props.itemFilterGroups,
    dropRarities: props.reportConfig.dropRarities,
    topDropLimit: props.reportConfig.topDropLimit,
    activeReportGroups: activeReportGroups.value,
  }));
}

function exportRun(run: PastRunSummary) {
  const summary = aggregatePastRuns(
    [run],
    props.reportConfig.dropRarities,
    props.reportConfig.topDropLimit,
    [],
    activeReportGroups.value,
  );
  emit("export-runs-json", createPastRunsExportPayload([run], "", summary));
}

function groupRunsByDate(runs: PastRunSummary[]): PastRunDateGroup[] {
  const groups = new Map<string, PastRunDateGroup>();
  for (const run of runs) {
    const date = new Date(run.sessionStartedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.runs.push(run);
      continue;
    }
    groups.set(key, {
      key,
      label: date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }),
      runs: [run],
    });
  }
  return Array.from(groups.values());
}
</script>

<template>
  <section class="past-runs-view">
    <article class="panel past-runs-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">History</p>
          <h2>Report Desk</h2>
          <p class="past-run-heading-copy">Choose all matching runs or one saved session, then read and share a single report.</p>
        </div>
        <div class="past-runs-heading-actions">
          <button class="icon-button ghost" type="button" @click="showReportConfig = true">Configure Report</button>
          <button
            v-if="!deleteAllConfirmOpen"
            class="icon-button danger icon-only past-run-delete-all"
            type="button"
            title="Delete all past runs"
            aria-label="Delete all past runs"
            :disabled="!pastRuns.length"
            @click="requestDeleteAllRuns"
          >
            <TrashIcon />
          </button>
          <div v-else class="past-run-delete-confirm past-run-delete-all-confirm" role="group" aria-label="Confirm delete all past runs">
            <span>Delete {{ deleteAllRunLabel }}?</span>
            <button class="icon-button danger past-run-confirm-delete-all" type="button" @click="confirmDeleteAllRuns">Confirm</button>
            <button class="icon-button ghost past-run-cancel-delete-all" type="button" @click="cancelDeleteAllRuns">Cancel</button>
          </div>
          <span class="info-bubble" data-tip="The report uses the current search and configured report items without changing saved run data.">i</span>
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
        Total drops are tracked item drops, magic-find flagged is the server flag count, and unique is distinct item names.
      </p>

      <div
        v-if="pastRuns.length"
        :class="['past-run-report-desk', { 'mobile-report-open': mobileReportOpen }]"
      >
        <aside class="past-run-library" aria-label="Saved run library">
          <div class="past-run-library-heading">
            <div>
              <strong>Run library</strong>
              <span>{{ pastRunCountLabel }}</span>
            </div>
          </div>

          <button
            ref="aggregateLibraryButton"
            class="past-run-library-aggregate"
            type="button"
            :class="{ selected: selectedRunId === null }"
            :aria-current="selectedRunId === null ? 'page' : undefined"
            :disabled="!filteredPastRuns.length"
            @click="viewAggregateReport"
          >
            <span>
              <strong>{{ aggregatePanelTitle }}</strong>
              <small>{{ filteredPastRuns.length }} runs &middot; {{ formatDuration(filteredRunAggregate.totalDurationMs) }}</small>
            </span>
            <span aria-hidden="true">&rsaquo;</span>
          </button>

          <div v-if="filteredPastRuns.length" class="past-runs-list">
            <section v-for="group in groupedPastRuns" :key="group.key" class="past-run-library-group">
              <div class="past-run-library-date">
                <strong>{{ group.label }}</strong>
                <span>{{ group.runs.length }} {{ group.runs.length === 1 ? "run" : "runs" }}</span>
              </div>
              <PastRunCard
                v-for="run in group.runs"
                :key="run.id"
                :run="run"
                :selected="selectedRunId === run.id"
                :all-run-tags="allRunTags"
                :tag-menu-open="activeTagRunId === run.id"
                :action-menu-open="activeActionRunId === run.id"
                @view-report="viewRunReport"
                @toggle-action-menu="toggleActionMenu"
                @close-action-menu="closeActionMenu"
                @toggle-tag-menu="toggleTagMenu"
                @close-tag-menu="closeTagMenu"
                @update-run-tags="forwardRunTags"
                @copy-run-summary="copyRunSummary"
                @export-run="exportRun"
                @delete-run="forwardDeleteRun"
              />
            </section>
          </div>
          <p v-else class="empty-copy past-run-filter-empty">No saved runs match this search.</p>
        </aside>

        <article
          ref="reportPaper"
          class="past-run-report-paper"
          :class="{ 'is-aggregate-report': !selectedRun }"
          aria-label="Past run report"
        >
          <button class="icon-button ghost past-run-mobile-back" type="button" @click="showRunLibrary">&larr; Back to run library</button>

          <template v-if="filteredPastRuns.length">
            <template v-if="selectedRun">
              <PastRunDetailReport
                :run="selectedRun"
                :report-config="reportConfig"
                :item-filter-groups="itemFilterGroups"
                :search-query="runSearchQuery"
              />
              <footer class="past-run-report-footer">
                <span>Report scope: this saved run</span>
                <div>
                  <button class="icon-button ghost past-run-export-selected" type="button" @click="exportRun(selectedRun)">Export Run</button>
                  <button class="icon-button primary past-run-copy-selected-summary" type="button" @click="copyRunSummary(selectedRun)">Copy Summary</button>
                </div>
              </footer>
            </template>
            <template v-else>
              <PastRunAggregatePanel
                panel-key="filtered"
                :title="aggregatePanelTitle"
                :subtitle="aggregatePanelSubtitle"
                :runs="filteredPastRuns"
                :aggregate="filteredRunAggregate"
                :report-config="reportConfig"
                :item-filter-groups="itemFilterGroups"
                @update:report-config="$emit('update:reportConfig', $event)"
              />
              <footer class="past-run-report-footer">
                <span>Report scope: current search and filters</span>
                <div>
                  <button class="icon-button ghost past-run-export-csv" type="button" @click="exportMatchingRunsCsv">Export CSV</button>
                  <button class="icon-button ghost past-run-export-json" type="button" @click="exportMatchingRuns">Export JSON</button>
                  <button class="icon-button primary past-run-copy-filtered-summary" type="button" @click="copyMatchingRunsSummary">Copy Summary</button>
                </div>
              </footer>
            </template>
          </template>
          <div v-else class="past-run-report-empty">
            <p class="eyebrow">Filtered report</p>
            <h2 tabindex="-1" data-past-run-report-heading>No matching runs</h2>
            <p class="empty-copy">Clear or change the search to build a report from saved sessions.</p>
          </div>
        </article>
      </div>

      <p v-else class="empty-copy">Click End Run to save the current session here. Closing the app also saves the run, and it will appear on the next launch.</p>
    </article>
  </section>
</template>
