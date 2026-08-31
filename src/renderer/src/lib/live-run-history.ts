import { computed, readonly, shallowRef, watch, type Ref } from "vue";
import type { CompanionState } from "../../../shared/app-state";
import {
  canonicalRunPaceItemKey,
  normalizeRunPaceItemName,
  type PastRunPace,
  type RunPaceItemPoint,
} from "../../../shared/run-pace";
import type { ItemTimelineEntry } from "../../../shared/stats";

export type LiveRunStandardMetric = "xp" | "gold" | "kills" | "items";

export interface LiveRunObservation {
  runIdentity: string;
  sessionStartedAt: number;
  observedAt: number;
  elapsedMs: number;
  xp: number;
  gold: number;
  kills: number;
  itemTimeline: readonly ItemTimelineEntry[];
}

export interface LiveRunHistorySample {
  recordedAt: number;
  elapsedMs: number;
  xp: number;
  gold: number;
  kills: number;
  items: number;
  itemCounts: Readonly<Record<string, number>>;
}

export interface LiveRunCustomItem {
  key: string;
  name: string;
  seriesId: string;
}

export interface LiveRunChartPoint {
  elapsedMs: number;
  value: number;
  x: number;
  y: number;
}

export interface LiveRunChartLane {
  id: string;
  metric: LiveRunStandardMetric | "custom-item";
  label: string;
  itemName: string | null;
  chartWidth: number;
  chartHeight: number;
  latestValue: number;
  maxValue: number;
  points: readonly LiveRunChartPoint[];
  svgPoints: string;
}

export interface LiveRunHistoryRecorderOptions {
  maxSamples?: number;
  coalesceWindowMs?: number;
  maxCustomItems?: number;
  maxObservedItemEntries?: number;
}

export interface LiveRunHistoryRecorder {
  readonly samples: readonly LiveRunHistorySample[];
  readonly customItems: readonly LiveRunCustomItem[];
  record(observation: LiveRunObservation): readonly LiveRunHistorySample[];
  addCustomItem(name: string): boolean;
  removeCustomItem(nameOrKey: string): boolean;
  reset(clearCustomItems?: boolean): void;
}

export interface UseLiveRunHistoryOptions extends LiveRunHistoryRecorderOptions {
  state: Ref<CompanionState>;
  now: Ref<number>;
  ready?: Ref<boolean>;
  chartWidth?: number;
  chartHeight?: number;
}

export const LIVE_RUN_STANDARD_LANES: ReadonlyArray<{ metric: LiveRunStandardMetric; label: string }> = [
  { metric: "xp", label: "XP" },
  { metric: "gold", label: "Gold" },
  { metric: "kills", label: "Kills" },
  { metric: "items", label: "Items" },
];

const LIVE_RUN_STANDARD_METRIC_SET = new Set<LiveRunStandardMetric>(
  LIVE_RUN_STANDARD_LANES.map(({ metric }) => metric),
);

export const DEFAULT_LIVE_RUN_MAX_SAMPLES = 240;
export const DEFAULT_LIVE_RUN_COALESCE_WINDOW_MS = 2_000;
export const DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS = 4;
export const DEFAULT_LIVE_RUN_CHART_WIDTH = 1_000;
export const DEFAULT_LIVE_RUN_CHART_HEIGHT = 160;
const DEFAULT_MAX_OBSERVED_ITEM_ENTRIES = 2_048;
const MAX_CUSTOM_ITEM_NAME_LENGTH = 120;

export function liveRunObservationFromState(state: CompanionState, observedAt = Date.now()): LiveRunObservation {
  const startedAt = finiteNonNegative(state.stats.sessionStartedAt);
  const pausedNowMs =
    state.runStatus === "paused" && state.runPausedAt !== null
      ? Math.max(observedAt - state.runPausedAt, 0)
      : 0;
  const elapsedMs = Math.max(observedAt - startedAt - finiteNonNegative(state.runPausedDurationMs) - pausedNowMs, 0);

  return {
    runIdentity: String(startedAt),
    sessionStartedAt: startedAt,
    observedAt,
    elapsedMs,
    xp: finiteNonNegative(state.stats.totalXpEarned),
    gold: finiteNonNegative(state.stats.totalGoldEarned),
    kills: finiteNonNegative(state.stats.totalKillsEarned),
    itemTimeline: state.stats.itemTimeline,
  };
}

