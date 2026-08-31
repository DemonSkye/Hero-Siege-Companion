import { describe, expect, test } from "vitest";

import {
  createCompanionStateUpdate,
  mergeCompanionStateUpdate,
  type CompanionState,
} from "../../src/shared/app-state";
import { createInitialCompanionState } from "../../src/shared/initial-state";
import { PAST_RUN_SCHEMA_VERSION, type PastRunSummary } from "../../src/shared/stats";

describe("Companion state IPC updates", () => {
  test("omits Past Runs entirely from live updates", () => {
    const state = companionStateWithRuns(savedRun("saved-run"));

    const update = createCompanionStateUpdate(state, { includePastRuns: false });

    expect(Object.hasOwn(update, "pastRuns")).toBe(false);
    expect(update.stats).toBe(state.stats);
    expect(update.logs).toBe(state.logs);
  });

  test("includes the complete Past Runs snapshot when requested", () => {
    const state = companionStateWithRuns(savedRun("saved-run"));

    const update = createCompanionStateUpdate(state, { includePastRuns: true });

    expect(Object.hasOwn(update, "pastRuns")).toBe(true);
    expect(update.pastRuns).toBe(state.pastRuns);
  });

  test("preserves hydrated Past Runs when a live update omits them", () => {
    const current = companionStateWithRuns(savedRun("hydrated-run"));
    const nextLiveState = createInitialCompanionState();
    nextLiveState.health.packetsSeen = 42;
    const update = createCompanionStateUpdate(nextLiveState, { includePastRuns: false });

    const merged = mergeCompanionStateUpdate(current, update);

    expect(merged.health.packetsSeen).toBe(42);
    expect(merged.pastRuns).toBe(current.pastRuns);
  });

  test("treats an explicit empty Past Runs snapshot as delete all", () => {
    const current = companionStateWithRuns(savedRun("deleted-run"));
    const update = createCompanionStateUpdate(
      { ...createInitialCompanionState(), pastRuns: [] },
      { includePastRuns: true },
    );

    const merged = mergeCompanionStateUpdate(current, update);

    expect(merged.pastRuns).toEqual([]);
  });
});

function companionStateWithRuns(...pastRuns: PastRunSummary[]): CompanionState {
  return {
    ...createInitialCompanionState(),
    pastRuns,
  };
}

function savedRun(id: string): PastRunSummary {
  return {
    schemaVersion: PAST_RUN_SCHEMA_VERSION,
    id,
    sessionStartedAt: 1_000,
    sessionEndedAt: 2_000,
    durationMs: 1_000,
    accountName: "YeeBoi",
    tags: [],
    totalGoldGained: 0,
    totalXpGained: 0,
    totalKillsGained: 0,
    setDrops: 0,
    satanicDrops: 0,
    heroicDrops: 0,
    angelicDrops: 0,
    itemTotals: [{ name: "Sentinel Item", total: 1, mf: 0 }],
    itemBreakdown: { Set: {}, Satanic: {}, Heroic: {}, Angelic: {} },
    keys: [],
    ores: [],
    materials: [],
    runPace: null,
  };
}
