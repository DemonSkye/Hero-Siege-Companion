<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { RunStatus } from "../../../shared/app-state";
import { eventChecked, eventCurrentTargetElement, eventValue } from "../lib/dom-events";
import { formatDuration, formatNumber } from "../lib/format";
import {
  clampLiveRunTooltipPosition,
  formatLiveRunChartInspectionSummary,
  inspectLiveRunChartLanes,
  summarizeLiveRunLaneTrend,
} from "../lib/live-run-chart-inspection";
import {
  emptyLiveRunChartLane,
  liveRunChartHeight,
  liveRunChartStepPath,
  liveRunChartWidth,
} from "../lib/live-run-chart-geometry";
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

interface DisplayLane {
  lane: LiveRunChartLane;
  customItem: LiveRunCustomItem | null;
  path: string;
  width: number;
  height: number;
}

interface InspectionState {
  elapsedMs: number;
  ratio: number;
  source: "pointer" | "keyboard";
  clientX: number;
  clientY: number;
}

const draftItem = ref("");
const inspection = ref<InspectionState | null>(null);
const timeInspector = ref<HTMLInputElement | null>(null);
const inspectionTooltip = ref<HTMLElement | null>(null);
const inspectionTooltipPosition = ref({ left: 8, top: 8 });
let pointerInspectionCloseTimer: number | null = null;

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

const displayLanes = computed<readonly DisplayLane[]>(() => {
  const standards = LIVE_RUN_STANDARD_LANES
    .filter(({ metric }) => enabledStandardMetricSet.value.has(metric))
    .map(({ metric, label }) => {
      const lane = props.lanes.find((candidate) => candidate.metric === metric) ?? emptyLiveRunChartLane(metric, label);
      return toDisplayLane({ ...lane, label }, null);
    });
  const customs = props.customItems.slice(0, DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS).map((item) => {
    const lane = props.lanes.find((candidate) => candidate.id === item.seriesId)
      ?? emptyLiveRunChartLane("custom-item", item.name, item.seriesId, item.name);
    return toDisplayLane({ ...lane, label: item.name, itemName: item.name }, item);
  });
  return [...standards, ...customs];
});