export function createLiveRunHistoryRecorder(options: LiveRunHistoryRecorderOptions = {}): LiveRunHistoryRecorder {
  const maxSamples = boundedInteger(options.maxSamples, DEFAULT_LIVE_RUN_MAX_SAMPLES, 2, 2_000);
  const coalesceWindowMs = boundedInteger(
    options.coalesceWindowMs,
    DEFAULT_LIVE_RUN_COALESCE_WINDOW_MS,
    0,
    60_000,
  );
  const maxCustomItems = boundedInteger(options.maxCustomItems, DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS, 1, 32);
  const maxObservedItemEntries = boundedInteger(
    options.maxObservedItemEntries,
    DEFAULT_MAX_OBSERVED_ITEM_ENTRIES,
    500,
    20_000,
  );

  let samples: readonly LiveRunHistorySample[] = [];
  let customItems: readonly LiveRunCustomItem[] = [];
  let runIdentity: string | null = null;
  let sessionStartedAt: number | null = null;
  let itemTotal = 0;
  let itemCounts = new Map<string, number>();
  let itemLabels = new Map<string, string>();
  let observedItemIds = new Set<string>();
  let observedItemIdOrder: string[] = [];

  const recorder: LiveRunHistoryRecorder = {
    get samples() {
      return samples;
    },
    get customItems() {
      return customItems;
    },
    record(observation) {
      const nextRunIdentity = String(observation.runIdentity);
      const nextStartedAt = finiteNonNegative(observation.sessionStartedAt);
      let includeRunBaseline = false;
      if (runIdentity !== nextRunIdentity || sessionStartedAt !== nextStartedAt) {
        includeRunBaseline = runIdentity !== null;
        resetRun(nextRunIdentity, nextStartedAt);
      } else if (cumulativeMetricsDecreased(samples.at(-1), observation)) {
        resetRun(nextRunIdentity, nextStartedAt);
      }

      ingestTimeline(observation.itemTimeline);
      const elapsedMs = Math.max(
        finiteNonNegative(observation.elapsedMs),
        samples.at(-1)?.elapsedMs ?? 0,
      );
      const nextSample = makeSample(observation, elapsedMs);

      if (samples.length === 0) {
        samples = includeRunBaseline && elapsedMs > 0
          ? [emptySample(nextStartedAt), nextSample]
          : [nextSample];
        return samples;
      }

      const previous = samples.at(-1)!;
      if (sameSampleValues(previous, nextSample)) {
        if (previous.elapsedMs === nextSample.elapsedMs) return samples;
        const previousIsPlateauEndpoint = samples.length > 1
          && sameSampleValues(samples.at(-2)!, previous);
        samples = previousIsPlateauEndpoint
          ? [...samples.slice(0, -1), nextSample]
          : [...samples, nextSample];
        samples = evenlyBoundSamples(samples, maxSamples);
        return samples;
      }

      if (previous.elapsedMs > 0 && nextSample.elapsedMs - previous.elapsedMs <= coalesceWindowMs) {
        samples = [...samples.slice(0, -1), nextSample];
      } else {
        samples = [...samples, nextSample];
      }
      samples = evenlyBoundSamples(samples, maxSamples);
      return samples;
    },
    addCustomItem(name) {
      const normalizedName = normalizeLiveRunItemName(name);
      const key = canonicalLiveRunItemKey(normalizedName);
      if (!key || customItems.some((item) => item.key === key) || customItems.length >= maxCustomItems) return false;
      const displayName = itemLabels.get(key) ?? normalizedName;
      customItems = [...customItems, { key, name: displayName, seriesId: `item:${key}` }];
      return true;
    },
    removeCustomItem(nameOrKey) {
      const key = canonicalLiveRunItemKey(nameOrKey.startsWith("item:") ? nameOrKey.slice(5) : nameOrKey);
      const nextItems = customItems.filter((item) => item.key !== key);
      if (nextItems.length === customItems.length) return false;
      customItems = nextItems;
      return true;
    },
    reset(clearCustomItems = false) {
      resetRun(null, null);
      if (clearCustomItems) customItems = [];
    },
  };

  return recorder;

  function resetRun(nextRunIdentity: string | null, nextStartedAt: number | null): void {
    runIdentity = nextRunIdentity;
    sessionStartedAt = nextStartedAt;
    samples = [];
    itemTotal = 0;
    itemCounts = new Map();
    itemLabels = new Map();
    observedItemIds = new Set();
    observedItemIdOrder = [];
  }

  function ingestTimeline(entries: readonly ItemTimelineEntry[]): void {
    const occurrenceCounts = new Map<string, number>();
    for (const entry of [...entries].reverse()) {
      const baseIdentity = itemEntryIdentity(entry);
      const occurrence = (occurrenceCounts.get(baseIdentity) ?? 0) + 1;
      occurrenceCounts.set(baseIdentity, occurrence);
      const identity = entry.fingerprint?.trim() ? baseIdentity : `${baseIdentity}|${occurrence}`;
      if (observedItemIds.has(identity)) continue;

      observedItemIds.add(identity);
      observedItemIdOrder.push(identity);
      while (observedItemIdOrder.length > maxObservedItemEntries) {
        observedItemIds.delete(observedItemIdOrder.shift()!);
      }

      const amount = itemAmount(entry.amount);
      itemTotal += amount;
      const name = normalizeLiveRunItemName(entry.label);
      const key = canonicalLiveRunItemKey(name);
      if (!key) continue;
      itemCounts.set(key, (itemCounts.get(key) ?? 0) + amount);
      itemLabels.set(key, name);
    }
  }

  function makeSample(observation: LiveRunObservation, elapsedMs: number): LiveRunHistorySample {
    return {
      recordedAt: finiteNonNegative(observation.observedAt),
      elapsedMs,
      xp: finiteNonNegative(observation.xp),
      gold: finiteNonNegative(observation.gold),
      kills: finiteNonNegative(observation.kills),
      items: itemTotal,
      itemCounts: Object.fromEntries(itemCounts),
    };
  }
}

