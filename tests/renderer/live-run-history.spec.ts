import { effectScope, nextTick, ref } from "vue";
import { describe, expect, test } from "vitest";

import {
  createLiveRunHistoryRecorder,
  liveRunObservationFromState,
  projectLiveRunChartLanes,
  useLiveRunHistory,
  type LiveRunHistorySample,
  type LiveRunObservation,
} from "../../src/renderer/src/lib/live-run-history";
import { inspectLiveRunChartLanes } from "../../src/renderer/src/lib/live-run-chart-inspection";
import type { ItemTimelineEntry } from "../../src/shared/stats";
import { baseTime, companionState, itemTimelineEntry } from "./fixtures";

describe("live run history", () => {
  test("derives earned metrics and active elapsed time without stretching a pause", () => {
    const state = companionState({
      runStatus: "paused",
      runPausedAt: baseTime - 10_000,
      runPausedDurationMs: 5_000,
      stats: {
        ...companionState().stats,
        sessionStartedAt: baseTime - 60_000,
        totalXpEarned: 123,
        totalGoldEarned: 456,
        totalKillsEarned: 7,
      },
    });

    expect(liveRunObservationFromState(state, baseTime)).toMatchObject({
      runIdentity: String(baseTime - 60_000),
      sessionStartedAt: baseTime - 60_000,
      observedAt: baseTime,
      elapsedMs: 45_000,
      xp: 123,
      gold: 456,
      kills: 7,
    });
  });

  test("counts newly observed entries once even when the shared timeline rolls forward", () => {
    const recorder = createLiveRunHistoryRecorder({ coalesceWindowMs: 0 });
    const first = itemTimelineEntry({ fingerprint: "first", label: "The Bucket", amount: 2, createdAt: baseTime + 1_000 });
    const second = itemTimelineEntry({ fingerprint: "second", label: "Copper Ore", amount: 3, createdAt: baseTime + 2_000 });

    recorder.record(observation({ elapsedMs: 1_000, itemTimeline: [first] }));
    recorder.record(observation({ elapsedMs: 2_000, itemTimeline: [first] }));
    expect(recorder.samples.at(-1)?.items).toBe(2);

    recorder.record(observation({ elapsedMs: 3_000, itemTimeline: [second, first] }));
    recorder.record(observation({ elapsedMs: 4_000, itemTimeline: [second] }));

    expect(recorder.samples.at(-1)).toMatchObject({ items: 5 });
    expect(recorder.samples.at(-1)?.itemCounts).toEqual({ "the bucket": 2, "copper ore": 3 });
  });

  test("resets values on a new run while retaining session-local custom selections", () => {
    const recorder = createLiveRunHistoryRecorder({ coalesceWindowMs: 0 });
    recorder.addCustomItem("The Bucket");
    recorder.record(observation({ xp: 500, itemTimeline: [itemTimelineEntry({ fingerprint: "old", label: "The Bucket" })] }));

    recorder.record(observation({
      runIdentity: "run-2",
      sessionStartedAt: baseTime + 10_000,
      observedAt: baseTime + 11_000,
      elapsedMs: 1_000,
      xp: 10,
      itemTimeline: [],
    }));

    expect(recorder.customItems.map((item) => item.name)).toEqual(["The Bucket"]);
    expect(recorder.samples).toHaveLength(2);
    expect(recorder.samples[0]).toMatchObject({ elapsedMs: 0, xp: 0, items: 0 });
    expect(recorder.samples[1]).toMatchObject({ elapsedMs: 1_000, xp: 10, items: 0 });
  });

  test("coalesces bursts, extends unchanged plateaus, and remains bounded", () => {
    const recorder = createLiveRunHistoryRecorder({ maxSamples: 4, coalesceWindowMs: 1_000 });
    recorder.record(observation({ elapsedMs: 0 }));
    recorder.record(observation({ elapsedMs: 1_000, xp: 10 }));
    recorder.record(observation({ elapsedMs: 1_500, xp: 20 }));
    expect(recorder.samples.map((sample) => sample.xp)).toEqual([0, 20]);

    recorder.record(observation({ elapsedMs: 4_000, xp: 20 }));
    expect(recorder.samples).toHaveLength(3);
    expect(recorder.samples.at(-2)?.elapsedMs).toBe(1_500);
    expect(recorder.samples.at(-1)?.elapsedMs).toBe(4_000);

    for (let value = 3; value <= 8; value += 1) {
      recorder.record(observation({ elapsedMs: value * 2_000, xp: value * 10 }));
    }
    expect(recorder.samples).toHaveLength(4);
    expect(recorder.samples[0]).toMatchObject({ elapsedMs: 0, xp: 0 });
    expect(recorder.samples.at(-1)).toMatchObject({ elapsedMs: 16_000, xp: 80 });
  });

  test("adds normalized exact-item lanes and backfills them from sample snapshots", () => {
    const recorder = createLiveRunHistoryRecorder({ coalesceWindowMs: 0 });
    const first = itemTimelineEntry({ fingerprint: "bucket-1", label: "The Bucket", amount: 1 });
    const second = itemTimelineEntry({ fingerprint: "bucket-2", label: "The Bucket", amount: 2, createdAt: baseTime + 2_000 });
    recorder.record(observation({ elapsedMs: 0 }));
    recorder.record(observation({ elapsedMs: 1_000, itemTimeline: [first] }));
    recorder.record(observation({ elapsedMs: 2_000, itemTimeline: [second, first] }));

    expect(recorder.addCustomItem("  the   bucket  ")).toBe(true);
    expect(recorder.addCustomItem("THE BUCKET")).toBe(false);
    let lane = projectLiveRunChartLanes(recorder.samples, recorder.customItems).find((candidate) => candidate.metric === "custom-item");
    expect(lane?.label).toBe("The Bucket");
    expect(lane?.points.map((point) => point.value)).toEqual([0, 1, 3]);

    expect(recorder.removeCustomItem("item:the bucket")).toBe(true);
    expect(projectLiveRunChartLanes(recorder.samples, recorder.customItems)).toHaveLength(4);
    expect(recorder.addCustomItem("The Bucket")).toBe(true);
    lane = projectLiveRunChartLanes(recorder.samples, recorder.customItems).find((candidate) => candidate.metric === "custom-item");
    expect(lane?.points.map((point) => point.value)).toEqual([0, 1, 3]);
  });

  test("treats case and diacritic variants as the same exact item and caps defaults at four lanes", () => {
    const recorder = createLiveRunHistoryRecorder();
    recorder.record(observation({
      itemTimeline: [itemTimelineEntry({ fingerprint: "accented", label: "Tarethíel Signet" })],
    }));

    expect(recorder.addCustomItem("TARETHIEL SIGNET")).toBe(true);
    expect(recorder.addCustomItem("Tarethíel Signet")).toBe(false);
    expect(projectLiveRunChartLanes(recorder.samples, recorder.customItems).at(-1)?.latestValue).toBe(1);
    expect(recorder.addCustomItem("Second")).toBe(true);
    expect(recorder.addCustomItem("Third")).toBe(true);
    expect(recorder.addCustomItem("Fourth")).toBe(true);
    expect(recorder.addCustomItem("Fifth")).toBe(false);
  });

  test("defensively restarts when a cumulative metric moves backward without a new run identity", () => {
    const recorder = createLiveRunHistoryRecorder({ coalesceWindowMs: 0 });
    recorder.record(observation({ elapsedMs: 10_000, xp: 500, gold: 250, kills: 10 }));
    recorder.record(observation({ elapsedMs: 20_000, xp: 25, gold: 250, kills: 10 }));

    expect(recorder.samples).toHaveLength(1);
    expect(recorder.samples[0]).toMatchObject({ elapsedMs: 20_000, xp: 25, gold: 250, kills: 10 });
  });

  test("keeps actual values while independently scaling every SVG lane", () => {
    const samples: LiveRunHistorySample[] = [
      sample({ elapsedMs: 10_000 }),
      sample({ elapsedMs: 15_000, xp: 50, gold: 500, kills: 5, items: 2, itemCounts: { "the bucket": 1 } }),
      sample({ elapsedMs: 20_000, xp: 100, gold: 1_000, kills: 10, items: 4, itemCounts: { "the bucket": 2 } }),
    ];
    const lanes = projectLiveRunChartLanes(
      samples,
      [{ key: "the bucket", name: "The Bucket", seriesId: "item:the bucket" }],
      200,
      100,
    );

    for (const lane of lanes) {
      expect(lane.points[1]?.x).toBe(100);
      expect(lane.points[1]?.y).toBe(50);
      expect(lane.points.at(-1)?.y).toBe(0);
      expect(lane.points.at(-1)?.value).toBe(lane.maxValue);
    }
    expect(lanes.find((lane) => lane.id === "gold")?.latestValue).toBe(1_000);
    expect(lanes.find((lane) => lane.id === "item:the bucket")?.latestValue).toBe(2);
  });

  test("inspects the current step value before, at, and after an exact change time", () => {
    const lanes = projectLiveRunChartLanes([
      sample({ elapsedMs: 10_000, xp: 10 }),
      sample({ elapsedMs: 15_000, xp: 20 }),
      sample({ elapsedMs: 20_000, xp: 30 }),
    ], []);

    expect(inspectLiveRunChartLanes(lanes, 4_999).values[0]?.value).toBe(10);
    expect(inspectLiveRunChartLanes(lanes, 5_000).values[0]?.value).toBe(20);
    expect(inspectLiveRunChartLanes(lanes, 9_999).values[0]?.value).toBe(20);
    expect(inspectLiveRunChartLanes(lanes, 10_000).values[0]?.value).toBe(30);
    expect(inspectLiveRunChartLanes(lanes, 60_000).values[0]?.value).toBe(30);
  });

  test("offers a thin reactive composable for App wiring", async () => {
    const state = ref(companionState({
      stats: {
        ...companionState().stats,
        sessionStartedAt: baseTime,
        totalXpEarned: 0,
        totalGoldEarned: 0,
        totalKillsEarned: 0,
        itemTimeline: [],
      },
    }));
    const now = ref(baseTime);
    const scope = effectScope();
    const history = scope.run(() => useLiveRunHistory({ state, now, coalesceWindowMs: 0 }));
    if (!history) throw new Error("Expected live run history composable");

    expect(history.samples.value).toHaveLength(1);
    state.value = companionState({
      stats: {
        ...state.value.stats,
        sessionStartedAt: baseTime,
        totalXpEarned: 250,
        itemTimeline: [itemTimelineEntry({ fingerprint: "reactive", label: "The Bucket", createdAt: baseTime + 5_000 })],
      },
    });
    now.value = baseTime + 5_000;
    await nextTick();

    expect(history.samples.value.at(-1)).toMatchObject({ elapsedMs: 5_000, xp: 250, items: 1 });
    expect(history.elapsedMs.value).toBe(5_000);
    expect(history.addCustomItem("The Bucket")).toBe(true);
    expect(history.lanes.value.find((lane) => lane.metric === "custom-item")?.latestValue).toBe(1);
    expect(history.enabledStandardMetrics.value).toEqual(["xp", "gold", "kills", "items"]);
    expect(history.setStandardMetricEnabled("gold", false)).toBe(true);
    expect(history.setStandardMetricEnabled("gold", false)).toBe(false);
    expect(history.enabledStandardMetrics.value).toEqual(["xp", "kills", "items"]);
    history.resetHistory();
    expect(history.enabledStandardMetrics.value).toEqual(["xp", "kills", "items"]);
    scope.stop();
  });

  test("waits for hydrated state and starts recovered graph time at the first real observation", async () => {
    const state = ref(companionState({
      stats: {
        ...companionState().stats,
        sessionStartedAt: baseTime - 60_000,
        totalXpEarned: 10_000,
        totalGoldEarned: 2_000,
        totalKillsEarned: 50,
        itemTimeline: [],
      },
    }));
    const now = ref(baseTime);
    const ready = ref(false);
    const scope = effectScope();
    const history = scope.run(() => useLiveRunHistory({ state, now, ready, coalesceWindowMs: 0 }));
    if (!history) throw new Error("Expected live run history composable");

    expect(history.samples.value).toEqual([]);
    ready.value = true;
    await nextTick();
    expect(history.samples.value).toHaveLength(1);
    expect(history.samples.value[0]).toMatchObject({ elapsedMs: 60_000, xp: 10_000 });
    expect(history.elapsedMs.value).toBe(0);
    expect(history.lanes.value[0]?.points[0]?.x).toBe(0);

    now.value = baseTime + 5_000;
    await nextTick();
    expect(history.elapsedMs.value).toBe(5_000);
    expect(history.lanes.value[0]?.points.at(-1)?.x).toBe(1_000);
    scope.stop();
  });
});

function observation(overrides: Partial<LiveRunObservation> = {}): LiveRunObservation {
  return {
    runIdentity: "run-1",
    sessionStartedAt: baseTime,
    observedAt: baseTime + 10_000,
    elapsedMs: 10_000,
    xp: 0,
    gold: 0,
    kills: 0,
    itemTimeline: [],
    ...overrides,
  };
}

function sample(overrides: Partial<LiveRunHistorySample> = {}): LiveRunHistorySample {
  return {
    recordedAt: baseTime,
    elapsedMs: 0,
    xp: 0,
    gold: 0,
    kills: 0,
    items: 0,
    itemCounts: {},
    ...overrides,
  };
}
