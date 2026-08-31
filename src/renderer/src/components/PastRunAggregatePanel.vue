<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  MAX_PAST_RUN_ITEM_NAME_LENGTH,
  canonicalPastRunTrackerName,
  pastRunItemNameKey,
  type PastRunSummary,
} from "../../../shared/stats";
import { formatDuration, formatNumber } from "../lib/format";
import { itemIconUrl, resourceImage, TRANSPARENT_PIXEL_URL } from "../lib/item-assets";
import { ITEM_FILTER_SUGGESTION_LIMIT, type ItemFilterGroup } from "../lib/item-filters";
import { shoppingAutocompleteNames } from "../lib/item-options";
import { aggregateReportItemRows, exactTrackedItemRowId, hasReportItemDetailEntries, type PastRunAggregate } from "../lib/past-runs";
import {
  REPORT_EXACT_TRACKED_ITEM_LIMIT,
  withPostRunReportExactTrackedItems,
  type PostRunReportConfig,
} from "../lib/report-config";

const props = defineProps<{
  panelKey: string;
  title: string;
  subtitle: string;
  runs: PastRunSummary[];
  aggregate: PastRunAggregate;
  reportConfig: PostRunReportConfig;
  itemFilterGroups: ItemFilterGroup[];
}>();

const emit = defineEmits<{
  "update:reportConfig": [value: PostRunReportConfig];
}>();

const aggregateRows = computed(() => aggregateReportItemRows(props.runs, props.aggregate, props.reportConfig, props.itemFilterGroups));
const exactTrackedItems = computed(() => props.reportConfig.exactTrackedItems ?? []);
const exactRowIds = computed(() => new Set(exactTrackedItems.value.map(exactTrackedItemRowId)));
const summaryRows = computed(() => aggregateRows.value.filter((row) => !exactRowIds.value.has(row.id)));
const exactRows = computed(() => aggregateRows.value.filter((row) => exactRowIds.value.has(row.id)));
const detailRows = computed(() => summaryRows.value.filter((row) => hasReportItemDetailEntries(row.detailPanel)));
const draftItem = ref("");
const trackerInput = ref<HTMLInputElement | null>(null);
const trackerStatus = ref("");
const normalizedDraft = computed(() => canonicalPastRunTrackerName(draftItem.value));
const draftKey = computed(() => pastRunItemNameKey(normalizedDraft.value));
const trackedItemKeys = computed(() => new Set(exactTrackedItems.value.map(pastRunItemNameKey)));
const duplicateDraft = computed(() => Boolean(draftKey.value) && trackedItemKeys.value.has(draftKey.value));
const trackerLimitReached = computed(() => exactTrackedItems.value.length >= REPORT_EXACT_TRACKED_ITEM_LIMIT);
const canAddDraft = computed(() => Boolean(draftKey.value) && !duplicateDraft.value && !trackerLimitReached.value);
const trackerHint = computed(() => {
  if (trackerLimitReached.value) return `All ${REPORT_EXACT_TRACKED_ITEM_LIMIT} tracked item slots are in use.`;
  if (duplicateDraft.value) return `${normalizedDraft.value} is already tracked.`;
  return `Track up to ${REPORT_EXACT_TRACKED_ITEM_LIMIT} exact item names across this report.`;
});
const itemSuggestions = computed(() => {
  if (!draftKey.value || trackerLimitReached.value) return [];
  const suggestions = new Map<string, string>();
  for (const rawName of shoppingAutocompleteNames) {
    const name = canonicalPastRunTrackerName(rawName);
    const key = pastRunItemNameKey(name);
    const rawKey = pastRunItemNameKey(rawName);
    if (!key || trackedItemKeys.value.has(key)) continue;
    if (!key.includes(draftKey.value) && !rawKey.includes(draftKey.value)) continue;
    if (!suggestions.has(key)) suggestions.set(key, name);
    if (suggestions.size >= ITEM_FILTER_SUGGESTION_LIMIT) break;
  }
  return [...suggestions.values()];
});