export function projectLiveRunChartLanes(
  samples: readonly LiveRunHistorySample[],
  customItems: readonly LiveRunCustomItem[],
  width = DEFAULT_LIVE_RUN_CHART_WIDTH,
  height = DEFAULT_LIVE_RUN_CHART_HEIGHT,
): readonly LiveRunChartLane[] {
  const chartWidth = Math.max(finiteNonNegative(width), 1);
  const chartHeight = Math.max(finiteNonNegative(height), 1);
  const elapsedStart = samples[0]?.elapsedMs ?? 0;
  const elapsedEnd = Math.max(...samples.map((sample) => sample.elapsedMs), elapsedStart);
  const elapsedSpan = Math.max(elapsedEnd - elapsedStart, 1);
  const lanes = LIVE_RUN_STANDARD_LANES.map(({ metric, label }) =>
    chartLane(metric, metric, label, null, (sample) => sample[metric]),
  );
  lanes.push(
    ...customItems.map((item) =>
      chartLane(item.seriesId, "custom-item", item.name, item.name, (sample) => sample.itemCounts[item.key] ?? 0),
    ),
  );
  return lanes;

  function chartLane(
    id: string,
    metric: LiveRunChartLane["metric"],
    label: string,
    itemName: string | null,
    valueFor: (sample: LiveRunHistorySample) => number,
  ): LiveRunChartLane {
    const values = samples.map((sample) => finiteNonNegative(valueFor(sample)));
    const maxValue = Math.max(...values, 0);
    const scaleMax = Math.max(maxValue, 1);
    const points = samples.map((sample, index) => {
      const value = values[index] ?? 0;
      return {
        elapsedMs: sample.elapsedMs,
        value,
        x: ((sample.elapsedMs - elapsedStart) / elapsedSpan) * chartWidth,
        y: chartHeight - (value / scaleMax) * chartHeight,
      };
    });
    return {
      id,
      metric,
      label,
      itemName,
      chartWidth,
      chartHeight,
      latestValue: values.at(-1) ?? 0,
      maxValue,
      points,
      svgPoints: points.map((point) => `${roundedCoordinate(point.x)},${roundedCoordinate(point.y)}`).join(" "),
    };
  }
}

