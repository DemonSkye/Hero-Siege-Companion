import { describe, expect, test } from "vitest";
import {
  createSatanicZoneRelayCommand,
  parseSatanicZoneRelayPassiveObservation,
  parseSatanicZoneRelayReadyState,
  parseSatanicZoneRelayResult,
} from "../../src/main/satanic-zone-relay-protocol";

const NOW = Date.parse("2026-08-24T14:05:00.000Z");
const COMMAND_ID = "0123456789abcdef0123456789abcdef";
const SESSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OBSERVATION_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("managed Satanic Zone relay protocol", () => {
  test("creates only the fixed repeatable command shape", () => {
    expect(createSatanicZoneRelayCommand(COMMAND_ID, SESSION_ID, NOW)).toEqual({
      schemaVersion: 1,
      command: "refresh_satanic_zone",
      commandId: COMMAND_ID,
      sessionId: SESSION_ID,
      requestedAt: "2026-08-24T14:05:00.000Z",
      minimumDispatchSpacingMs: 30_000,
    });
    expect(createSatanicZoneRelayCommand("../command", SESSION_ID, NOW)).toBeNull();
    expect(createSatanicZoneRelayCommand(COMMAND_ID, "wrong-session", NOW)).toBeNull();
    expect(createSatanicZoneRelayCommand(COMMAND_ID, SESSION_ID, Number.NaN)).toBeNull();
  });

  test("requires only the relay's repeatability, counter translation, parent liveness, and 30-second spacing claims", () => {
    expect(parseSatanicZoneRelayReadyState(readyRecord(), SESSION_ID, 1234)).toEqual({
      sessionId: SESSION_ID,
      pid: 1234,
      startedAt: NOW,
    });
    expect(parseSatanicZoneRelayReadyState(
      { ...readyRecord(), requestReady: false, requestSeeded: true },
      SESSION_ID,
      1234,
    )).toEqual({
      sessionId: SESSION_ID,
      pid: 1234,
      startedAt: NOW,
    });
    expect(parseSatanicZoneRelayReadyState(
      { ...readyRecord(), requestReady: false, requestSeeded: false },
      SESSION_ID,
      1234,
    )).toEqual({
      sessionId: SESSION_ID,
      pid: 1234,
      startedAt: NOW,
    });
    expect(parseSatanicZoneRelayReadyState(
      { ...readyRecord(), commandCooldownMs: 29_999 },
      SESSION_ID,
      1234,
    )).toBeNull();
    expect(parseSatanicZoneRelayReadyState(
      { ...readyRecord(), counterTranslation: false },
      SESSION_ID,
      1234,
    )).toBeNull();
    expect(parseSatanicZoneRelayReadyState(
      { ...readyRecord(), parentLiveness: false },
      SESSION_ID,
      1234,
    )).toBeNull();
    const withoutSpeculativeTelemetry = readyRecord();
    delete withoutSpeculativeTelemetry.requestReady;
    delete withoutSpeculativeTelemetry.requestSeeded;
    expect(parseSatanicZoneRelayReadyState(
      withoutSpeculativeTelemetry,
      SESSION_ID,
      1234,
    )).toMatchObject({ sessionId: SESSION_ID, pid: 1234 });
  });

  test("returns only display-safe fields from a matching success", () => {
    const outcome = parseSatanicZoneRelayResult(resultRecord(), COMMAND_ID, SESSION_ID, NOW + 1000);

    expect(outcome).toMatchObject({
      kind: "observation",
      availabilityConsumed: false,
      observation: {
        observedAt: NOW + 100,
        zone: {
          rawZone: "Act_08_03",
          zone: "Act 8: Forgotten Caves",
          act: 8,
          area: 3,
          pros: [{ id: 21 }, { id: 22 }],
          cons: [{ id: 25 }, { id: 18 }],
        },
      },
    });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("counterValue");
  });

  test("returns only display-safe fields from a session-bound passive observation", () => {
    const outcome = parseSatanicZoneRelayPassiveObservation(
      passiveObservationRecord(),
      SESSION_ID,
      NOW,
      NOW + 1000,
    );

    expect(outcome).toMatchObject({
      observationId: OBSERVATION_ID,
      completedAt: NOW + 200,
      observation: {
        observedAt: NOW + 100,
        zone: {
          rawZone: "Act_08_03",
          zone: "Act 8: Forgotten Caves",
          pros: [{ id: 21 }, { id: 22 }],
          cons: [{ id: 25 }, { id: 18 }],
        },
      },
    });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("connectionTuple");
  });

  test.each([
    ["foreign session", { sessionId: COMMAND_ID }],
    ["invalid observation identifier", { observationId: "../observation" }],
    ["unknown schema", { schemaVersion: 2 }],
    ["stale completion", { completedAt: "2026-08-24T13:00:00.000Z" }],
    ["pre-session completion", { completedAt: "2026-08-24T13:59:00.000Z" }],
    ["malformed safe observation", { zoneObservation: { ...zoneObservation(), buffs: [21, 21] } }],
  ])("rejects a passive observation with %s", (_label, overrides) => {
    expect(parseSatanicZoneRelayPassiveObservation(
      { ...passiveObservationRecord(), ...overrides },
      SESSION_ID,
      NOW,
      NOW + 1000,
    )).toBeNull();
  });

  test.each([
    ["foreign command", { commandId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
    ["foreign session", { sessionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
    ["unknown schema", { schemaVersion: 2 }],
    ["unconfirmed request", { requestAccepted: false }],
    ["inactive translation", { counterTranslationActive: false }],
    ["stale completion", { completedAt: "2026-08-24T13:00:00.000Z" }],
    ["unknown status", { status: "future" }],
    ["noncanonical zone", { zoneObservation: { ...zoneObservation(), rawZone: " Act_08_03" } }],
    ["oversized zone", { zoneObservation: { ...zoneObservation(), rawZone: "A".repeat(65) } }],
    ["duplicate effect", { zoneObservation: { ...zoneObservation(), buffs: [21, 21] } }],
    ["fractional effect", { zoneObservation: { ...zoneObservation(), debuffs: [18.5] } }],
    ["oversized effects", { zoneObservation: { ...zoneObservation(), buffs: Array.from({ length: 33 }, (_, i) => i + 1) } }],
    ["invalid observation date", { zoneObservation: { ...zoneObservation(), observedAt: "2026-02-31T14:05:00Z" } }],
  ])("rejects a success with %s", (_label, overrides) => {
    expect(parseSatanicZoneRelayResult(
      { ...resultRecord(), ...overrides },
      COMMAND_ID,
      SESSION_ID,
      NOW + 1000,
    )).toBeNull();
  });

  test.each([
    ["rejected", "helper_rejected"],
    ["failed", "helper_failed"],
    ["timeout", "response_timeout"],
  ] as const)("maps %s to a reusable sanitized terminal result", (status, errorCode) => {
    expect(parseSatanicZoneRelayResult(
      { ...resultRecord(), status },
      COMMAND_ID,
      SESSION_ID,
      NOW + 1000,
    )).toEqual({ kind: "terminal", errorCode, availabilityConsumed: false });
  });
});

function readyRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: "ready",
    sessionId: SESSION_ID,
    pid: 1234,
    repeatableRefresh: true,
    counterTranslation: true,
    parentLiveness: true,
    commandCooldownMs: 30_000,
    requestReady: true,
    requestSeeded: true,
    startedAt: new Date(NOW).toISOString(),
  };
}

function resultRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: "success",
    sessionId: SESSION_ID,
    commandId: COMMAND_ID,
    completedAt: new Date(NOW + 200).toISOString(),
    requestAccepted: true,
    counterTranslationActive: true,
    rawPayload: "must-not-escape",
    counterValue: 41,
    zoneObservation: zoneObservation(),
  };
}

function passiveObservationRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: SESSION_ID,
    observationId: OBSERVATION_ID,
    completedAt: new Date(NOW + 200).toISOString(),
    rawPayload: "must-not-escape",
    connectionTuple: "must-not-escape",
    zoneObservation: zoneObservation(),
  };
}

function zoneObservation(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    rawZone: "Act_08_03",
    buffs: [21, 22],
    debuffs: [25, 18],
    observedAt: new Date(NOW + 100).toISOString(),
    accountId: "must-not-escape",
  };
}
