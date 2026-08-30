import { describe, expect, test } from "vitest";

import { createSatanicZoneInfo, type SatanicZoneInfo } from "../../src/shared/parser";
import {
  createInitialSatanicZoneState,
  effectiveSatanicZonePhase,
  isSatanicZoneCurrent,
  mergeSatanicZoneObservation,
  nextSatanicZoneBoundary,
} from "../../src/shared/satanic-zone";

function localTime(hour: number, minute: number, second = 0, millisecond = 0): number {
  return new Date(2026, 7, 24, hour, minute, second, millisecond).getTime();
}

function zone(updatedAt: number, overrides: Partial<SatanicZoneInfo> = {}): SatanicZoneInfo {
  return {
    rawZone: "Act_08_03",
    zone: "Act 8: Forgotten Caves",
    act: 8,
    area: 3,
    pros: [],
    cons: [],
    buffs: [],
    updatedAt,
    ...overrides,
  };
}

describe("Satanic Zone half-hour windows", () => {
  test("returns the next local :00 or :30 boundary", () => {
    expect(nextSatanicZoneBoundary(localTime(10, 12, 34, 500))).toBe(localTime(10, 30));
    expect(nextSatanicZoneBoundary(localTime(10, 30))).toBe(localTime(11, 0));
    expect(nextSatanicZoneBoundary(localTime(23, 59, 59))).toBe(localTime(24, 0));
  });

  test("treats an observation as current only inside its local half-hour window", () => {
    const observation = zone(localTime(10, 12));

    expect(isSatanicZoneCurrent(observation, localTime(10, 29, 59, 999))).toBe(true);
    expect(isSatanicZoneCurrent(observation, localTime(10, 30))).toBe(false);
    expect(isSatanicZoneCurrent(observation, localTime(10, 11, 59))).toBe(false);
  });
});

describe("Satanic Zone state", () => {
  test("starts in a passive waiting state with refresh disabled", () => {
    expect(createInitialSatanicZoneState()).toEqual({
      current: null,
      phase: "waiting",
      source: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      validUntil: null,
      nextAllowedRefreshAt: null,
      errorCode: null,
      refreshEnabled: false,
      refreshAvailable: false,
      refreshExperimental: false,
    });
  });

  test("derives stale at the boundary while preserving lifecycle phases", () => {
    const current = zone(localTime(10, 12));
    const state = {
      ...createInitialSatanicZoneState(),
      current,
      phase: "current" as const,
    };

    expect(effectiveSatanicZonePhase(state, localTime(10, 29, 59))).toBe("current");
    expect(effectiveSatanicZonePhase(state, localTime(10, 30))).toBe("stale");
    expect(effectiveSatanicZonePhase({ ...state, phase: "refreshing" }, localTime(10, 30))).toBe("refreshing");
  });

  test("does not report current or stale without an observation", () => {
    expect(effectiveSatanicZonePhase({ ...createInitialSatanicZoneState(), phase: "current" }, localTime(10, 12))).toBe(
      "waiting",
    );
  });
});

describe("Satanic Zone observation merge", () => {
  test("preserves a specific zone over a generic observation in the same window", () => {
    const specific = zone(localTime(10, 4));
    const previous = {
      ...createInitialSatanicZoneState(),
      current: specific,
      phase: "failed" as const,
      source: "captured" as const,
      lastSuccessAt: localTime(10, 4),
      errorCode: "request_failed",
      refreshAvailable: true,
      refreshExperimental: true,
    };
    const generic = zone(localTime(10, 18), {
      rawZone: "",
      zone: "Unknown Satanic Zone",
      act: undefined,
      area: undefined,
    });

    const merged = mergeSatanicZoneObservation(previous, generic, "experimental", localTime(10, 18));

    expect(merged.current).toBe(specific);
    expect(merged.source).toBe("captured");
    expect(merged.phase).toBe("current");
    expect(merged.lastSuccessAt).toBe(localTime(10, 18));
    expect(merged.validUntil).toBe(localTime(10, 30));
    expect(merged.errorCode).toBeNull();
    expect(merged.refreshAvailable).toBe(true);
  });

  test("accepts a more specific observation in the same window", () => {
    const generic = zone(localTime(10, 3), {
      rawZone: "",
      zone: "Unknown Satanic Zone",
      act: undefined,
      area: undefined,
    });
    const specific = zone(localTime(10, 22), { rawZone: "Act_06_02", zone: "Act 6: The Cathedral", act: 6, area: 2 });
    const previous = mergeSatanicZoneObservation(createInitialSatanicZoneState(), generic, "captured");

    const merged = mergeSatanicZoneObservation(previous, specific, "experimental");

    expect(merged.current).toBe(specific);
    expect(merged.source).toBe("experimental");
    expect(merged.validUntil).toBe(localTime(10, 30));
  });

  test("accepts generic data from a new half-hour window", () => {
    const previous = mergeSatanicZoneObservation(
      createInitialSatanicZoneState(),
      zone(localTime(10, 20)),
      "captured",
    );
    const nextWindowGeneric = zone(localTime(10, 31), {
      rawZone: "",
      zone: "Unknown Satanic Zone",
      act: undefined,
      area: undefined,
    });

    const merged = mergeSatanicZoneObservation(previous, nextWindowGeneric, "captured");

    expect(merged.current).toBe(nextWindowGeneric);
    expect(merged.phase).toBe("current");
    expect(merged.validUntil).toBe(localTime(11, 0));
  });

  test("does not regress to an out-of-order older window", () => {
    const newer = zone(localTime(10, 35));
    const previous = mergeSatanicZoneObservation(createInitialSatanicZoneState(), newer, "experimental");
    const older = zone(localTime(10, 25), { rawZone: "Act_01_01", zone: "Act 1: Tarethiel Forest", act: 1, area: 1 });

    const merged = mergeSatanicZoneObservation(previous, older, "captured", localTime(10, 36));

    expect(merged.current).toBe(newer);
    expect(merged.source).toBe("experimental");
    expect(merged.phase).toBe("current");
    expect(merged.validUntil).toBe(localTime(11, 0));
  });
});

describe("Satanic Zone sanitized field projection", () => {
  test("uses the normal zone/effect mappings while preserving the supplied observation time", () => {
    const observedAt = localTime(10, 12);

    expect(createSatanicZoneInfo("Act_08_03", [21], [25], observedAt)).toMatchObject({
      rawZone: "Act_08_03",
      zone: "Act 8: Forgotten Caves",
      act: 8,
      area: 3,
      pros: [{ id: 21 }],
      cons: [{ id: 25 }],
      updatedAt: observedAt,
    });
  });

  test("resolves every current Act 9 zone identifier", () => {
    const expectedNames = [
      "Abyss Jungle",
      "Shipwreck Cove",
      "Tormented Reef",
      "Boreal Island",
      "Volcanic Island",
      "Abyss Realm",
    ];

    expect(expectedNames.map((_, index) =>
      createSatanicZoneInfo(`Act_09_0${index + 1}`, [], [], localTime(10, 12)).zone,
    )).toEqual(expectedNames.map((name) => `Act 9: ${name}`));
  });
});
