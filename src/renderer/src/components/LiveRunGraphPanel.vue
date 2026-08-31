<script setup lang="ts">
import { computed, ref } from "vue";
import type { RunStatus } from "../../../shared/app-state";
import { eventChecked } from "../lib/dom-events";
import { emptyLiveRunChartLane } from "../lib/live-run-chart-geometry";
import {
  canonicalLiveRunItemKey,
  DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS,
  LIVE_RUN_STANDARD_LANES,
  normalizeLiveRunItemName,
  type LiveRunChartLane,
  type LiveRunCustomItem,
  type LiveRunStandardMetric,
} from "../lib/live-run-history";
import LiveDashboardCard from "./LiveDashboardCard.vue";
import RunPaceChart from "./RunPaceChart.vue";

const MAX_SUGGESTIONS = 8;

const props = defineProps<{
  lanes: readonly LiveRunChartLane[];
  customItems: readonly LiveRunCustomItem[];
  enabledStandardMetrics: readonly LiveRunStandardMetric[];
  elapsedMs: number;
  runStatus: RunStatus;
  runPausedLabel: string;
  itemNameOptions: readonly string[];
}>();

const emit = defineEmits<{
  addCustomItem: [name: string];
  removeCustomItem: [seriesId: string];
  setStandardMetricEnabled: [metric: LiveRunStandardMetric, enabled: boolean];
}>();

const draftItem = ref("");

const trackedItemKeys = computed(() => new Set(props.customItems.map((item) => itemKey(item.name))));
const enabledStandardMetricSet = computed(() => new Set(props.enabledStandardMetrics));
const normalizedDraft = computed(() => normalizeLiveRunItemName(draftItem.value));
const duplicateDraft = computed(() => trackedItemKeys.value.has(itemKey(normalizedDraft.value)));
const customLimitReached = computed(() => props.customItems.length >= DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS);
const canAddDraft = computed(() => Boolean(normalizedDraft.value) && !duplicateDraft.value && !customLimitReached.value);
const suggestions = computed(() => {
  const query = itemKey(normalizedDraft.value);
  if (!query || customLimitReached.value) return [];

  const matches: Array<{ name: string; startsWithQuery: boolean }> = [];
  const seen = new Set<string>();
  for (const option of props.itemNameOptions) {
    const name = normalizeLiveRunItemName(option);
    const key = itemKey(name);
    if (!key || seen.has(key) || trackedItemKeys.value.has(key) || !key.includes(query)) continue;
    seen.add(key);
    matches.push({ name, startsWithQuery: key.startsWith(query) });
  }

  return matches
    .sort((left, right) => Number(right.startsWithQuery) - Number(left.startsWithQuery) || left.name.localeCompare(right.name))
    .slice(0, MAX_SUGGESTIONS)
    .map((match) => match.name);
});

const displayLanes = computed<readonly LiveRunChartLane[]>(() => {
  const standards = LIVE_RUN_STANDARD_LANES
    .filter(({ metric }) => enabledStandardMetricSet.value.has(metric))
    .map(({ metric, label }) => {
      const lane = props.lanes.find((candidate) => candidate.metric === metric) ?? emptyLiveRunChartLane(metric, label);
      return { ...lane, label };
    });
  const customs = props.customItems.slice(0, DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS).map((item) => {
    const lane = props.lanes.find((candidate) => candidate.id === item.seriesId)
      ?? emptyLiveRunChartLane("custom-item", item.name, item.seriesId, item.name);
    return { ...lane, label: item.name, itemName: item.name };
  });
  return [...standards, ...customs];
});

