import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  loadCapturePreferences,
  loadPastRuns,
  loadRunArchivePreferences,
  loadWindowBounds,
  normalizeCapturePreferences,
  normalizeRunArchivePreferences,
  savePastRuns,
  saveCapturePreferences,
  saveRunArchivePreferences,
  withMinimumBounds,
} from "../../src/main/persistence";
import { DEFAULT_CAPTURE_PREFERENCES, DEFAULT_RUN_ARCHIVE_PREFERENCES } from "../../src/shared/initial-state";
import { PAST_RUN_SCHEMA_VERSION } from "../../src/shared/stats";
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
    expect(normalizeRunArchivePreferences({ skipEmptyRuns: true, minDurationMinutes: 9999 })).toEqual({
      skipEmptyRuns: true,
      minDurationMinutes: 1440,
    });
    expect(normalizeRunArchivePreferences({ skipEmptyRuns: false, minDurationMinutes: -5 })).toEqual({
      skipEmptyRuns: false,
      minDurationMinutes: 0,
    });
    expect(normalizeCapturePreferences({ createDebugMode: 1 as unknown as boolean })).toEqual({
      createDebugMode: true,
    });
    expect(normalizeRunArchivePreferences(null)).toEqual({
      skipEmptyRuns: false,
      minDurationMinutes: 0,
    });
    expect(normalizeCapturePreferences(undefined)).toEqual({
      createDebugMode: false,
    });
  });

  test("preserves unrelated preference sections while saving one section", () => {
    const preferencesPath = tempFile("preferences.json");
    fs.writeFileSync(
      preferencesPath,
      `${JSON.stringify({
        untouched: { value: 42 },
        runArchive: { skipEmptyRuns: true, minDurationMinutes: 5 },
        capture: { createDebugMode: true },
      })}\n`,
      "utf8",
    );

    expect(loadRunArchivePreferences(preferencesPath)).toEqual({ skipEmptyRuns: true, minDurationMinutes: 5 });
    expect(loadCapturePreferences(preferencesPath)).toEqual({ createDebugMode: true });

    saveRunArchivePreferences(preferencesPath, { skipEmptyRuns: false, minDurationMinutes: 15 });
    saveCapturePreferences(preferencesPath, { createDebugMode: false });

    expect(JSON.parse(fs.readFileSync(preferencesPath, "utf8"))).toEqual({
      untouched: { value: 42 },
      runArchive: { skipEmptyRuns: false, minDurationMinutes: 15 },
      capture: { createDebugMode: false },
    });
  });

  test("loads default main-process preferences when files or sections are missing", () => {
    expect(loadRunArchivePreferences(tempFile("missing.json"))).toEqual(DEFAULT_RUN_ARCHIVE_PREFERENCES);
    expect(loadCapturePreferences(tempFile("missing.json"))).toEqual(DEFAULT_CAPTURE_PREFERENCES);

    const preferencesPath = tempFile("partial-preferences.json");
    fs.writeFileSync(preferencesPath, `${JSON.stringify({ untouched: { value: 42 } })}\n`, "utf8");

    expect(loadRunArchivePreferences(preferencesPath)).toEqual(DEFAULT_RUN_ARCHIVE_PREFERENCES);
    expect(loadCapturePreferences(preferencesPath)).toEqual(DEFAULT_CAPTURE_PREFERENCES);
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
        itemBreakdown: { Set: {}, Satanic: {}, Heroic: {}, Angelic: {} },
        keys: [],
        ores: [],
        materials: [],
      }),
    ]);
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