function addTrackedItem() {
  if (!canAddDraft.value) return;
  const catalogName = shoppingAutocompleteNames.find((name) => pastRunItemNameKey(canonicalPastRunTrackerName(name)) === draftKey.value);
  const canonical = canonicalPastRunTrackerName(catalogName ?? normalizedDraft.value);
  emit("update:reportConfig", withPostRunReportExactTrackedItems(props.reportConfig, [...exactTrackedItems.value, canonical]));
  trackerStatus.value = `Tracking ${canonical}.`;
  draftItem.value = "";
  void nextTick(() => trackerInput.value?.focus());
}

function removeTrackedItem(name: string) {
  const key = pastRunItemNameKey(name);
  emit("update:reportConfig", withPostRunReportExactTrackedItems(
    props.reportConfig,
    exactTrackedItems.value.filter((item) => pastRunItemNameKey(item) !== key),
  ));
  trackerStatus.value = `Stopped tracking ${name}.`;
  void nextTick(() => trackerInput.value?.focus());
}
</script>

<template>
  <section class="past-run-aggregate">
    <div class="aggregate-heading">
      <div>
        <p class="eyebrow">Filtered run report</p>
        <h2 tabindex="-1" data-past-run-report-heading>{{ title }}</h2>
        <span>{{ subtitle }} &middot; Average duration {{ formatDuration(aggregate.averageDurationMs) }}</span>
      </div>
      <div class="aggregate-duration-total">
        <span>Total duration</span>
        <strong>{{ formatDuration(aggregate.totalDurationMs) }}</strong>
      </div>
    </div>
    <div v-if="summaryRows.length" class="aggregate-metrics dynamic-metrics" aria-label="Aggregate report summary">
      <div v-for="row in summaryRows" :key="`${panelKey}-${row.id}`" :data-report-item-id="row.id">
        <span>{{ row.label }}</span>
        <strong>{{ formatNumber(row.value) }}</strong>
        <small>{{ row.detail }}</small>
      </div>
    </div>
    <p v-else class="empty-copy">No standard report items selected.</p>

    <section class="past-run-exact-tracker" :aria-labelledby="`${panelKey}-exact-tracker-title`">
      <div class="past-run-exact-tracker-copy">
        <strong :id="`${panelKey}-exact-tracker-title`">Tracked items</strong>
        <small aria-live="polite" :class="{ 'is-warning': duplicateDraft || trackerLimitReached }">{{ trackerHint }}</small>
      </div>
      <form class="past-run-exact-tracker-form" @submit.prevent="addTrackedItem">
        <label>
          <span class="sr-only">Exact item name</span>
          <input
            ref="trackerInput"
            v-model="draftItem"
            type="search"
            :list="`${panelKey}-exact-item-suggestions`"
            autocomplete="off"
            spellcheck="false"
            :maxlength="MAX_PAST_RUN_ITEM_NAME_LENGTH"
            placeholder="Enter an exact item name"
            :aria-describedby="`${panelKey}-exact-tracker-help`"
          />
        </label>
        <datalist :id="`${panelKey}-exact-item-suggestions`">
          <option v-for="name in itemSuggestions" :key="name" :value="name"></option>
        </datalist>
        <button class="icon-button primary" type="submit" :disabled="!canAddDraft">Track item</button>
      </form>
      <p :id="`${panelKey}-exact-tracker-help`" class="past-run-exact-tracker-help">
        Uses totals saved with Past Runs; older runs may have partial normal-item coverage.
      </p>
      <span class="sr-only" aria-live="polite">{{ trackerStatus }}</span>
    </section>

    <div v-if="exactRows.length" class="aggregate-metrics aggregate-exact-metrics" aria-label="Exact tracked item totals">
      <div v-for="row in exactRows" :key="`${panelKey}-${row.id}`" :data-report-item-id="row.id">
        <span>{{ row.label }}</span>
        <strong>{{ formatNumber(row.value) }}</strong>
        <small>{{ row.detail }}</small>
        <button type="button" :aria-label="`Stop tracking ${row.label}`" @click="removeTrackedItem(row.label)">Remove</button>
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
  </section>
</template>