export function projectPastRunPaceChartLanes(
  pace: PastRunPace,
  exactItemNames: readonly string[],
  width = DEFAULT_LIVE_RUN_CHART_WIDTH,
  height = DEFAULT_LIVE_RUN_CHART_HEIGHT,
): readonly LiveRunChartLane[] {
  const chartWidth = Math.max(finiteNonNegative(width), 1);
  const chartHeight = Math.max(finiteNonNegative(height), 1);
  const elapsedStart = pace.samples[0]?.elapsedMs ?? 0;
  const elapsedEnd = Math.max(pace.samples.at(-1)?.elapsedMs ?? elapsedStart, elapsedStart);
  const lanes = LIVE_RUN_STANDARD_LANES.map(({ metric, label }) => chartLaneFromPoints(
    metric,
    metric,
    label,
    null,
    pace.samples.map((sample) => ({ elapsedMs: sample.elapsedMs, value: sample[metric] })),
  ));

  const seriesByKey = new Map(pace.itemSeries.map((series) => [canonicalRunPaceItemKey(series.name), series]));
  const seen = new Set<string>();
  for (const rawName of exactItemNames) {
    const name = normalizeLiveRunItemName(rawName);
    const key = canonicalRunPaceItemKey(name);
    if (!name || !key || seen.has(key) || seen.size >= DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS) continue;
    seen.add(key);
    const series = seriesByKey.get(key);
    if (!series && pace.itemSeriesTruncated) continue;
    const itemPoints = savedItemSeriesPoints(series?.points ?? [], elapsedStart, elapsedEnd);
    lanes.push(chartLaneFromPoints(`item:${key}`, "custom-item", series?.name ?? name, series?.name ?? name, itemPoints));
  }
  return lanes;

  function chartLaneFromPoints(
    id: string,
    metric: LiveRunChartLane["metric"],
    label: string,
    itemName: string | null,
    rawPoints: readonly { elapsedMs: number; value: number }[],
  ): LiveRunChartLane {
    const elapsedSpan = Math.max(elapsedEnd - elapsedStart, 1);
    const values = rawPoints.map((point) => finiteNonNegative(point.value));
    const maxValue = Math.max(...values, 0);
    const scaleMax = Math.max(maxValue, 1);
    const points = rawPoints.map((point, index) => {
      const value = values[index] ?? 0;
      return {
        elapsedMs: point.elapsedMs,
        value,
        x: ((point.elapsedMs - elapsedStart) / elapsedSpan) * chartWidth,
        y: chartHeight - (value / scaleMax) * chartHeight,
      };
    });
    return {
      id,
      metric,
      label,
      itemName,
      chartWidth,
      chartHeight,
      latestValue: values.at(-1) ?? 0,
      maxValue,
      points,
      svgPoints: points.map((point) => `${roundedCoordinate(point.x)},${roundedCoordinate(point.y)}`).join(" "),
    };
  }
}

export function useLiveRunHistory({
  state,
  now,
  ready,
  chartWidth = DEFAULT_LIVE_RUN_CHART_WIDTH,
  chartHeight = DEFAULT_LIVE_RUN_CHART_HEIGHT,
  ...recorderOptions
}: UseLiveRunHistoryOptions) {
  const recorder = createLiveRunHistoryRecorder(recorderOptions);
  const samples = shallowRef(recorder.samples);
  const customItems = shallowRef(recorder.customItems);
  const enabledStandardMetrics = shallowRef<readonly LiveRunStandardMetric[]>(
    LIVE_RUN_STANDARD_LANES.map(({ metric }) => metric),
  );
  const lanes = computed(() => projectLiveRunChartLanes(samples.value, customItems.value, chartWidth, chartHeight));
  const elapsedMs = computed(() => Math.max(
    (samples.value.at(-1)?.elapsedMs ?? 0) - (samples.value[0]?.elapsedMs ?? 0),
    0,
  ));

  watch([state, now, () => ready?.value ?? true], ([nextState, observedAt, isReady]) => {
    if (!isReady) return;
    samples.value = recorder.record(liveRunObservationFromState(nextState, observedAt));
  }, { immediate: true, flush: "sync" });

  return {
    samples: readonly(samples),
    customItems: readonly(customItems),
    enabledStandardMetrics: readonly(enabledStandardMetrics),
    lanes,
    elapsedMs,
    addCustomItem(name: string) {
      const added = recorder.addCustomItem(name);
      customItems.value = recorder.customItems;
      return added;
    },
    removeCustomItem(nameOrKey: string) {
      const removed = recorder.removeCustomItem(nameOrKey);
      customItems.value = recorder.customItems;
      return removed;
    },
    setStandardMetricEnabled(metric: LiveRunStandardMetric, enabled: boolean) {
      if (!LIVE_RUN_STANDARD_METRIC_SET.has(metric)) return false;
      const currentlyEnabled = enabledStandardMetrics.value.includes(metric);
      if (currentlyEnabled === enabled) return false;
      enabledStandardMetrics.value = enabled
        ? LIVE_RUN_STANDARD_LANES
          .map(({ metric: candidate }) => candidate)
          .filter((candidate) => candidate === metric || enabledStandardMetrics.value.includes(candidate))
        : enabledStandardMetrics.value.filter((candidate) => candidate !== metric);
      return true;
    },
    resetHistory(clearCustomItems = false) {
      recorder.reset(clearCustomItems);
      samples.value = recorder.samples;
      customItems.value = recorder.customItems;
    },
  };
}

