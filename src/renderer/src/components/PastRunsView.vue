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
import { aggregatePastRuns } from "../lib/past-runs";
import type { PostRunReportConfig } from "../lib/report-config";

const props = defineProps<{
  pastRuns: PastRunSummary[];
  expandedDropKey: string | null;
  reportConfig: PostRunReportConfig;
}>();

const emit = defineEmits<{
  "update:expandedDropKey": [value: string | null];
  "update:reportConfig": [value: PostRunReportConfig];
  "update-run-tags": [runId: string, tags: string[]];
}>();

const showReportConfig = ref(false);
const runSearchQuery = ref("");
const activeTagRunId = ref<string | null>(null);

const activeReportGroups = computed(() => props.reportConfig.itemGroups.filter((group) => group.enabled));
const allRunTags = computed(() => uniquePastRunTags(props.pastRuns));
const searchTerms = computed(() => termsForSearch(runSearchQuery.value));
const filteredPastRuns = computed(() => filterPastRunsBySearch(props.pastRuns, searchTerms.value));
const allRunAggregate = computed(() => aggregatePastRuns(filteredPastRuns.value, props.reportConfig.dropRarities, props.reportConfig.topDropLimit, [], activeReportGroups.value));
const recentRunAggregate = computed(() => aggregatePastRuns(filteredPastRuns.value.slice(0, 10), props.reportConfig.dropRarities, props.reportConfig.topDropLimit, [], activeReportGroups.value));
const aggregatePanels = computed(() => [
  { key: "all", title: searchTerms.value.length ? "Matching Runs" : "All Runs", subtitle: `${allRunAggregate.value.runCount} saved`, aggregate: allRunAggregate.value },
  { key: "recent", title: searchTerms.value.length ? "Recent Matches" : "Last 10 Runs", subtitle: `${recentRunAggregate.value.runCount} included`, aggregate: recentRunAggregate.value },
]);
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
          <span class="past-run-count">{{ pastRunCountLabel }}</span>
        </div>
      </div>

      <PastRunReportConfigModal
        v-if="showReportConfig"
        :report-config="reportConfig"
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
