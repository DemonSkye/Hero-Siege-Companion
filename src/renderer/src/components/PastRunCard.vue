<script setup lang="ts">
import { computed } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDateTime, formatDuration, formatNumber } from "../lib/format";
import { itemIconUrl, resourceImage } from "../lib/item-assets";
import { addTag, pastRunTitle, removeTag, runTags, sameTags } from "../lib/past-run-search";
import {
  createPastRunDiscordSummary,
  hasReportItemDetailEntries,
  runReportItemRows,
  type PastRunDropFilterGroup,
} from "../lib/past-runs";
import type { ItemFilterGroup } from "../lib/item-filters";
import type { PostRunReportConfig } from "../lib/report-config";
import RunTagMenu from "./RunTagMenu.vue";

const props = defineProps<{
  run: PastRunSummary;
  reportConfig: PostRunReportConfig;
  activeReportGroups: PastRunDropFilterGroup[];
  itemFilterGroups: ItemFilterGroup[];
  expanded: boolean;
  allRunTags: string[];
  tagMenuOpen: boolean;
}>();

const emit = defineEmits<{
  "toggle-expanded": [runId: string];
  "toggle-tag-menu": [run: PastRunSummary];
  "close-tag-menu": [];
  "update-run-tags": [runId: string, tags: string[]];
  "copy-run-summary": [summary: string];
}>();

const reportRows = computed(() => runReportItemRows(props.run, props.reportConfig, props.itemFilterGroups));
const detailRows = computed(() => reportRows.value.filter((row) => hasReportItemDetailEntries(row.detailPanel)));
const hasRunDetails = computed(() => detailRows.value.length > 0);

function addTagToRun(tag: string) {
  const nextTags = addTag(props.run, tag);
  if (sameTags(nextTags, runTags(props.run))) return;
  emit("update-run-tags", props.run.id, nextTags);
}

function removeTagFromRun(tag: string) {
  emit("update-run-tags", props.run.id, removeTag(props.run, tag));
}

function copyRunSummary() {
  emit("copy-run-summary", createPastRunDiscordSummary(props.run, {
    reportConfig: props.reportConfig,
    itemFilterGroups: props.itemFilterGroups,
    dropRarities: props.reportConfig.dropRarities,
    topDropLimit: props.reportConfig.topDropLimit,
    activeReportGroups: props.activeReportGroups,
  }));
}
</script>

<template>
  <section :class="['past-run-card', { expanded }]">
    <div class="past-run-header past-run-summary-row">
      <div class="past-run-header-main">
        <h3>{{ pastRunTitle(run) }}</h3>
        <div class="past-run-meta">
          <span>{{ formatDateTime(run.sessionStartedAt) }}</span>
          <span>{{ formatDuration(run.durationMs) }}</span>
        </div>
      </div>
      <div v-if="reportRows.length" class="past-run-metrics past-run-preview-metrics dynamic-metrics">
        <div v-for="row in reportRows" :key="`${run.id}-${row.id}`">
          <span>{{ row.label }}</span>
          <strong>{{ formatNumber(row.value) }}</strong>
          <small>{{ row.detail }}</small>
        </div>
      </div>
      <div class="past-run-header-actions">
        <button class="icon-button ghost past-run-copy-summary" type="button" @click="copyRunSummary">Copy Summary</button>
        <button class="tag-selector-button" type="button" :aria-expanded="tagMenuOpen" :aria-controls="`run-tag-menu-${run.id}`" @click="emit('toggle-tag-menu', run)">
          <span>Tag</span>
          <strong>{{ runTags(run)[0] ?? "Select" }}</strong>
        </button>
        <button
          v-if="hasRunDetails"
          class="icon-button ghost past-run-detail-toggle"
          type="button"
          :aria-expanded="expanded"
          :aria-controls="`past-run-details-${run.id}`"
          @click="emit('toggle-expanded', run.id)"
        >
          {{ expanded ? "Hide Details" : "Details" }}
        </button>
      </div>
    </div>

    <div v-if="runTags(run).length" class="past-run-tags" aria-label="Run tags">
      <span v-for="tag in runTags(run)" :key="`${run.id}-${tag}`" class="run-tag-chip">
        #{{ tag }}
        <button type="button" :aria-label="`Remove ${tag} tag`" @click="removeTagFromRun(tag)">x</button>
      </span>
    </div>

    <RunTagMenu
      v-if="tagMenuOpen"
      :id="`run-tag-menu-${run.id}`"
      :run="run"
      :all-run-tags="allRunTags"
      @add-tag="addTagToRun"
      @close="emit('close-tag-menu')"
    />

    <div v-if="expanded" :id="`past-run-details-${run.id}`" class="past-run-details">
      <section v-for="row in detailRows" :key="`${run.id}-${row.id}-details`" class="past-run-detail-panel">
        <div class="drop-breakdown-head">
          <strong>{{ row.label }}</strong>
          <span>{{ row.detail }}</span>
        </div>
        <div v-if="row.detailPanel?.kind === 'drops'">
          <div v-if="row.detailPanel.drops.length" class="drop-breakdown-list">
            <div v-for="drop in row.detailPanel.drops.slice(0, reportConfig.topDropLimit)" :key="`${run.id}-${row.id}-${drop.name}`" class="drop-breakdown-row">
              <img v-if="itemIconUrl(drop.name)" class="drop-breakdown-icon" :src="itemIconUrl(drop.name)" :alt="drop.name" />
              <span v-else class="drop-breakdown-icon drop-breakdown-icon-empty" aria-hidden="true"></span>
              <span class="drop-breakdown-name">{{ drop.name }}</span>
              <strong>{{ formatNumber(drop.total) }}</strong>
            </div>
          </div>
          <p v-else class="empty-copy">{{ row.detailPanel.empty }}</p>
        </div>
        <div v-else-if="row.detailPanel?.kind === 'resources'">
          <div v-if="row.detailPanel.resources.length" class="resource-list expanded">
            <div
              v-for="resource in row.detailPanel.resources"
              :key="`${run.id}-${row.id}-${resource.name}`"
              class="resource-chip"
              :class="{ 'resource-chip-no-image': !resourceImage(resource, row.detailPanel.imageKind) }"
            >
              <img v-if="resourceImage(resource, row.detailPanel.imageKind)" :src="resourceImage(resource, row.detailPanel.imageKind)" :alt="resource.name" />
              <span>{{ resource.name }}</span>
              <strong>{{ formatNumber(resource.total) }}</strong>
            </div>
          </div>
          <p v-else class="empty-copy">{{ row.detailPanel.empty }}</p>
        </div>
      </section>
    </div>
  </section>
</template>
