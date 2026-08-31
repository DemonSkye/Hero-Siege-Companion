<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { eventCurrentTargetElement, eventValue } from "../lib/dom-events";
import { formatDuration, formatNumber } from "../lib/format";
import {
  clampLiveRunTooltipPosition,
  formatLiveRunChartInspectionSummary,
  inspectLiveRunChartLanes,
  summarizeLiveRunLaneTrend,
} from "../lib/live-run-chart-inspection";
import {
  liveRunChartHeight,
  liveRunChartStepPath,
  liveRunChartWidth,
} from "../lib/live-run-chart-geometry";
import type { LiveRunChartLane } from "../lib/live-run-history";

const props = withDefaults(defineProps<{
  lanes: readonly LiveRunChartLane[];
  elapsedMs: number;
  historyKey: string;
  chartLabel?: string;
  axisLabel?: string;
  inspectionContext?: string;
  inspectionControlLabel?: string;
  trendOrigin?: string;
  removableLaneIds?: readonly string[];
}>(), {
  chartLabel: "Run pace charts",
  axisLabel: "Since graph started",
  inspectionContext: "since graph started",
  inspectionControlLabel: "Inspect exact values by elapsed graph time",
  trendOrigin: "graph tracking began",
  removableLaneIds: () => [],
});

const emit = defineEmits<{
  removeLane: [laneId: string];
}>();

interface DisplayLane {
  lane: LiveRunChartLane;
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

const inspection = ref<InspectionState | null>(null);
const timeInspector = ref<HTMLInputElement | null>(null);
const inspectionTooltip = ref<HTMLElement | null>(null);
const inspectionTooltipPosition = ref({ left: 8, top: 8 });
let pointerInspectionCloseTimer: number | null = null;

const displayLanes = computed<readonly DisplayLane[]>(() => props.lanes.map(toDisplayLane));
const removableLaneIdSet = computed(() => new Set(props.removableLaneIds));
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
const inspectionResult = computed(() => inspectLiveRunChartLanes(props.lanes, inspectionElapsedMs.value));
const inspectionValues = computed(() => new Map(
  inspectionResult.value.values.map((value) => [value.id, value]),
));
const inspectionSummary = computed(() => {
  if (!inspection.value || !inspectionResult.value.values.length) return "";
  return formatLiveRunChartInspectionSummary(
    inspectionResult.value.elapsedMs,
    inspectionResult.value.values,
    props.inspectionContext,
  );
});
const rangeAriaValueText = computed(() => inspectionSummary.value || formatLiveRunChartInspectionSummary(
  props.elapsedMs,
  inspectLiveRunChartLanes(props.lanes, props.elapsedMs).values,
  props.inspectionContext,
));
const inspectionStyle = computed(() => ({
  left: `${inspectionTooltipPosition.value.left}px`,
  top: `${inspectionTooltipPosition.value.top}px`,
}));
const crosshairStyle = computed(() => ({
  left: `${inspectionRatio.value * 100}%`,
}));

watch(() => props.historyKey, () => {
  closeInspection();
});

watch(() => props.lanes.length, (laneCount) => {
  if (!laneCount) closeInspection();
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

function toDisplayLane(lane: LiveRunChartLane): DisplayLane {
  const width = liveRunChartWidth(lane);
  const height = liveRunChartHeight(lane);
  return {
    lane,
    path: liveRunChartStepPath(lane, width),
    width,
    height,
  };
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

function closeInspection(): void {
  cancelPointerInspectionClose();
  inspection.value = null;
}

function dismissInspectionOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape" && inspection.value) closeInspection();
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
  <div v-if="displayLanes.length" class="run-pace-chart" :data-run-pace-history-key="historyKey">
    <div
      class="run-pace-lanes"
      :aria-label="chartLabel"
      @pointerleave="endPointerInspection"
    >
      <article
        v-for="display in displayLanes"
        :key="display.lane.id"
        :class="[
          'run-pace-lane',
          `run-pace-lane-${display.lane.metric}`,
          {
            'is-custom': display.lane.metric === 'custom-item',
            'has-removal': removableLaneIdSet.has(display.lane.id),
          },
        ]"
        :data-lane-id="display.lane.id"
      >
        <div class="run-pace-lane-summary">
          <span class="run-pace-lane-label">{{ display.lane.label }}</span>
          <strong>{{ formatNumber(display.lane.latestValue) }}</strong>
          <small>{{ display.lane.maxValue > 0 ? `Scale 0–${formatNumber(display.lane.maxValue)}` : "No change yet" }}</small>
          <span class="sr-only" data-run-pace-trend-summary>{{ summarizeLiveRunLaneTrend(display.lane, trendOrigin) }}</span>
          <button
            v-if="removableLaneIdSet.has(display.lane.id)"
            class="run-pace-remove"
            type="button"
            :aria-label="`Stop tracking ${display.lane.itemName ?? display.lane.label}`"
            :title="`Stop tracking ${display.lane.itemName ?? display.lane.label}`"
            @click="emit('removeLane', display.lane.id)"
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
                :class="['run-pace-line', { 'is-custom': display.lane.metric === 'custom-item' }]"
                :d="display.path"
              ></path>
            </svg>
            <span v-if="inspection" class="run-pace-crosshair" :style="crosshairStyle" aria-hidden="true"></span>
            <span v-if="inspection" class="run-pace-inspection-point" :style="inspectionPointStyle(display)" aria-hidden="true"></span>
          </div>
        </div>
      </article>
    </div>

    <div class="run-pace-time-axis" :aria-label="`Run time from 0:00 to ${elapsedLabel}`">
      <div class="run-pace-time-copy">
        <span>0:00</span>
        <small>{{ axisLabel }}</small>
        <span>{{ elapsedLabel }}</span>
      </div>
      <label class="run-pace-time-inspector">
        <span class="sr-only">{{ inspectionControlLabel }}</span>
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
        <strong>{{ formatDuration(inspectionResult.elapsedMs) }} <small>{{ inspectionContext }}</small></strong>
        <dl>
          <div v-for="value in inspectionResult.values" :key="value.id">
            <dt>{{ value.label }}</dt>
            <dd>{{ formatNumber(value.value) }}</dd>
          </div>
        </dl>
      </aside>
    </Teleport>
  </div>
</template>