const hasVisibleRunActivity = computed(() => displayLanes.value.some((lane) =>
  lane.latestValue > 0 || lane.points.some((point) => point.value > 0),
));
const hasVisibleLanes = computed(() => displayLanes.value.length > 0);
const statusState = computed<"live" | "paused" | "waiting">(() => {
  if (props.runStatus === "paused") return "paused";
  return hasVisibleRunActivity.value ? "live" : "waiting";
});
const statusLabel = computed(() => {
  if (statusState.value === "paused") return props.runPausedLabel.trim() || "Paused";
  return statusState.value === "live" ? "Live" : "Waiting";
});
const removableLaneIds = computed(() => props.customItems.map((item) => item.seriesId));
const addHint = computed(() => {
  if (customLimitReached.value) return "Four custom item lanes are already in use.";
  if (duplicateDraft.value && normalizedDraft.value) return `Already tracking ${normalizedDraft.value}.`;
  return "Track up to four exact item names alongside the built-in metrics.";
});

function addItem(name = normalizedDraft.value): void {
  const normalizedName = normalizeLiveRunItemName(name);
  if (!normalizedName || trackedItemKeys.value.has(itemKey(normalizedName)) || customLimitReached.value) return;
  emit("addCustomItem", normalizedName);
  draftItem.value = "";
}

function itemKey(value: string): string {
  return canonicalLiveRunItemKey(value);
}
</script>

<template>
  <LiveDashboardCard id="run-pace-card" panel-class="run-pace-panel" title="Run Pace">
    <template #eyebrow>Live run</template>
    <template #title>Run Pace</template>
    <template #actions>
      <span :class="['run-pace-status', `is-${statusState}`]" role="status">
        <span class="run-pace-status-dot" aria-hidden="true"></span>
        {{ statusLabel }}
      </span>
    </template>

    <section class="run-pace-tracker" aria-labelledby="run-pace-tracker-title">
      <div class="run-pace-tracker-copy">
        <strong id="run-pace-tracker-title">Choose graph lanes</strong>
        <small :class="{ 'is-warning': duplicateDraft || customLimitReached }" aria-live="polite">{{ addHint }}</small>
      </div>
      <fieldset class="run-pace-standard-lanes">
        <legend class="sr-only">Built-in graph lanes</legend>
        <label v-for="standard in LIVE_RUN_STANDARD_LANES" :key="standard.metric">
          <input
            type="checkbox"
            :checked="enabledStandardMetricSet.has(standard.metric)"
            @change="$emit('setStandardMetricEnabled', standard.metric, eventChecked($event))"
          />
          <span>{{ standard.label }}</span>
        </label>
      </fieldset>
      <form class="run-pace-tracker-form" @submit.prevent="addItem()">
        <label class="run-pace-item-field">
          <span class="sr-only">Exact item name</span>
          <input
            v-model="draftItem"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="Enter an exact item name"
            aria-describedby="run-pace-tracker-title"
          />
        </label>
        <button class="icon-button primary run-pace-add" type="submit" :disabled="!canAddDraft">Track item</button>
      </form>
      <div v-if="suggestions.length" class="run-pace-suggestions" aria-label="Matching item names">
        <button
          v-for="name in suggestions"
          :key="name"
          type="button"
          @click="addItem(name)"
        >
          {{ name }}
        </button>
      </div>
    </section>

    <p class="run-pace-scope-note">
      This live view starts with this window. Run Pace history is saved when the run is archived.
    </p>

    <p v-if="hasVisibleLanes && !hasVisibleRunActivity" class="run-pace-empty-state">
      No activity in the visible lanes yet. History begins when this window starts observing the run.
    </p>

    <p v-if="!hasVisibleLanes" class="run-pace-empty-state run-pace-no-lanes">
      All graph lanes are hidden. Enable a built-in lane or track an exact item to show the graph.
    </p>

    <RunPaceChart
      v-if="hasVisibleLanes"
      :lanes="displayLanes"
      :elapsed-ms="elapsedMs"
      history-key="live"
      chart-label="Live run pace charts"
      :removable-lane-ids="removableLaneIds"
      @remove-lane="$emit('removeCustomItem', $event)"
    />
  </LiveDashboardCard>
</template>
