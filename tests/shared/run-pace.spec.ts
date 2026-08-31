import { describe, expect, test } from "vitest";

import { EVENT_NAMES } from "../../src/shared/constants";
import type { AddedItemObject, ParsedEvent } from "../../src/shared/parser";
import {
  MAX_RUN_PACE_ITEM_POINTS,
  MAX_RUN_PACE_ITEM_SERIES,
  MAX_RUN_PACE_SAMPLES,
  RUN_PACE_SCHEMA_VERSION,
  createRunPaceRecorder,
  normalizePastRunPace,
} from "../../src/shared/run-pace";
import { StatsEngine } from "../../src/shared/stats";

describe("persisted Run Pace history", () => {
  test("rejects unsupported or empty persisted shapes", () => {
    expect(normalizePastRunPace(null)).toBeNull();
    expect(normalizePastRunPace({ schemaVersion: 999, samples: [] })).toBeNull();
    expect(normalizePastRunPace({
      schemaVersion: RUN_PACE_SCHEMA_VERSION,
      samples: [{ elapsedMs: -1, xp: 0, gold: 0, kills: 0, items: 0 }],
      itemSeries: [],
    })).toBeNull();
  });

  test("normalizes ordering, duplicate times, cumulative values, names, and duration bounds", () => {
    const pace = normalizePastRunPace({
      schemaVersion: RUN_PACE_SCHEMA_VERSION,
      samples: [
        { elapsedMs: 5_000, xp: 5, gold: 4, kills: 3, items: 2 },
        { elapsedMs: 1_000, xp: 10, gold: 1, kills: 1, items: 1 },
        { elapsedMs: 5_000, xp: 20, gold: 0, kills: 2, items: 0 },
        { elapsedMs: 99_999, xp: 30, gold: 8, kills: 5, items: 4 },
        { elapsedMs: Number.POSITIVE_INFINITY, xp: 999, gold: 999, kills: 999, items: 999 },
      ],
      itemSeries: [
        {
          name: "  Tarethíel’s   Signet  ",
          points: [
            { elapsedMs: 5_000, value: 4 },
            { elapsedMs: 1_000, value: 2 },
            { elapsedMs: 5_000, value: 3 },
            { elapsedMs: 7_000, value: -1 },
          ],
        },
        {
          name: "tarethiel's signet",
          points: [{ elapsedMs: 7_000, value: 1 }],
        },
        {
          name: ` ${"x".repeat(140)} `,
          points: [{ elapsedMs: 20_000, value: Number.MAX_SAFE_INTEGER + 100 }],
        },
      ],
      itemSeriesTruncated: false,
    }, 10_000);

    expect(pace).not.toBeNull();
    expect(pace?.samples).toEqual([
      { elapsedMs: 0, xp: 0, gold: 0, kills: 0, items: 0 },
      { elapsedMs: 1_000, xp: 10, gold: 1, kills: 1, items: 1 },
      { elapsedMs: 5_000, xp: 20, gold: 1, kills: 2, items: 1 },
      { elapsedMs: 10_000, xp: 30, gold: 8, kills: 5, items: 4 },
    ]);
    expect(pace?.itemSeries[0]).toEqual({
      name: "Tarethíel’s Signet",
      points: [
        { elapsedMs: 1_000, value: 2 },
        { elapsedMs: 5_000, value: 3 },
        { elapsedMs: 7_000, value: 3 },
      ],
    });
    expect(pace?.itemSeries[1]).toEqual({
      name: "x".repeat(120),
      points: [{ elapsedMs: 10_000, value: Number.MAX_SAFE_INTEGER }],
    });
  });

  test("bounds samples, item series, and total item points while preserving every retained series endpoint", () => {
    const pace = normalizePastRunPace({
      schemaVersion: RUN_PACE_SCHEMA_VERSION,
      samples: Array.from({ length: MAX_RUN_PACE_SAMPLES + 60 }, (_, index) => ({
        elapsedMs: index,
        xp: index,
        gold: index * 2,
        kills: index * 3,
        items: index * 4,
      })),
      itemSeries: Array.from({ length: MAX_RUN_PACE_ITEM_SERIES + 1 }, (_, seriesIndex) => ({
        name: `Item ${seriesIndex}`,
        points: Array.from({ length: 9 }, (_, pointIndex) => ({
          elapsedMs: pointIndex,
          value: pointIndex,
        })),
      })),
      itemSeriesTruncated: false,
    }, MAX_RUN_PACE_SAMPLES + 60);

    expect(pace).not.toBeNull();
    expect(pace?.samples).toHaveLength(MAX_RUN_PACE_SAMPLES);
    expect(pace?.samples[0]?.elapsedMs).toBe(0);
    expect(pace?.samples.at(-1)).toEqual({
      elapsedMs: MAX_RUN_PACE_SAMPLES + 60,
      xp: MAX_RUN_PACE_SAMPLES + 59,
      gold: (MAX_RUN_PACE_SAMPLES + 59) * 2,
      kills: (MAX_RUN_PACE_SAMPLES + 59) * 3,
      items: (MAX_RUN_PACE_SAMPLES + 59) * 4,
    });
    expect(pace?.itemSeries).toHaveLength(MAX_RUN_PACE_ITEM_SERIES);
    expect(pace?.itemSeries.reduce((total, series) => total + series.points.length, 0)).toBe(MAX_RUN_PACE_ITEM_POINTS);
    expect(pace?.itemSeries.every((series) => series.points.at(-1)?.value === 8)).toBe(true);
    expect(pace?.itemSeriesTruncated).toBe(true);
  });

  test("records exact stacked amounts and adds a terminal plateau with authoritative totals", () => {
    const recorder = createRunPaceRecorder();
    recorder.record({
      elapsedMs: 1_000,
      xp: 10,
      gold: 20,
      kills: 1,
      item: { name: "Tarethíel’s Signet", amount: 2 },
    });
    recorder.record({
      elapsedMs: 2_000,
      xp: 15,
      gold: 20,
      kills: 1,
      item: { name: "tarethiel's signet", amount: 3 },
    });

    const pace = recorder.snapshot({
      elapsedMs: 10_000,
      xp: 15,
      gold: 20,
      kills: 1,
      itemTotals: [{ name: "TARETHIELS SIGNET", total: 5 }],
    });

    expect(pace.samples).toEqual([
      { elapsedMs: 0, xp: 0, gold: 0, kills: 0, items: 0 },
      { elapsedMs: 1_000, xp: 10, gold: 20, kills: 1, items: 2 },
      { elapsedMs: 2_000, xp: 15, gold: 20, kills: 1, items: 5 },
      { elapsedMs: 10_000, xp: 15, gold: 20, kills: 1, items: 5 },
    ]);
    expect(pace.itemSeries).toEqual([{
      name: "Tarethíel’s Signet",
      points: [
        { elapsedMs: 1_000, value: 2 },
        { elapsedMs: 2_000, value: 5 },
        { elapsedMs: 10_000, value: 5 },
      ],
    }]);
  });

  test("StatsEngine records accepted items once, removes paused time, and resets history", () => {
    const stats = new StatsEngine();
    const startedAt = stats.snapshot().sessionStartedAt;

    stats.applyEvents([itemEvent(startedAt + 1_000, "pace-item", "Tarethíel’s Signet", 2)]);
    stats.applyEvents([itemEvent(startedAt + 1_500, "pace-item", "Tarethíel’s Signet", 2)]);
    stats.pause(startedAt + 2_000);
    stats.resume(startedAt + 7_000);
    stats.applyEvents([
      itemEvent(startedAt + 8_000, "pace-item-2", "tarethiel's signet", 3),
      {
        name: EVENT_NAMES.xp,
        value: 15,
        raw: {},
        createdAt: startedAt + 9_000,
      },
    ]);

    const summary = stats.runSummary(startedAt + 10_000);
    expect(summary.durationMs).toBe(5_000);
    expect(summary.itemTotals).toEqual([{ name: "Tarethíel’s Signet", total: 5, mf: 0 }]);
    expect(summary.runPace?.samples).toEqual([
      { elapsedMs: 0, xp: 0, gold: 0, kills: 0, items: 0 },
      { elapsedMs: 1_000, xp: 0, gold: 0, kills: 0, items: 2 },
      { elapsedMs: 3_000, xp: 0, gold: 0, kills: 0, items: 5 },
      { elapsedMs: 4_000, xp: 100, gold: 0, kills: 0, items: 5 },
      { elapsedMs: 5_000, xp: 100, gold: 0, kills: 0, items: 5 },
    ]);
    expect(summary.runPace?.itemSeries).toEqual([{
      name: "Tarethíel’s Signet",
      points: [
        { elapsedMs: 1_000, value: 2 },
        { elapsedMs: 3_000, value: 5 },
        { elapsedMs: 5_000, value: 5 },
      ],
    }]);

    stats.reset();
    const resetStartedAt = stats.snapshot().sessionStartedAt;
    const resetSummary = stats.runSummary(resetStartedAt + 1_000);
    expect(resetSummary.runPace?.samples).toEqual([
      { elapsedMs: 0, xp: 0, gold: 0, kills: 0, items: 0 },
      { elapsedMs: 1_000, xp: 0, gold: 0, kills: 0, items: 0 },
    ]);
    expect(resetSummary.runPace?.itemSeries).toEqual([]);
  });
});

function itemEvent(
  createdAt: number,
  fingerprint: string,
  label: string,
  amount: number,
): ParsedEvent<AddedItemObject> {
  return {
    name: EVENT_NAMES.item,
    raw: {},
    createdAt,
    value: {
      source: "inventory",
      repository: "normal",
      fingerprint,
      label,
      seed: 1,
      id: 4,
      tokenLevel: 0,
      type: 4,
      dropQuality: 1,
      rarity: 1,
      rarityName: "Common",
      token: 0,
      tier: 0,
      amount,
      weaponType: 0,
      marketId: 0,
      mfDrop: 0,
      sockets: 0,
      account: "Test Hero",
    },
  };
}