const hasVisibleRunActivity = computed(() => displayLanes.value.some(({ lane }) =>
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
const elapsedLabel = computed(() => formatDuration(props.elapsedMs));
const elapsedRangeMaxSeconds = computed(() => Math.max(Math.ceil(props.elapsedMs / 1_000), 0));
const inspectionElapsedMs = computed(() => Math.min(
  Math.max(inspection.value?.source === "pointer"
    ? props.elapsedMs * inspection.value.ratio
    : inspection.value?.elapsedMs ?? 0, 0),
  Math.max(props.elapsedMs, 0),
));
const inspectionRatio = computed(() => inspection.value?.source === "pointer"
  ? inspection.value.ratio
  : props.elapsedMs > 0 ? inspectionElapsedMs.value / props.elapsedMs : 0,
);
const inspectionResult = computed(() => inspectLiveRunChartLanes(
  displayLanes.value.map(({ lane }) => lane),
  inspectionElapsedMs.value,
));
const inspectionValues = computed(() => new Map(
  inspectionResult.value.values.map((value) => [value.id, value]),
));
const inspectionSummary = computed(() => {
  if (!inspection.value || !inspectionResult.value.values.length) return "";
  return formatLiveRunChartInspectionSummary(inspectionResult.value.elapsedMs, inspectionResult.value.values);
});
const rangeAriaValueText = computed(() => inspectionSummary.value || formatLiveRunChartInspectionSummary(
  props.elapsedMs,
  inspectLiveRunChartLanes(displayLanes.value.map(({ lane }) => lane), props.elapsedMs).values,
));
const inspectionStyle = computed(() => ({
  left: `${inspectionTooltipPosition.value.left}px`,
  top: `${inspectionTooltipPosition.value.top}px`,
}));
const crosshairStyle = computed(() => ({
  left: `${inspectionRatio.value * 100}%`,
}));
const addHint = computed(() => {
  if (customLimitReached.value) return "Four custom item lanes are already in use.";
  if (duplicateDraft.value && normalizedDraft.value) return `Already tracking ${normalizedDraft.value}.`;
  return "Track up to four exact item names alongside the built-in metrics.";
});

watch(hasVisibleLanes, (visible) => {
  if (!visible) inspection.value = null;
});

watch(() => props.elapsedMs, (elapsedMs) => {
  if (inspection.value?.source === "keyboard" && inspection.value.elapsedMs > elapsedMs) {
    inspection.value = { ...inspection.value, elapsedMs: Math.max(elapsedMs, 0) };
  }
  if (inspection.value) refreshInspectionLayout();
});

watch(inspectionSummary, () => {
  if (inspection.value) void nextTick(positionInspectionTooltip);
});

onMounted(() => {
  window.addEventListener("resize", refreshInspectionLayout);
  document.addEventListener("keydown", dismissInspectionOnEscape);
});

onUnmounted(() => {
  cancelPointerInspectionClose();
  window.removeEventListener("resize", refreshInspectionLayout);
  document.removeEventListener("keydown", dismissInspectionOnEscape);
});

function addItem(name = normalizedDraft.value): void {
  const normalizedName = normalizeLiveRunItemName(name);
  if (!normalizedName || trackedItemKeys.value.has(itemKey(normalizedName)) || customLimitReached.value) return;
  emit("addCustomItem", normalizedName);
  draftItem.value = "";
}

function toDisplayLane(lane: LiveRunChartLane, customItem: LiveRunCustomItem | null): DisplayLane {
  const width = liveRunChartWidth(lane);
  const height = liveRunChartHeight(lane);
  return {
    lane,
    customItem,
    path: liveRunChartStepPath(lane, width),
    width,
    height,
  };
}

function itemKey(value: string): string {
  return canonicalLiveRunItemKey(value);
}

function inspectFromPointer(event: PointerEvent): void {
  cancelPointerInspectionClose();
  const target = eventCurrentTargetElement(event);
  if (!target) return;
  const bounds = target.getBoundingClientRect();
  if (bounds.width <= 0) return;
  const ratio = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
  showInspection(props.elapsedMs * ratio, ratio, "pointer", event.clientX, event.clientY);
}

function endPointerInspection(): void {
  if (inspection.value?.source !== "pointer") return;
  cancelPointerInspectionClose();
  pointerInspectionCloseTimer = window.setTimeout(() => {
    if (inspection.value?.source === "pointer") inspection.value = null;
    pointerInspectionCloseTimer = null;
  }, 80);
}

function cancelPointerInspectionClose(): void {
  if (pointerInspectionCloseTimer === null) return;
  window.clearTimeout(pointerInspectionCloseTimer);
  pointerInspectionCloseTimer = null;
}

function beginKeyboardInspection(event: FocusEvent): void {
  const target = eventCurrentTargetElement(event);
  const bounds = target?.getBoundingClientRect();
  showInspection(props.elapsedMs, 1, "keyboard", bounds?.right ?? 0, bounds?.top ?? 0);
}

function inspectFromRange(event: Event): void {
  const inspectedSeconds = Math.max(Number(eventValue(event)) || 0, 0);
  const bounds = eventCurrentTargetElement(event)?.getBoundingClientRect();
  const elapsedMs = Math.min(inspectedSeconds * 1_000, Math.max(props.elapsedMs, 0));
  const ratio = props.elapsedMs > 0 ? elapsedMs / props.elapsedMs : 0;
  showInspection(
    elapsedMs,
    ratio,
    "keyboard",
    bounds ? bounds.left + bounds.width * ratio : 0,
    bounds?.top ?? 0,
  );
}

function endKeyboardInspection(): void {
  if (inspection.value?.source === "keyboard") inspection.value = null;
}

function showInspection(
  elapsedMs: number,
  ratio: number,
  source: InspectionState["source"],
  clientX: number,
  clientY: number,
): void {
  inspection.value = {
    elapsedMs: Math.min(Math.max(elapsedMs, 0), Math.max(props.elapsedMs, 0)),
    ratio: Math.min(Math.max(ratio, 0), 1),
    source,
    clientX,
    clientY,
  };
  inspectionTooltipPosition.value = { left: clientX + 12, top: clientY + 12 };
  void nextTick(positionInspectionTooltip);
}

function dismissInspectionOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape" && inspection.value) inspection.value = null;
}

function positionInspectionTooltip(): void {
  const current = inspection.value;
  const tooltip = inspectionTooltip.value;
  if (!current || !tooltip) return;

  const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth, 0);
  const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight, 0);
  inspectionTooltipPosition.value = clampLiveRunTooltipPosition(
    current.clientX,
    current.clientY,
    tooltip.offsetWidth,
    tooltip.offsetHeight,
    viewportWidth,
    viewportHeight,
  );
}

function refreshInspectionLayout(): void {
  const current = inspection.value;
  if (current?.source === "keyboard") {
    const bounds = timeInspector.value?.getBoundingClientRect();
    if (bounds) {
      const ratio = props.elapsedMs > 0 ? inspectionElapsedMs.value / props.elapsedMs : 0;
      inspection.value = {
        ...current,
        ratio,
        clientX: bounds.left + bounds.width * ratio,
        clientY: bounds.top,
      };
    }
  }
  positionInspectionTooltip();
}

