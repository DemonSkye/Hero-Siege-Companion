<script setup lang="ts">
import { computed } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDuration, formatNumber } from "../lib/format";
import { itemIconUrl, resourceImage, TRANSPARENT_PIXEL_URL } from "../lib/item-assets";
import { aggregateReportItemRows, hasReportItemDetailEntries, type PastRunAggregate } from "../lib/past-runs";
import type { ItemFilterGroup } from "../lib/item-filters";
import type { PostRunReportConfig } from "../lib/report-config";

const props = defineProps<{
  panelKey: string;
  title: string;
  subtitle: string;
  runs: PastRunSummary[];
  aggregate: PastRunAggregate;
  reportConfig: PostRunReportConfig;
  itemFilterGroups: ItemFilterGroup[];
}>();

const aggregateRows = computed(() => aggregateReportItemRows(props.runs, props.aggregate, props.reportConfig, props.itemFilterGroups));
const detailRows = computed(() => aggregateRows.value.filter((row) => hasReportItemDetailEntries(row.detailPanel)));
</script>

<template>
  <section class="past-run-aggregate">
    <div class="aggregate-heading">
      <div>
        <h3>{{ title }}</h3>
        <span>{{ subtitle }} &middot; Average duration {{ formatDuration(aggregate.averageDurationMs) }}</span>
      </div>
      <div class="aggregate-duration-total">
        <span>Total duration</span>
        <strong>{{ formatDuration(aggregate.totalDurationMs) }}</strong>
      </div>
    </div>
    <div v-if="aggregateRows.length" class="aggregate-metrics dynamic-metrics">
      <div v-for="row in aggregateRows" :key="`${panelKey}-${row.id}`">
        <span>{{ row.label }}</span>
        <strong>{{ formatNumber(row.value) }}</strong>
        <small>{{ row.detail }}</small>
      </div>
    </div>
    <div v-if="detailRows.length" class="aggregate-detail-grid">
      <section v-for="row in detailRows" :key="`${panelKey}-${row.id}-detail`" class="aggregate-detail-panel">
        <div class="drop-breakdown-head">
          <strong>{{ row.label }}</strong>
          <span>{{ row.detail }}</span>
        </div>
        <div v-if="row.detailPanel?.kind === 'drops'">
          <div v-if="row.detailPanel.drops.length" class="aggregate-top-list">
            <div v-for="drop in row.detailPanel.drops.slice(0, reportConfig.topDropLimit)" :key="`${panelKey}-${row.id}-${drop.name}`">
              <img class="drop-breakdown-icon" :src="itemIconUrl(drop.name) || TRANSPARENT_PIXEL_URL" :alt="itemIconUrl(drop.name) ? drop.name : ''" />
              <span class="drop-breakdown-name">{{ drop.name }}</span>
              <strong>{{ formatNumber(drop.total) }}</strong>
            </div>
          </div>
          <small v-else>{{ row.detailPanel.empty }}</small>
        </div>
        <div v-else-if="row.detailPanel?.kind === 'resources'">
          <div v-if="row.detailPanel.resources.length" class="resource-list expanded">
            <div
              v-for="resource in row.detailPanel.resources"
              :key="`${panelKey}-${row.id}-${resource.name}`"
              class="resource-chip"
              :class="{ 'resource-chip-no-image': !resourceImage(resource, row.detailPanel.imageKind) }"
            >
              <img v-if="resourceImage(resource, row.detailPanel.imageKind)" :src="resourceImage(resource, row.detailPanel.imageKind)" :alt="resource.name" />
              <span>{{ resource.name }}</span>
              <strong>{{ formatNumber(resource.total) }}</strong>
            </div>
          </div>
          <small v-else>{{ row.detailPanel.empty }}</small>
        </div>
      </section>
    </div>
    <p v-if="!aggregateRows.length" class="empty-copy">No summary row items selected.</p>
  </section>
</template>