export function normalizeLiveRunItemName(value: string): string {
  return normalizeRunPaceItemName(value).slice(0, MAX_CUSTOM_ITEM_NAME_LENGTH);
}

export function canonicalLiveRunItemKey(value: string): string {
  return canonicalRunPaceItemKey(value);
}

function savedItemSeriesPoints(
  points: readonly RunPaceItemPoint[],
  elapsedStart: number,
  elapsedEnd: number,
): readonly RunPaceItemPoint[] {
  const output: RunPaceItemPoint[] = [];
  const first = points[0];
  if (!first || first.elapsedMs > elapsedStart) output.push({ elapsedMs: elapsedStart, value: 0 });
  output.push(...points.map((point) => ({ ...point })));
  const last = output.at(-1);
  if (!last || last.elapsedMs < elapsedEnd) output.push({ elapsedMs: elapsedEnd, value: last?.value ?? 0 });
  return output;
}

function itemEntryIdentity(entry: ItemTimelineEntry): string {
  const fingerprint = entry.fingerprint?.trim();
  if (fingerprint) return `fingerprint:${fingerprint}`;
  return [
    entry.createdAt,
    entry.source,
    entry.repository,
    entry.type,
    entry.weaponType,
    entry.id,
    entry.seed,
    entry.dropQuality,
    entry.amount,
    entry.mfDrop ? 1 : 0,
    canonicalLiveRunItemKey(entry.label),
  ].join("|");
}

function emptySample(sessionStartedAt: number): LiveRunHistorySample {
  return {
    recordedAt: sessionStartedAt,
    elapsedMs: 0,
    xp: 0,
    gold: 0,
    kills: 0,
    items: 0,
    itemCounts: {},
  };
}

function sameSampleValues(left: LiveRunHistorySample, right: LiveRunHistorySample): boolean {
  return left.xp === right.xp && left.gold === right.gold && left.kills === right.kills && left.items === right.items;
}

function cumulativeMetricsDecreased(
  previous: LiveRunHistorySample | undefined,
  observation: LiveRunObservation,
): boolean {
  if (!previous) return false;
  return finiteNonNegative(observation.xp) < previous.xp
    || finiteNonNegative(observation.gold) < previous.gold
    || finiteNonNegative(observation.kills) < previous.kills;
}

function evenlyBoundSamples(
  samples: readonly LiveRunHistorySample[],
  maxSamples: number,
): readonly LiveRunHistorySample[] {
  if (samples.length <= maxSamples) return samples;
  const bounded: LiveRunHistorySample[] = [];
  for (let position = 0; position < maxSamples; position += 1) {
    const index = Math.round((position * (samples.length - 1)) / (maxSamples - 1));
    bounded.push(samples[index]!);
  }
  return bounded;
}

function itemAmount(value: number): number {
  return Math.max(Math.trunc(Number.isFinite(value) ? value : 0) || 1, 1);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value!), minimum), maximum);
}

function roundedCoordinate(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}
