import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ManagedSatanicZoneRefreshProvider,
  type ManagedSatanicZoneProviderRuntime,
} from "../../src/main/managed-satanic-zone-provider";
import type {
  ManagedSatanicZoneRelaySession,
  RelayJsonRead,
} from "../../src/main/satanic-zone-relay-runtime";

const NOW = Date.parse("2026-08-24T14:05:00.000Z");
const COMMAND_ID = "0123456789abcdef0123456789abcdef";
const SECOND_COMMAND_ID = "fedcba9876543210fedcba9876543210";
const SESSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION: ManagedSatanicZoneRelaySession = {
  sessionId: SESSION_ID,
  directory: path.resolve("test-managed-relay", `session-${SESSION_ID}`),
  pid: 1234,
  createdAt: NOW - 1000,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ManagedSatanicZoneRefreshProvider", () => {
  test("reports a missing managed runtime without presenting itself as experimental", async () => {
    const relay = runtime({
      ensureReady: vi.fn(async () => ({ ready: false, errorCode: "refresh_not_configured" as const })),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });

    await expect(provider.getAvailability()).resolves.toEqual({
      available: false,
      experimental: false,
      errorCode: "refresh_not_configured",
    });
    expect(provider.experimental).toBe(false);
  });

  test("commits a minimal command and returns a reusable sanitized observation", async () => {
    const relay = runtime({ readResult: vi.fn(async () => resultRead()) });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });

    await expect(provider.requestRefresh()).resolves.toEqual({
      accepted: true,
      errorCode: null,
      correlationId: COMMAND_ID,
    });
    expect(relay.commitCommand).toHaveBeenCalledWith(SESSION, {
      schemaVersion: 1,
      command: "refresh_satanic_zone",
      commandId: COMMAND_ID,
      sessionId: SESSION_ID,
      requestedAt: "2026-08-24T14:05:00.000Z",
      minimumDispatchSpacingMs: 30_000,
    });

    await expect(provider.waitForObservation(COMMAND_ID, { timeoutMs: 1000 })).resolves.toMatchObject({
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
    const outcome = await provider.waitForObservation(COMMAND_ID, { timeoutMs: 1000 });
    expect(outcome).toBeNull();
  });

  test("publishes sanitized passive observations once and rejects malformed, foreign, stale, or replayed files", () => {
    const relay = runtime();
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    const listener = vi.fn();
    provider.subscribeToPassiveObservations(listener);
    const observe = relay.subscribeToObservations.mock.calls[0]?.[0] as (
      value: { session: ManagedSatanicZoneRelaySession; read: RelayJsonRead },
    ) => void;

    observe({ session: SESSION, read: passiveObservationRead() });
    observe({ session: SESSION, read: passiveObservationRead() });
    observe({
      session: SESSION,
      read: passiveObservationRead({
        observationId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        completedAt: new Date(NOW + 150).toISOString(),
      }),
    });
    observe({
      session: SESSION,
      read: passiveObservationRead({ sessionId: "cccccccccccccccccccccccccccccccc" }),
    });
    observe({
      session: SESSION,
      read: passiveObservationRead({
        observationId: "dddddddddddddddddddddddddddddddd",
        completedAt: new Date(NOW - 60_000).toISOString(),
      }),
    });
    observe({ session: SESSION, read: { kind: "invalid" } });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      observedAt: NOW + 100,
      zone: expect.objectContaining({
        rawZone: "Act_08_03",
        pros: [{ id: 21, name: expect.any(String), description: expect.any(String) }, { id: 22, name: expect.any(String), description: expect.any(String) }],
        cons: [{ id: 25, name: expect.any(String), description: expect.any(String) }, { id: 18, name: expect.any(String), description: expect.any(String) }],
      }),
    }));
    expect(JSON.stringify(listener.mock.calls[0]?.[0])).not.toContain("accountId");
    expect(JSON.stringify(listener.mock.calls[0]?.[0])).not.toContain("rawPayload");
  });

  test("stops passive delivery after unsubscribe and runtime teardown", () => {
    const runtimeUnsubscribe = vi.fn();
    const relay = runtime({ subscribeToObservations: vi.fn(() => runtimeUnsubscribe) });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    const listener = vi.fn();
    const unsubscribe = provider.subscribeToPassiveObservations(listener);
    const observe = relay.subscribeToObservations.mock.calls[0]?.[0] as (
      value: { session: ManagedSatanicZoneRelaySession; read: RelayJsonRead },
    ) => void;

    unsubscribe();
    observe({ session: SESSION, read: passiveObservationRead() });
    expect(listener).not.toHaveBeenCalled();

    provider.dispose();
    expect(runtimeUnsubscribe).toHaveBeenCalledTimes(1);
    expect(relay.dispose).toHaveBeenCalledTimes(1);
  });

  test("defensively keeps dispatch closed until exactly 30 seconds after a commit", async () => {
    let now = NOW;
    const commandIds = [COMMAND_ID, SECOND_COMMAND_ID];
    const relay = runtime({
      now: vi.fn(() => now),
      createCommandId: vi.fn(() => commandIds.shift() ?? SECOND_COMMAND_ID),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });

    await expect(provider.requestRefresh()).resolves.toMatchObject({ accepted: true });
    now = NOW + 29_999;
    await expect(provider.requestRefresh()).resolves.toEqual({
      accepted: false,
      errorCode: "refresh_cooldown",
      correlationId: null,
    });
    now = NOW + 30_000;
    await expect(provider.requestRefresh()).resolves.toEqual({
      accepted: true,
      errorCode: null,
      correlationId: SECOND_COMMAND_ID,
    });
    expect(relay.commitCommand).toHaveBeenCalledTimes(2);
  });

  test("rejects a concurrent dispatch before a second helper handoff", async () => {
    let resolveReadiness!: () => void;
    const blocked = new Promise<void>((resolve) => { resolveReadiness = resolve; });
    const relay = runtime({
      ensureReady: vi.fn(async () => {
        await blocked;
        return { ready: true as const, session: SESSION };
      }),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });

    const first = provider.requestRefresh();
    await vi.waitFor(() => expect(relay.ensureReady).toHaveBeenCalledTimes(1));
    await expect(provider.requestRefresh()).resolves.toEqual({
      accepted: false,
      errorCode: "refresh_pending",
      correlationId: null,
    });
    resolveReadiness();
    await expect(first).resolves.toMatchObject({ accepted: true });
    expect(relay.commitCommand).toHaveBeenCalledTimes(1);
  });

  test("honors cancellation before atomic handoff", async () => {
    let resolveReadiness!: () => void;
    const blocked = new Promise<void>((resolve) => { resolveReadiness = resolve; });
    const relay = runtime({
      ensureReady: vi.fn(async () => {
        await blocked;
        return { ready: true as const, session: SESSION };
      }),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    const abort = new AbortController();

    const dispatch = provider.requestRefresh({ signal: abort.signal });
    await vi.waitFor(() => expect(relay.ensureReady).toHaveBeenCalledTimes(1));
    abort.abort();
    resolveReadiness();

    await expect(dispatch).resolves.toEqual({
      accepted: false,
      errorCode: "helper_unavailable",
      correlationId: null,
    });
    expect(relay.commitCommand).not.toHaveBeenCalled();
  });

  test("does not misreport a committed command as cancelled", async () => {
    let resolveCommit!: (value: "committed") => void;
    const commit = new Promise<"committed">((resolve) => { resolveCommit = resolve; });
    const relay = runtime({ commitCommand: vi.fn(async () => commit) });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    const abort = new AbortController();

    const dispatch = provider.requestRefresh({ signal: abort.signal });
    await vi.waitFor(() => expect(relay.commitCommand).toHaveBeenCalledTimes(1));
    abort.abort();
    resolveCommit("committed");

    await expect(dispatch).resolves.toEqual({
      accepted: true,
      errorCode: null,
      correlationId: COMMAND_ID,
    });
  });

  test.each([
    ["pending", "refresh_pending"],
    ["unavailable", "helper_unavailable"],
  ] as const)("maps a %s command handoff to a sanitized rejection", async (handoff, errorCode) => {
    const relay = runtime({ commitCommand: vi.fn(async () => handoff) });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });

    await expect(provider.requestRefresh()).resolves.toEqual({
      accepted: false,
      errorCode,
      correlationId: null,
    });
  });

  test.each([
    [{ kind: "invalid" } as const],
    [{ kind: "record", value: { ...resultRecord(), rawZone: "must-not-be-trusted", status: "future" } } as const],
  ])("fails a malformed matching result closed without consuming availability", async (read) => {
    const relay = runtime({ readResult: vi.fn(async () => read) });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    await provider.requestRefresh();

    await expect(provider.waitForObservation(COMMAND_ID, { timeoutMs: 1000 })).resolves.toEqual({
      kind: "terminal",
      errorCode: "helper_failed",
      availabilityConsumed: false,
    });
  });

  test.each([
    ["rejected", "helper_rejected"],
    ["failed", "helper_failed"],
    ["timeout", "response_timeout"],
  ] as const)("settles a helper %s result without disabling future refreshes", async (status, errorCode) => {
    const relay = runtime({
      readResult: vi.fn(async () => ({
        kind: "record" as const,
        value: { ...resultRecord(), status },
      })),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    await provider.requestRefresh();

    await expect(provider.waitForObservation(COMMAND_ID, { timeoutMs: 1000 })).resolves.toEqual({
      kind: "terminal",
      errorCode,
      availabilityConsumed: false,
    });
  });

  test("times out and closes its watcher even when a result read never settles", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const relay = runtime({
      readResult: vi.fn(async () => new Promise<RelayJsonRead>(() => undefined)),
      watchResult: vi.fn(() => ({ close })),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    await provider.requestRefresh();

    const waiting = provider.waitForObservation(COMMAND_ID, { timeoutMs: 250 });
    await vi.advanceTimersByTimeAsync(250);

    await expect(waiting).resolves.toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(relay.cancelTimeout).toHaveBeenCalledTimes(1);
  });

  test("aborts a pending result wait without reading or retrying", async () => {
    const close = vi.fn();
    const relay = runtime({
      readResult: vi.fn(async () => ({ kind: "missing" as const })),
      watchResult: vi.fn(() => ({ close })),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    await provider.requestRefresh();
    const abort = new AbortController();

    const waiting = provider.waitForObservation(COMMAND_ID, { timeoutMs: 1000, signal: abort.signal });
    await vi.waitFor(() => expect(relay.readResult).toHaveBeenCalledTimes(1));
    abort.abort();

    await expect(waiting).resolves.toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(relay.readResult).toHaveBeenCalledTimes(1);
  });

  test("disposes only its owned runtime and refuses later work", async () => {
    const relay = runtime();
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });

    expect(provider.captureProcessIds()).toEqual([1234]);

    provider.dispose();
    provider.dispose();

    expect(relay.dispose).toHaveBeenCalledTimes(1);
    expect(provider.captureProcessIds()).toEqual([]);
    await expect(provider.getAvailability()).resolves.toMatchObject({
      available: false,
      errorCode: "helper_unavailable",
    });
    await expect(provider.requestRefresh()).resolves.toMatchObject({
      accepted: false,
      errorCode: "helper_unavailable",
    });
    expect(relay.ensureReady).not.toHaveBeenCalled();
  });

  test("stops interception reversibly without clearing the transport cooldown", async () => {
    let now = NOW;
    const relay = runtime({ now: vi.fn(() => now) });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    await provider.requestRefresh();

    provider.stop();

    expect(relay.stop).toHaveBeenCalledTimes(1);
    await expect(provider.getAvailability()).resolves.toMatchObject({ available: true });
    await expect(provider.requestRefresh()).resolves.toMatchObject({
      accepted: false,
      errorCode: "refresh_cooldown",
    });
    now = NOW + 30_000;
    await expect(provider.requestRefresh()).resolves.toMatchObject({ accepted: true });
  });

  test("a reversible stop closes an active result watcher immediately", async () => {
    const close = vi.fn();
    const relay = runtime({
      readResult: vi.fn(async () => ({ kind: "missing" as const })),
      watchResult: vi.fn(() => ({ close })),
    });
    const provider = new ManagedSatanicZoneRefreshProvider({ runtime: relay });
    await provider.requestRefresh();
    const waiting = provider.waitForObservation(COMMAND_ID, { timeoutMs: 5000 });
    await vi.waitFor(() => expect(relay.readResult).toHaveBeenCalledTimes(1));

    provider.stop();

    await expect(waiting).resolves.toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(relay.cancelTimeout).toHaveBeenCalledTimes(1);
  });
});

function runtime(
  overrides: Partial<ManagedSatanicZoneProviderRuntime> = {},
): ManagedSatanicZoneProviderRuntime & Record<string, ReturnType<typeof vi.fn>> {
  const relay = {
    ensureReady: vi.fn(async () => ({ ready: true as const, session: SESSION })),
    commitCommand: vi.fn(async () => "committed" as const),
    readResult: vi.fn(async () => ({ kind: "missing" as const })),
    watchResult: vi.fn(() => ({ close: vi.fn() })),
    subscribeToObservations: vi.fn(() => vi.fn()),
    scheduleTimeout: vi.fn((callback: () => void, timeoutMs: number) => setTimeout(callback, timeoutMs)),
    cancelTimeout: vi.fn((timeout: ReturnType<typeof setTimeout>) => clearTimeout(timeout)),
    createCommandId: vi.fn(() => COMMAND_ID),
    captureProcessIds: vi.fn(() => [SESSION.pid]),
    now: vi.fn(() => NOW),
    stop: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
  return relay as ManagedSatanicZoneProviderRuntime & Record<string, ReturnType<typeof vi.fn>>;
}

function resultRead(): RelayJsonRead {
  return { kind: "record", value: resultRecord() };
}

function passiveObservationRead(overrides: Record<string, unknown> = {}): RelayJsonRead {
  return {
    kind: "record",
    value: {
      schemaVersion: 1,
      sessionId: SESSION_ID,
      observationId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      completedAt: new Date(NOW + 200).toISOString(),
      rawPayload: "must-not-escape",
      zoneObservation: {
        schemaVersion: 1,
        rawZone: "Act_08_03",
        buffs: [21, 22],
        debuffs: [25, 18],
        observedAt: new Date(NOW + 100).toISOString(),
        accountId: "must-not-escape",
      },
      ...overrides,
    },
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
    zoneObservation: {
      schemaVersion: 1,
      rawZone: "Act_08_03",
      buffs: [21, 22],
      debuffs: [25, 18],
      observedAt: new Date(NOW + 100).toISOString(),
      accountId: "must-not-escape",
    },
  };
}