function inspectionPointStyle(display: DisplayLane): Record<string, string> {
  const value = inspectionValues.value.get(display.lane.id)?.value ?? 0;
  const scaleMax = Math.max(display.lane.maxValue, 1);
  return {
    ...crosshairStyle.value,
    top: `${100 - (value / scaleMax) * 100}%`,
  };
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
      Live-only history starts with this window. Item lanes use events observed here, and graphs are not saved to Past Runs.
    </p>

    <p v-if="hasVisibleLanes && !hasVisibleRunActivity" class="run-pace-empty-state">
      No activity in the visible lanes yet. History begins when this window starts observing the run.
    </p>

    <p v-if="!hasVisibleLanes" class="run-pace-empty-state run-pace-no-lanes">
      All graph lanes are hidden. Enable a built-in lane or track an exact item to show the graph.
    </p>

    <div
      v-if="hasVisibleLanes"
      class="run-pace-lanes"
      aria-label="Live run pace charts"
      @pointerleave="endPointerInspection"
    >
      <article
        v-for="display in displayLanes"
        :key="display.lane.id"
        :class="['run-pace-lane', `run-pace-lane-${display.lane.metric}`, { 'is-custom': display.customItem }]"
        :data-lane-id="display.lane.id"
      >
        <div class="run-pace-lane-summary">
          <span class="run-pace-lane-label">{{ display.lane.label }}</span>
          <strong>{{ formatNumber(display.lane.latestValue) }}</strong>
          <small>{{ display.lane.maxValue > 0 ? `Scale 0–${formatNumber(display.lane.maxValue)}` : "No change yet" }}</small>
          <span class="sr-only" data-run-pace-trend-summary>{{ summarizeLiveRunLaneTrend(display.lane) }}</span>
          <button
            v-if="display.customItem"
            class="run-pace-remove"
            type="button"
            :aria-label="`Stop tracking ${display.customItem.name}`"
            :title="`Stop tracking ${display.customItem.name}`"
            @click="$emit('removeCustomItem', display.customItem.seriesId)"
          >
            Remove
          </button>
        </div>
        <div class="run-pace-plot">
          <div
            class="run-pace-plot-surface"
            @pointermove="inspectFromPointer"
            @pointerdown="inspectFromPointer"
          >
            <svg
              :viewBox="`0 0 ${display.width} ${display.height}`"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              <line class="run-pace-grid-line" x1="0" :y1="display.height" :x2="display.width" :y2="display.height"></line>
              <line class="run-pace-grid-line run-pace-grid-line-mid" x1="0" :y1="display.height / 2" :x2="display.width" :y2="display.height / 2"></line>
              <path
                v-if="display.path"
                :class="['run-pace-line', { 'is-custom': display.customItem }]"
                :d="display.path"
              ></path>
            </svg>
            <span v-if="inspection" class="run-pace-crosshair" :style="crosshairStyle" aria-hidden="true"></span>
            <span v-if="inspection" class="run-pace-inspection-point" :style="inspectionPointStyle(display)" aria-hidden="true"></span>
          </div>
        </div>
      </article>
    </div>

    <div v-if="hasVisibleLanes" class="run-pace-time-axis" :aria-label="`Run time from 0:00 to ${elapsedLabel}`">
      <div class="run-pace-time-copy">
        <span>0:00</span>
        <small>Since graph started</small>
        <span>{{ elapsedLabel }}</span>
      </div>
      <label class="run-pace-time-inspector">
        <span class="sr-only">Inspect exact values by elapsed graph time</span>
        <input
          ref="timeInspector"
          type="range"
          min="0"
          :max="elapsedRangeMaxSeconds"
          step="1"
          :value="inspection ? Math.ceil(inspectionElapsedMs / 1_000) : elapsedRangeMaxSeconds"
          :aria-valuetext="rangeAriaValueText"
          @focus="beginKeyboardInspection"
          @input="inspectFromRange"
          @blur="endKeyboardInspection"
        />
      </label>
    </div>

    <Teleport to="body">
      <aside
        v-if="inspection && inspectionResult.values.length"
        ref="inspectionTooltip"
        class="run-pace-inspection-tooltip"
        :style="inspectionStyle"
        role="tooltip"
        data-run-pace-inspection
        @pointerenter="cancelPointerInspectionClose"
        @pointerleave="endPointerInspection"
      >
        <strong>{{ formatDuration(inspectionResult.elapsedMs) }} <small>since graph started</small></strong>
        <dl>
          <div v-for="value in inspectionResult.values" :key="value.id">
            <dt>{{ value.label }}</dt>
            <dd>{{ formatNumber(value.value) }}</dd>
          </div>
        </dl>
      </aside>
    </Teleport>
  </LiveDashboardCard>
</template>
