import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  SATANIC_ZONE_CACHE_SCHEMA_VERSION,
  loadPastRuns,
  loadSatanicZoneCache,
  loadSatanicZoneRefreshPreferences,
  loadWindowBounds,
  normalizeSatanicZoneCache,
  normalizeSatanicZoneRefreshPreferences,
  savePastRuns,
  saveSatanicZoneCache,
  saveSatanicZoneRefreshPreferences,
  satanicZoneCachePersistenceKey,
  withMinimumBounds,
} from "../../src/main/persistence";
import {
  DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES,
  createInitialSatanicZoneState,
} from "../../src/shared/satanic-zone";
import {
  MAX_PAST_RUN_ITEM_NAME_LENGTH,
  MAX_PAST_RUN_ITEM_TOTALS,
  PAST_RUN_SCHEMA_VERSION,
} from "../../src/shared/stats";
import {
  MAX_RUN_PACE_ITEM_NAME_LENGTH,
  RUN_PACE_SCHEMA_VERSION,
} from "../../src/shared/run-pace";
import { pastRun } from "../renderer/fixtures";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-persistence-"));
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function tempFile(name: string): string {
  return path.join(tempDir, name);
}

describe("main process persistence helpers", () => {
  test("normalizes stored main-process preferences", () => {
    expect(normalizeSatanicZoneRefreshPreferences({ enabled: true })).toEqual({ enabled: true });
    expect(normalizeSatanicZoneRefreshPreferences({ enabled: "true" })).toEqual({ enabled: false });
  });

  test("preserves unrelated preference sections while saving one section", () => {
    const preferencesPath = tempFile("preferences.json");
    fs.writeFileSync(
      preferencesPath,
      `${JSON.stringify({
        untouched: { value: 42 },
        runArchive: { skipEmptyRuns: true, minDurationMinutes: 5 },
        capture: { captureDebugLogging: false, capturePayloadLogging: true, captureWideLogging: true, satanicZoneDebugLogging: false },
        satanicZoneRefresh: { enabled: true },
      })}\n`,
      "utf8",
    );

    expect(loadSatanicZoneRefreshPreferences(preferencesPath)).toEqual({ enabled: true });

    saveSatanicZoneRefreshPreferences(preferencesPath, { enabled: false });

    expect(JSON.parse(fs.readFileSync(preferencesPath, "utf8"))).toEqual({
      untouched: { value: 42 },
      satanicZoneRefresh: { enabled: false },
    });
  });

  test("loads default main-process preferences when files or sections are missing", () => {
    expect(loadSatanicZoneRefreshPreferences(tempFile("missing.json"))).toEqual(DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES);

    const preferencesPath = tempFile("partial-preferences.json");
    fs.writeFileSync(preferencesPath, `${JSON.stringify({ untouched: { value: 42 } })}\n`, "utf8");

    expect(loadSatanicZoneRefreshPreferences(preferencesPath)).toEqual(DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES);
  });

  test.each([1, 2])("starts clean without restoring schema-v%s Satanic Zone observations", (schemaVersion) => {
    const cachePath = tempFile(`legacy-satanic-zone-v${schemaVersion}.json`);
    const updatedAt = new Date(2026, 7, 24, 10, 12).getTime();
    fs.writeFileSync(cachePath, JSON.stringify({
      schemaVersion,
      current: {
        rawZone: "Act_08_03",
        zone: "Act 8: Forgotten Caves",
        act: 8,
        area: 3,
        pros: [{ id: 1, name: "Treasure", description: "More loot." }],
        cons: [{ id: 2, name: "Danger", description: "More danger." }],
        buffs: [{ id: 3, name: "Legacy", description: "Must not cross a process boundary." }],
        updatedAt,
      },
      source: "manual",
      lastSuccessAt: updatedAt,
      nextAllowedRefreshAt: null,
    }), "utf8");

    expect(loadSatanicZoneCache(cachePath, updatedAt + 1_000)).toEqual(createInitialSatanicZoneState());
  });

  test.each([1, 2])("migrates only an active bounded cooldown from schema v%s", (schemaVersion) => {
    const now = new Date(2026, 7, 24, 10, 12).getTime();
    const nextAllowedRefreshAt = now + 30_000;

    expect(normalizeSatanicZoneCache({
      schemaVersion,
      current: {
        zone: "Act 8: Forgotten Caves",
        pros: [{ id: 1, name: "Legacy", description: "Ignored." }],
        updatedAt: now,
      },
      source: "captured",
      lastSuccessAt: now,
      nextAllowedRefreshAt,
    }, now)).toEqual({
      ...createInitialSatanicZoneState(),
      nextAllowedRefreshAt,
    });
  });

  test("persists only an active refresh cooldown, never zone observations", () => {
    const cachePath = tempFile("satanic-zone-cooldown.json");
    const now = new Date(2026, 7, 24, 10, 12).getTime();
    const nextAllowedRefreshAt = now + 30_000;
    const current = {
      rawZone: "Act_08_03",
      zone: "Act 8: Forgotten Caves",
      act: 8,
      area: 3,
      pros: [{ id: 1, name: "Treasure", description: "More loot." }],
      cons: [{ id: 2, name: "Danger", description: "More danger." }],
      buffs: [],
      updatedAt: now,
    };
    const state = {
      ...createInitialSatanicZoneState(),
      current,
      phase: "failed" as const,
      source: "manual" as const,
      lastAttemptAt: now + 1_000,
      lastSuccessAt: now,
      errorCode: "helper_failed",
      nextAllowedRefreshAt,
    };

    saveSatanicZoneCache(cachePath, state, undefined, now);

    expect(JSON.parse(fs.readFileSync(cachePath, "utf8"))).toEqual({
      schemaVersion: SATANIC_ZONE_CACHE_SCHEMA_VERSION,
      nextAllowedRefreshAt,
    });
    expect(loadSatanicZoneCache(cachePath, now + 1)).toEqual({
      ...createInitialSatanicZoneState(),
      nextAllowedRefreshAt,
    });
    expect(loadSatanicZoneCache(cachePath, nextAllowedRefreshAt)).toEqual(createInitialSatanicZoneState());
  });

  test("does not create a cache file for an observation without an active cooldown", () => {
    const cachePath = tempFile("satanic-zone-observation-only.json");
    const now = new Date(2026, 7, 24, 10, 12).getTime();

    saveSatanicZoneCache(cachePath, {
      ...createInitialSatanicZoneState(),
      current: {
        rawZone: "Act_08_03",
        zone: "Act 8: Forgotten Caves",
        pros: [],
        cons: [],
        buffs: [],
        updatedAt: now,
      },
      source: "captured",
      lastSuccessAt: now,
    });

    expect(fs.existsSync(cachePath)).toBe(false);
  });

  test("normalizes an empty current-schema cache to a clean initial state", () => {
    const now = new Date(2026, 7, 24, 10, 12).getTime();

    expect(normalizeSatanicZoneCache({
      schemaVersion: SATANIC_ZONE_CACHE_SCHEMA_VERSION,
      nextAllowedRefreshAt: null,
    }, now)).toEqual(createInitialSatanicZoneState());
    expect(normalizeSatanicZoneCache(null, now)).toEqual(createInitialSatanicZoneState());
  });

  test.each([
    ["string", "123"],
    ["fractional", 123.5],
    ["expired", new Date(2026, 7, 24, 10, 12).getTime()],
    ["far future", new Date(2026, 7, 24, 10, 18).getTime()],
  ])("rejects a %s persisted cooldown", (_label, cooldown) => {
    const now = new Date(2026, 7, 24, 10, 12).getTime();
    expect(normalizeSatanicZoneCache({
      schemaVersion: SATANIC_ZONE_CACHE_SCHEMA_VERSION,
      nextAllowedRefreshAt: cooldown,
    }, now)).toEqual(createInitialSatanicZoneState());
  });

  test("rejects cooldowns from unknown Satanic Zone cache schemas", () => {
    const now = new Date(2026, 7, 24, 10, 12).getTime();
    expect(normalizeSatanicZoneCache({
      schemaVersion: 999,
      nextAllowedRefreshAt: now + 30_000,
    }, now)).toEqual(createInitialSatanicZoneState());
  });

  test("changes the cache trigger only for active cooldown extensions", () => {
    const now = new Date(2026, 7, 24, 10, 12).getTime();
    const cooldownState = {
      ...createInitialSatanicZoneState(),
      phase: "refreshing" as const,
      nextAllowedRefreshAt: now + 30_000,
    };
    const key = satanicZoneCachePersistenceKey(cooldownState, now);

    expect(key).not.toBeNull();
    expect(satanicZoneCachePersistenceKey({
      ...cooldownState,
      phase: "failed",
      errorCode: "helper_failed",
    }, now)).toBe(key);
    expect(satanicZoneCachePersistenceKey({
      ...cooldownState,
      current: {
        rawZone: "Act_08_03",
        zone: "Act 8: Forgotten Caves",
        pros: [],
        cons: [],
        buffs: [],
        updatedAt: now,
      },
      source: "manual",
      lastSuccessAt: now,
    }, now)).toBe(key);
    expect(satanicZoneCachePersistenceKey({
      ...cooldownState,
      nextAllowedRefreshAt: now + 35_000,
    }, now)).not.toBe(key);
    expect(satanicZoneCachePersistenceKey(cooldownState, now + 30_000)).toBeNull();
    expect(satanicZoneCachePersistenceKey({
      ...createInitialSatanicZoneState(),
      current: {
        rawZone: "Act_08_03",
        zone: "Act 8: Forgotten Caves",
        pros: [],
        cons: [],
        buffs: [],
        updatedAt: now,
      },
    }, now)).toBeNull();
  });

  test("loads past runs defensively and migrates additive fields", () => {
    const runsPath = tempFile("past-runs.json");
    const legacyRun = {
      ...pastRun({ id: "legacy-run", tags: ["Keys", " keys ", "Bossing"] }),
      schemaVersion: undefined,
      totalKillsGained: undefined,
      setDrops: undefined,
      satanicDrops: undefined,
      heroicDrops: undefined,
      angelicDrops: undefined,
      itemTotals: undefined,
      runPace: undefined,
      itemBreakdown: undefined,
      keys: undefined,
      ores: undefined,
      materials: undefined,
    };
    fs.writeFileSync(runsPath, `${JSON.stringify([legacyRun, { id: "not-a-run" }])}\n`, "utf8");

    expect(loadPastRuns(runsPath)).toEqual([
      expect.objectContaining({
        schemaVersion: PAST_RUN_SCHEMA_VERSION,
        id: "legacy-run",
        tags: ["Keys", "Bossing"],
        totalKillsGained: 0,
        setDrops: 0,
        satanicDrops: 0,
        heroicDrops: 0,
        angelicDrops: 0,
        itemTotals: [],
        itemBreakdown: { Set: {}, Satanic: {}, Heroic: {}, Angelic: {} },
        keys: [],
        ores: [],
        materials: [],
        runPace: null,
      }),
    ]);
  });

  test("round-trips normalized Run Pace history and drops malformed history without losing the run", () => {
    const runsPath = tempFile("past-runs-run-pace.json");
    const longName = "x".repeat(MAX_RUN_PACE_ITEM_NAME_LENGTH + 20);
    fs.writeFileSync(runsPath, `${JSON.stringify([
      {
        ...pastRun({ id: "paced-run", durationMs: 60_000 }),
        runPace: {
          schemaVersion: RUN_PACE_SCHEMA_VERSION,
          samples: [
            { elapsedMs: 60_000, xp: 100, gold: 1_000, kills: 10, items: 3 },
            { elapsedMs: 0, xp: 0, gold: 0, kills: 0, items: 0 },
            { elapsedMs: 30_000, xp: 50, gold: 500, kills: 5, items: 1 },
          ],
          itemSeries: [{
            name: longName,
            points: [
              { elapsedMs: 30_000, value: 1 },
              { elapsedMs: 60_000, value: 3 },
            ],
          }],
          itemSeriesTruncated: false,
        },
      },
      {
        ...pastRun({ id: "malformed-pace" }),
        runPace: { schemaVersion: RUN_PACE_SCHEMA_VERSION, samples: "not-an-array" },
      },
    ], null, 2)}\n`, "utf8");

    const loaded = loadPastRuns(runsPath);
    expect(loaded.find((run) => run.id === "paced-run")?.runPace).toEqual({
      schemaVersion: RUN_PACE_SCHEMA_VERSION,
      samples: [
        { elapsedMs: 0, xp: 0, gold: 0, kills: 0, items: 0 },
        { elapsedMs: 30_000, xp: 50, gold: 500, kills: 5, items: 1 },
        { elapsedMs: 60_000, xp: 100, gold: 1_000, kills: 10, items: 3 },
      ],
      itemSeries: [{
        name: longName.slice(0, MAX_RUN_PACE_ITEM_NAME_LENGTH),
        points: [
          { elapsedMs: 30_000, value: 1 },
          { elapsedMs: 60_000, value: 3 },
        ],
      }],
      itemSeriesTruncated: false,
    });
    expect(loaded.find((run) => run.id === "malformed-pace")?.runPace).toBeNull();

    savePastRuns(runsPath, loaded);
    expect(loadPastRuns(runsPath).find((run) => run.id === "paced-run")?.runPace?.samples.at(-1)).toEqual({
      elapsedMs: 60_000,
      xp: 100,
      gold: 1_000,
      kills: 10,
      items: 3,
    });
  });

  test("normalizes current item totals and merges equivalent names", () => {
    const runsPath = tempFile("past-runs-item-totals.json");
    const run = {
      ...pastRun({ id: "current-item-totals" }),
      itemTotals: [
        { name: "  Túndra   Warrior’s Girdle  ", total: 2.9, mf: 8 },
        { name: "tundra warriors girdle", total: 3, mf: 1 },
        { name: "Crème Brûlée", total: 4, mf: 2 },
        { name: "creme brulee", total: 1, mf: 0 },
        null,
        { name: "", total: 1, mf: 0 },
        { name: "Zero", total: 0, mf: 0 },
        { name: "Negative", total: -1, mf: 0 },
        { name: "String total", total: "2", mf: 0 },
        { name: "Bad magic find", total: 2, mf: -1 },
      ],
    };
    fs.writeFileSync(runsPath, `${JSON.stringify([run])}\n`, "utf8");

    expect(loadPastRuns(runsPath)[0]?.itemTotals).toEqual([
      { name: "Crème Brûlée", total: 5, mf: 2 },
      { name: "Túndra Warrior’s Girdle", total: 5, mf: 3 },
    ]);
  });

  test("bounds persisted item totals and item names", () => {
    const runsPath = tempFile("past-runs-item-total-bounds.json");
    const longName = "a".repeat(MAX_PAST_RUN_ITEM_NAME_LENGTH + 20);
    const itemTotals = [
      { name: longName, total: Number.MAX_SAFE_INTEGER + 100, mf: Number.MAX_SAFE_INTEGER + 100 },
      ...Array.from({ length: MAX_PAST_RUN_ITEM_TOTALS }, (_, index) => ({
        name: `Item ${index}`,
        total: 1,
        mf: 0,
      })),
      { name: "ITEM 0", total: 2, mf: 1 },
    ];
    fs.writeFileSync(
      runsPath,
      `${JSON.stringify([{ ...pastRun({ id: "bounded-item-totals" }), itemTotals }])}\n`,
      "utf8",
    );

    const loaded = loadPastRuns(runsPath)[0]?.itemTotals ?? [];
    expect(loaded).toHaveLength(MAX_PAST_RUN_ITEM_TOTALS);
    expect(loaded.find((item) => item.name === longName.slice(0, MAX_PAST_RUN_ITEM_NAME_LENGTH))).toEqual({
      name: longName.slice(0, MAX_PAST_RUN_ITEM_NAME_LENGTH),
      total: Number.MAX_SAFE_INTEGER,
      mf: Number.MAX_SAFE_INTEGER,
    });
    expect(loaded.find((item) => item.name === "Item 0")).toEqual({ name: "Item 0", total: 3, mf: 1 });
    expect(loaded.filter((item) => item.name.startsWith("Item "))).toHaveLength(MAX_PAST_RUN_ITEM_TOTALS - 1);
  });

  test("synthesizes legacy item totals without double-counting resource projections", () => {
    const runsPath = tempFile("past-runs-legacy-item-totals.json");
    const legacyRun = {
      ...pastRun({
        id: "legacy-item-totals",
        itemBreakdown: {
          Set: {
            first: { name: "Túndra Warrior’s Girdle", total: 2, mf: 1 },
            resourceProjection: { name: "Jadé O’re", total: 99, mf: 88 },
          },
          Satanic: {
            second: { name: "tundra warriors girdle", total: 3, mf: 2 },
          },
          Heroic: {},
          Angelic: {},
        },
        keys: [
          { id: 1, name: "Mára’s Key", total: 2 },
          { id: 2, name: "maras key", total: 3 },
        ],
        ores: [
          { id: 30, name: "Ruby", total: 2 },
          { id: 31, name: "Jade Ore", total: 4 },
        ],
        materials: [
          { id: 98, name: "Ruby", total: 7 },
          { id: 99, name: "jade ore", total: 1 },
        ],
      }),
      schemaVersion: 1,
      itemTotals: undefined,
    };
    fs.writeFileSync(runsPath, `${JSON.stringify([legacyRun])}\n`, "utf8");

    expect(loadPastRuns(runsPath)[0]?.itemTotals).toEqual([
      { name: "Jade Ore", total: 5, mf: 0 },
      { name: "Mára’s Key", total: 5, mf: 0 },
      { name: "Ruby", total: 7, mf: 0 },
      { name: "Ruby Ore", total: 2, mf: 0 },
      { name: "Túndra Warrior’s Girdle", total: 5, mf: 3 },
    ]);
  });

  test("does not replace an explicit current item-total list with legacy projections", () => {
    const runsPath = tempFile("past-runs-empty-current-item-totals.json");
    fs.writeFileSync(
      runsPath,
      `${JSON.stringify([{ ...pastRun({ id: "empty-current-item-totals" }), itemTotals: [] }])}\n`,
      "utf8",
    );

    expect(loadPastRuns(runsPath)[0]?.itemTotals).toEqual([]);
  });

  test("filters invalid past runs before applying the archive cap", () => {
    const runsPath = tempFile("past-runs-cap.json");
    const invalidRuns = Array.from({ length: 100 }, (_, index) => ({ id: `invalid-${index}` }));
    const validRun = pastRun({ id: "durable-run" });
    fs.writeFileSync(runsPath, `${JSON.stringify([...invalidRuns, validRun])}\n`, "utf8");

    expect(loadPastRuns(runsPath).map((run) => run.id)).toEqual(["durable-run"]);
  });

  test("saves past runs with the current schema version", () => {
    const runsPath = tempFile("past-runs-save.json");

    savePastRuns(runsPath, [pastRun({ id: "saved-run" })]);

    expect(JSON.parse(fs.readFileSync(runsPath, "utf8"))[0]).toMatchObject({
      schemaVersion: PAST_RUN_SCHEMA_VERSION,
      id: "saved-run",
    });
  });

  test("keeps the newest 250 non-empty run records", () => {
    const runsPath = tempFile("past-runs-250-cap.json");
    const runs = Array.from({ length: 275 }, (_, index) => pastRun({
      id: `run-${index}`,
      sessionStartedAt: 10_000 - index,
      sessionEndedAt: 20_000 - index,
    }));

    savePastRuns(runsPath, runs);

    const loaded = loadPastRuns(runsPath);
    expect(loaded).toHaveLength(250);
    expect(loaded[0]?.id).toBe("run-0");
    expect(loaded.at(-1)?.id).toBe("run-249");
  });

  test("sorts unsorted run records before evicting the true oldest", () => {
    const runsPath = tempFile("past-runs-unsorted-cap.json");
    const runs = Array.from({ length: 251 }, (_, index) => pastRun({
      id: `run-${index}`,
      sessionStartedAt: index + 1,
      sessionEndedAt: index + 2,
    }));
    const unsorted = [runs[250], runs[0], ...runs.slice(1, 250).reverse()];

    savePastRuns(runsPath, unsorted);

    const loaded = loadPastRuns(runsPath);
    expect(loaded).toHaveLength(250);
    expect(loaded[0]?.id).toBe("run-250");
    expect(loaded.map((run) => run.id)).not.toContain("run-0");
  });

  test("normalizes and bounds saved window positions", () => {
    const boundsPath = tempFile("window-bounds.json");
    fs.writeFileSync(
      boundsPath,
      `${JSON.stringify({
        normal: { x: 10.7, y: 20.9, width: 640.8, height: 480.1 },
        compact: { x: 1, y: 1, width: 40, height: 40 },
      })}\n`,
      "utf8",
    );

    expect(loadWindowBounds(boundsPath)).toEqual({
      normal: { x: 10, y: 20, width: 640, height: 480 },
      compact: undefined,
    });
    expect(withMinimumBounds({ x: 1, y: 2, width: 200, height: 120 }, { width: 420, height: 220, minWidth: 340, minHeight: 160 })).toEqual({
      x: 1,
      y: 2,
      width: 340,
      height: 160,
    });
  });
});
