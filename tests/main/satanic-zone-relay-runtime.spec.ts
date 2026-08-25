import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ManagedSatanicZoneRelayRuntime,
  type ManagedRelayChild,
  type ManagedSatanicZoneRelayRuntimeDependencies,
} from "../../src/main/satanic-zone-relay-runtime";
import {
  satanicZoneRelayResourcesPath,
  wrapManagedRelayChild,
} from "../../src/main/satanic-zone-relay-runtime-io";
import { createSatanicZoneRelayCommand } from "../../src/main/satanic-zone-relay-protocol";

const NOW = Date.parse("2026-08-24T14:05:00.000Z");
const SESSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMAND_ID = "0123456789abcdef0123456789abcdef";
const OBSERVATION_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const RESOURCES = path.resolve("managed-runtime", "resources");
const STATE_ROOT = path.resolve("managed-runtime", "state");
const SCRIPT = path.join(RESOURCES, "satanic-zone-relay", "addon.py");
const EXECUTABLE = path.join(RESOURCES, "satanic-zone-relay", "mitmdump.exe");
const SESSION_DIRECTORY = path.join(STATE_ROOT, `session-${SESSION_ID}`);

afterEach(() => {
  vi.useRealTimers();
});

describe("ManagedSatanicZoneRelayRuntime", () => {
  test("resolves source resources in development and process resources when packaged", () => {
    const appPath = path.resolve("app-root");
    const resourcesPath = path.resolve("packaged-resources");

    expect(satanicZoneRelayResourcesPath({ isPackaged: false, appPath, resourcesPath }))
      .toBe(path.join(appPath, "resources"));
    expect(satanicZoneRelayResourcesPath({ isPackaged: true, appPath, resourcesPath }))
      .toBe(resourcesPath);
  });

  test("fails closed before filesystem or process access when product roots are relative", async () => {
    const dependencies = runtimeDependencies();
    const relay = new ManagedSatanicZoneRelayRuntime({
      resourcesPath: "resources",
      stateRoot: "state",
      dependencies,
    });

    await expect(relay.ensureReady()).resolves.toEqual({
      ready: false,
      errorCode: "refresh_not_configured",
    });
    expect(dependencies.isFile).not.toHaveBeenCalled();
    expect(dependencies.spawnRelay).not.toHaveBeenCalled();
  });

  test("reports a missing relay script or executable without spawning", async () => {
    const dependencies = runtimeDependencies({ isFile: vi.fn(async () => false) });
    const relay = managedRuntime(dependencies);

    await expect(relay.ensureReady()).resolves.toEqual({
      ready: false,
      errorCode: "refresh_not_configured",
    });
    expect(dependencies.spawnRelay).not.toHaveBeenCalled();
  });

  test("buffers an asynchronous spawn error until the runtime listener is registered", () => {
    const rawChild = Object.assign(new EventEmitter(), {
      pid: undefined as number | undefined,
      exitCode: null as number | null,
      killed: false,
      kill: vi.fn(() => true),
    });
    const child = wrapManagedRelayChild(rawChild as never);
    expect(() => rawChild.emit("error", new Error("spawn failed"))).not.toThrow();

    const listener = vi.fn();
    child.onError(listener);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("starts one hidden shell-free local-mode relay and validates its declared capabilities", async () => {
    const dependencies = runtimeDependencies();
    const relay = managedRuntime(dependencies);

    await expect(relay.ensureReady()).resolves.toEqual({
      ready: true,
      session: {
        sessionId: SESSION_ID,
        directory: SESSION_DIRECTORY,
        pid: 1234,
        createdAt: NOW,
      },
    });
    expect(dependencies.makeDirectory).toHaveBeenCalledWith(SESSION_DIRECTORY);
    expect(dependencies.spawnRelay).toHaveBeenCalledWith(
      EXECUTABLE,
      [
        "--mode",
        "local:Hero_Siege.exe",
        "--flow-detail",
        "0",
        "--quiet",
        "-s",
        SCRIPT,
      ],
      {
        cwd: path.dirname(SCRIPT),
        environment: expect.objectContaining({
          HSC_SZ_RELAY_STATE_DIR: SESSION_DIRECTORY,
          HSC_SZ_RELAY_SESSION_ID: SESSION_ID,
          HSC_SZ_RELAY_COMMAND_COOLDOWN_MS: "30000",
          HSC_SZ_RELAY_PARENT_PID: String(process.pid),
          PYTHONUNBUFFERED: "1",
        }),
      },
    );
    expect(relay.captureProcessIds()).toEqual([1234]);

    await relay.ensureReady();
    expect(dependencies.spawnRelay).toHaveBeenCalledTimes(1);
  });

  test("watches and initially reads passive observations as soon as relay startup begins", async () => {
    let resolveReady!: (value: { kind: "record"; value: Record<string, unknown> }) => void;
    const blockedReady = new Promise<{ kind: "record"; value: Record<string, unknown> }>((resolve) => {
      resolveReady = resolve;
    });
    const dependencies = runtimeDependencies({
      readJson: vi.fn(async (targetPath: string) => (
        path.basename(targetPath) === "observation.json"
          ? { kind: "record" as const, value: passiveObservationRecord() }
          : blockedReady
      )),
    });
    const relay = managedRuntime(dependencies);
    const listener = vi.fn();
    relay.subscribeToObservations(listener);

    const readiness = relay.ensureReady();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    expect(listener).toHaveBeenCalledWith({
      session: {
        sessionId: SESSION_ID,
        directory: SESSION_DIRECTORY,
        pid: 1234,
        createdAt: NOW,
      },
      read: { kind: "record", value: passiveObservationRecord() },
    });
    expect(dependencies.watchDirectory).toHaveBeenCalledWith(
      SESSION_DIRECTORY,
      "observation.json",
      expect.any(Function),
      expect.any(Function),
    );

    resolveReady({ kind: "record", value: readyRecord() });
    await expect(readiness).resolves.toMatchObject({ ready: true });
  });

  test.each(["unsubscribe", "stop", "dispose", "exit"] as const)(
    "closes the passive observation watcher on %s",
    async (action) => {
      const observationClose = vi.fn();
      const dependencies = runtimeDependencies({
        watchDirectory: vi.fn((_target, filename) => ({
          close: filename === "observation.json" ? observationClose : vi.fn(),
        })),
      });
      const child = fakeChild();
      dependencies.spawnRelay.mockReturnValue(child);
      const relay = managedRuntime(dependencies);
      const unsubscribe = relay.subscribeToObservations(vi.fn());
      await relay.ensureReady();

      if (action === "unsubscribe") unsubscribe();
      else if (action === "stop") relay.stop();
      else if (action === "dispose") relay.dispose();
      else child.exit();

      expect(observationClose).toHaveBeenCalledTimes(1);
    },
  );

  test("drops a passive observation when the owned session exits during its read", async () => {
    const child = fakeChild();
    let resolveObservation!: (value: { kind: "record"; value: Record<string, unknown> }) => void;
    const blockedObservation = new Promise<{ kind: "record"; value: Record<string, unknown> }>((resolve) => {
      resolveObservation = resolve;
    });
    const dependencies = runtimeDependencies({
      spawnRelay: vi.fn(() => child),
      readJson: vi.fn(async (targetPath: string) => (
        path.basename(targetPath) === "observation.json"
          ? blockedObservation
          : { kind: "record" as const, value: readyRecord() }
      )),
    });
    const relay = managedRuntime(dependencies);
    const listener = vi.fn();
    relay.subscribeToObservations(listener);

    await expect(relay.ensureReady()).resolves.toMatchObject({ ready: true });
    child.exit();
    resolveObservation({ kind: "record", value: passiveObservationRecord() });
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });

  test("scrubs inherited research and forged relay variables before spawning product mode", async () => {
    const dependencies = runtimeDependencies();
    const relay = managedRuntime(dependencies, {
      environment: {
        PATH: "trusted-path",
        KEEP_ME: "preserved",
        HSC_SZ_POC_MODE: "research",
        hsc_sz_poc_uat_relax_target_anchor_scope_recheck: "1",
        Hsc_Sz_Poc_Response_Timeout_Seconds: "999",
        HSC_SZ_RELAY_STATE_DIR: "forged-state",
        hsc_sz_relay_session_id: COMMAND_ID,
        Hsc_Sz_Relay_Command_Cooldown_Ms: "1",
        HSC_SZ_RELAY_PARENT_PID: "1",
        hsc_sz_relay_untrusted: "must-not-survive",
        pythonunbuffered: "0",
      },
    });

    await expect(relay.ensureReady()).resolves.toMatchObject({ ready: true });
    const spawnOptions = dependencies.spawnRelay.mock.calls[0]?.[2] as {
      environment: NodeJS.ProcessEnv;
    };
    const childEnvironment = spawnOptions.environment;
    const normalizedKeys = Object.keys(childEnvironment).map((key) => key.toUpperCase());

    expect(childEnvironment).toMatchObject({
      PATH: "trusted-path",
      KEEP_ME: "preserved",
      HSC_SZ_RELAY_STATE_DIR: SESSION_DIRECTORY,
      HSC_SZ_RELAY_SESSION_ID: SESSION_ID,
      HSC_SZ_RELAY_COMMAND_COOLDOWN_MS: "30000",
      HSC_SZ_RELAY_PARENT_PID: String(process.pid),
      PYTHONUNBUFFERED: "1",
    });
    expect(normalizedKeys.filter((key) => key.startsWith("HSC_SZ_POC_"))).toEqual([]);
    expect(normalizedKeys.filter((key) => key.startsWith("HSC_SZ_RELAY_")).sort()).toEqual([
      "HSC_SZ_RELAY_COMMAND_COOLDOWN_MS",
      "HSC_SZ_RELAY_PARENT_PID",
      "HSC_SZ_RELAY_SESSION_ID",
      "HSC_SZ_RELAY_STATE_DIR",
    ]);
    expect(normalizedKeys.filter((key) => key === "PYTHONUNBUFFERED")).toEqual(["PYTHONUNBUFFERED"]);
  });

  test("ignores an unsafe process-filter override", async () => {
    const dependencies = runtimeDependencies();
    const relay = managedRuntime(dependencies, { processFilter: "Hero Siege.exe --set unsafe=true" });

    await expect(relay.ensureReady()).resolves.toMatchObject({ ready: true });
    expect(dependencies.spawnRelay).toHaveBeenCalledWith(
      EXECUTABLE,
      expect.arrayContaining(["local:Hero_Siege.exe"]),
      expect.any(Object),
    );
  });

  test.each([
    ["session", { sessionId: COMMAND_ID }],
    ["pid", { pid: 9999 }],
    ["repeatability", { repeatableRefresh: false }],
    ["counter translation", { counterTranslation: false }],
    ["parent liveness", { parentLiveness: false }],
    ["helper cooldown", { commandCooldownMs: 29_999 }],
    ["timestamp", { startedAt: "2026-02-31T14:05:00Z" }],
  ])("rejects mismatched or missing %s readiness evidence", async (_label, overrides) => {
    const dependencies = runtimeDependencies({
      readJson: vi.fn(async () => ({
        kind: "record" as const,
        value: { ...readyRecord(), ...overrides },
      })),
    });
    const relay = managedRuntime(dependencies);

    await expect(relay.ensureReady()).resolves.toEqual({
      ready: false,
      errorCode: "helper_unavailable",
    });
  });

  test("accepts a healthy helper without speculative seed or immediate-dispatch gating", async () => {
    const close = vi.fn();
    const readJson = vi.fn().mockResolvedValue({
      kind: "record" as const,
      value: { ...readyRecord(), requestReady: false, requestSeeded: false },
    });
    const dependencies = runtimeDependencies({
      readJson,
      watchDirectory: vi.fn(() => ({ close })),
    });
    const relay = managedRuntime(dependencies);

    await expect(relay.ensureReady()).resolves.toMatchObject({ ready: true });

    expect(dependencies.spawnRelay).toHaveBeenCalledTimes(1);
    expect(readJson).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(dependencies.cancelTimeout).toHaveBeenCalledTimes(1);
  });

  test("rejects seeded readiness when the owned relay closes while its readiness file is being read", async () => {
    const child = fakeChild();
    let resolveRead!: (read: { kind: "record"; value: Record<string, unknown> }) => void;
    const blockedRead = new Promise<{ kind: "record"; value: Record<string, unknown> }>((resolve) => {
      resolveRead = resolve;
    });
    const dependencies = runtimeDependencies({
      spawnRelay: vi.fn(() => child),
      readJson: vi.fn(async () => blockedRead),
    });
    const relay = managedRuntime(dependencies);

    const readiness = relay.ensureReady();
    await vi.waitFor(() => expect(dependencies.readJson).toHaveBeenCalledTimes(1));
    child.exit();
    resolveRead({
      kind: "record",
      value: { ...readyRecord(), requestReady: false, requestSeeded: true },
    });

    await expect(readiness).resolves.toEqual({
      ready: false,
      errorCode: "helper_unavailable",
    });
  });

  test("closes its watcher and reports not ready after a bounded startup wait", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const dependencies = runtimeDependencies({
      readJson: vi.fn(async () => ({ kind: "missing" as const })),
      watchDirectory: vi.fn(() => ({ close })),
    });
    const relay = managedRuntime(dependencies, { startupTimeoutMs: 250 });

    const readiness = relay.ensureReady();
    await vi.advanceTimersByTimeAsync(250);

    await expect(readiness).resolves.toEqual({ ready: false, errorCode: "helper_not_ready" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(dependencies.cancelTimeout).toHaveBeenCalledTimes(1);
  });

  test("aborts startup readiness while its first bounded read remains blocked", async () => {
    const close = vi.fn();
    const dependencies = runtimeDependencies({
      readJson: vi.fn(async () => new Promise<never>(() => undefined)),
      watchDirectory: vi.fn(() => ({ close })),
    });
    const relay = managedRuntime(dependencies);
    const abort = new AbortController();

    const readiness = relay.ensureReady(abort.signal);
    await vi.waitFor(() => expect(dependencies.readJson).toHaveBeenCalledTimes(1));
    abort.abort();

    await expect(readiness).resolves.toEqual({ ready: false, errorCode: "helper_unavailable" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(dependencies.cancelTimeout).toHaveBeenCalledTimes(1);
  });

  test("atomically commits only to its current owned session and preserves an occupied command", async () => {
    const dependencies = runtimeDependencies();
    const relay = managedRuntime(dependencies);
    const readiness = await relay.ensureReady();
    if (!readiness.ready) throw new Error("expected ready test relay");
    const command = createSatanicZoneRelayCommand(COMMAND_ID, SESSION_ID, NOW);
    if (!command) throw new Error("expected valid test command");

    await expect(relay.commitCommand(readiness.session, command)).resolves.toBe("committed");
    expect(dependencies.commitJson).toHaveBeenCalledWith(
      path.join(SESSION_DIRECTORY, "command.json"),
      command,
    );

    dependencies.commitJson.mockResolvedValueOnce("occupied");
    await expect(relay.commitCommand(readiness.session, command)).resolves.toBe("pending");
    await expect(relay.commitCommand({ ...readiness.session, sessionId: COMMAND_ID }, command)).resolves.toBe("unavailable");
  });

  test("reads and watches only the command-correlated result filename", async () => {
    const dependencies = runtimeDependencies();
    const relay = managedRuntime(dependencies);
    const readiness = await relay.ensureReady();
    if (!readiness.ready) throw new Error("expected ready test relay");
    const changed = vi.fn();
    const failed = vi.fn();

    await relay.readResult(readiness.session, COMMAND_ID);
    relay.watchResult(readiness.session, COMMAND_ID, changed, failed);

    const expectedPath = path.join(SESSION_DIRECTORY, `result-${COMMAND_ID}.json`);
    expect(dependencies.readJson).toHaveBeenLastCalledWith(expectedPath);
    expect(dependencies.watchDirectory).toHaveBeenLastCalledWith(
      SESSION_DIRECTORY,
      path.basename(expectedPath),
      changed,
      failed,
    );
  });

  test("exposes only the live owned child PID and terminates it once on dispose", async () => {
    const child = fakeChild();
    const dependencies = runtimeDependencies({ spawnRelay: vi.fn(() => child) });
    const relay = managedRuntime(dependencies);
    await relay.ensureReady();

    expect(relay.captureProcessIds()).toEqual([1234]);
    relay.dispose();
    relay.dispose();

    expect(child.terminate).toHaveBeenCalledTimes(1);
    expect(relay.captureProcessIds()).toEqual([]);
    await expect(relay.ensureReady()).resolves.toEqual({
      ready: false,
      errorCode: "helper_unavailable",
    });
    expect(dependencies.spawnRelay).toHaveBeenCalledTimes(1);
  });

  test("stops an owned child reversibly and starts a fresh session when enabled again", async () => {
    const firstChild = fakeChild(1234);
    const secondChild = fakeChild(5678);
    const ids = [SESSION_ID, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
    const dependencies = runtimeDependencies({
      createId: vi.fn(() => ids.shift() ?? SESSION_ID),
      spawnRelay: vi.fn()
        .mockReturnValueOnce(firstChild)
        .mockReturnValueOnce(secondChild),
      readJson: vi.fn(async (targetPath: string) => {
        const sessionId = path.basename(path.dirname(targetPath)).replace("session-", "");
        return {
          kind: "record" as const,
          value: {
            ...readyRecord(),
            sessionId,
            pid: sessionId === SESSION_ID ? 1234 : 5678,
          },
        };
      }),
    });
    const relay = managedRuntime(dependencies);
    await expect(relay.ensureReady()).resolves.toMatchObject({ ready: true });

    relay.stop();
    expect(firstChild.terminate).toHaveBeenCalledTimes(1);
    expect(relay.captureProcessIds()).toEqual([]);

    await expect(relay.ensureReady()).resolves.toMatchObject({
      ready: true,
      session: { sessionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", pid: 5678 },
    });
    expect(dependencies.spawnRelay).toHaveBeenCalledTimes(2);
  });

  test("drops a child PID immediately when the owned relay exits", async () => {
    const child = fakeChild();
    const dependencies = runtimeDependencies({ spawnRelay: vi.fn(() => child) });
    const relay = managedRuntime(dependencies);
    await relay.ensureReady();

    child.exit();

    expect(relay.captureProcessIds()).toEqual([]);
  });
});

function managedRuntime(
  dependencies: ManagedSatanicZoneRelayRuntimeDependencies,
  overrides: Partial<ConstructorParameters<typeof ManagedSatanicZoneRelayRuntime>[0]> = {},
) {
  return new ManagedSatanicZoneRelayRuntime({
    resourcesPath: RESOURCES,
    stateRoot: STATE_ROOT,
    relayScriptPath: SCRIPT,
    relayExecutablePath: EXECUTABLE,
    environment: { PATH: "" },
    dependencies,
    ...overrides,
  });
}

function runtimeDependencies(
  overrides: Partial<ManagedSatanicZoneRelayRuntimeDependencies> = {},
): ManagedSatanicZoneRelayRuntimeDependencies & Record<string, ReturnType<typeof vi.fn>> {
  const dependencies = {
    isFile: vi.fn(async (targetPath: string) => targetPath === SCRIPT || targetPath === EXECUTABLE),
    makeDirectory: vi.fn(async () => undefined),
    readJson: vi.fn(async (targetPath: string) => (
      path.basename(targetPath) === "ready.json"
        ? { kind: "record" as const, value: readyRecord() }
        : { kind: "missing" as const }
    )),
    commitJson: vi.fn(async () => "committed" as const),
    spawnRelay: vi.fn(() => fakeChild()),
    watchDirectory: vi.fn(() => ({ close: vi.fn() })),
    scheduleTimeout: vi.fn((callback: () => void, timeoutMs: number) => setTimeout(callback, timeoutMs)),
    cancelTimeout: vi.fn((timeout: ReturnType<typeof setTimeout>) => clearTimeout(timeout)),
    createId: vi.fn(() => SESSION_ID),
    now: vi.fn(() => NOW),
    ...overrides,
  };
  return dependencies as ManagedSatanicZoneRelayRuntimeDependencies & Record<string, ReturnType<typeof vi.fn>>;
}

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
    rawEndpoint: "must-not-be-trusted",
  };
}

function passiveObservationRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: SESSION_ID,
    observationId: OBSERVATION_ID,
    completedAt: new Date(NOW + 200).toISOString(),
    zoneObservation: {
      schemaVersion: 1,
      rawZone: "Act_08_03",
      buffs: [21, 22],
      debuffs: [25, 18],
      observedAt: new Date(NOW + 100).toISOString(),
    },
  };
}

function fakeChild(pid = 1234): ManagedRelayChild & {
  terminate: ReturnType<typeof vi.fn>;
  exit(): void;
} {
  let running = true;
  const exitListeners: Array<() => void> = [];
  const errorListeners: Array<() => void> = [];
  const terminate = vi.fn(() => { running = false; });
  return {
    pid,
    isRunning: () => running,
    onExit: (listener) => { exitListeners.push(listener); },
    onError: (listener) => { errorListeners.push(listener); },
    terminate,
    exit: () => {
      running = false;
      for (const listener of exitListeners) listener();
    },
  };
}
