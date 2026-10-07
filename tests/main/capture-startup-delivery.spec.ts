import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const fake = vi.hoisted(() => ({ caps: [] as any[], exec: vi.fn(), launch: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: fake.exec, default: { execFile: fake.exec } }));
vi.mock("electron", () => ({ shell: { openExternal: fake.launch } }));
vi.mock("node:module", () => { const createRequire = () => () => ({ Cap: class {
  minimum = 16_000; buffered: Buffer[] = []; bytes!: Buffer; filter = ""; receive!: (n: number, truncated: boolean) => void;
  close = vi.fn();
  constructor() { fake.caps.push(this); }
  static findDevice() { return "invented-device"; }
  open(_device: string, filter: string, _capacity: number, bytes: Buffer) { this.bytes = bytes; this.filter = filter; return "RAW"; }
  on(_event: string, receive: typeof this.receive) { this.receive = receive; }
  setMinBytes = vi.fn((minimum: number) => { this.minimum = minimum; });
  emit(bytes: Buffer) { this.buffered.push(bytes); if (this.buffered.reduce((sum, b) => sum + b.length, 0) < this.minimum) return;
    for (const bytes of this.buffered.splice(0)) { bytes.copy(this.bytes); this.receive(bytes.length, false); } }
} }); return { createRequire, default: { createRequire } }; });
import { openPacketCapture } from "../../src/main/capture-adapter";
import { createDiagnosticCaptureDependencies, type SatanicZoneWatchDiagnostic } from "../../src/main/satanic-zone-diagnostic-runtime";
import { GameCaptureCoordinator } from "../../src/main/game-capture-coordinator";
import { CaptureService, type CaptureUpdate } from "../../src/main/capture";
import { InitializedSatanicZoneRefreshProvider } from "../../src/main/initialized-satanic-zone-provider";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { SatanicZoneController } from "../../src/main/satanic-zone-controller";
import { ElectronSatanicZoneTestRuntime } from "../../src/main/electron-satanic-zone-test-runtime";
import { createInitialCompanionState } from "../../src/shared/initial-state";
import { replayInitialization, replayPacket, replayScope } from "../fixtures/network-replay";
afterEach(() => { vi.useRealTimers(); fake.exec.mockReset(); fake.launch.mockReset(); fake.caps.splice(0); });

describe("startup capture delivery, with an invented buffering Windows adapter", () => {
  test.each(["process", "endpoint"])("HSC launch buffers the complete handshake while %s discovery lags and gameplay capture rearms", async delayed => {
    vi.useFakeTimers();
    let launched = false, discovered = false;
    const network = () => ({ gameProcessIds: launched && (delayed === "endpoint" || discovered) ? [42] : [], antiCheatProcessIds: [],
      connections: launched && (delayed === "endpoint" || discovered) ? [
        { ...replayScope, remotePort: 26921, localPort: 5001, owningProcess: 42, state: "established" },
        ...(discovered ? [{ ...replayScope, localPort: 5000, owningProcess: 42, state: "established" }] : []),
      ] : [] });
    fake.exec.mockImplementation((_exe, args, _options, done) => {
      const script = args.at(-1);
      if (script.includes("Get-NetRoute")) done(null, JSON.stringify({ address: replayScope.localAddress, metric: 1 }), "");
      else if (script.includes("Get-Service")) done(null, "Running", "");
      else if (script.includes("Get-ItemProperty")) done(null, JSON.stringify({ AdminOnly: 0, WinPcapCompatible: 1 }), "");
      else done(null, JSON.stringify({ ...network(), connections: network().connections.map(flow => ({
        OwningProcess: flow.owningProcess, LocalAddress: flow.localAddress, LocalPort: flow.localPort,
        RemoteAddress: flow.remoteAddress, RemotePort: flow.remotePort, State: flow.state })) }), "");
    });
    const runtime = new ElectronSatanicZoneTestRuntime(), state = createInitialCompanionState(), diagnostics: unknown[] = [];
    const stages: Record<string, unknown>[] = [];
    const watch = (value: SatanicZoneWatchDiagnostic) => stages.push({ type: "sz-watch-stage", ...value });
    let zone!: SatanicZoneController;
    const provider = new InitializedSatanicZoneRefreshProvider({ canPrepare: () => true,
      onReadinessDiagnostic: value => diagnostics.push(value), onWatchDiagnostic: watch, onPreparation: value => zone?.setPreparation(value),
      dependencies: { ...createDiagnosticCaptureDependencies(false, "startup-api", watch), attempt: runtime.dependencies.attempt } });
    zone = new SatanicZoneController({ provider, onStateChange: value => { state.satanicZone = value; } });
    // Mirror production applyCaptureUpdate's lifecycle/connection/rearming calls.
    const apply = (update: CaptureUpdate) => {
      const previousRunning = state.captureRunning;
      if (update.running !== undefined) state.captureRunning = update.running;
      if (update.status) state.captureStatus = update.status;
      provider.observeCaptureUpdate(update, previousRunning);
      if (update.connections) provider.observeConnections(update.connections);
      if (state.captureRunning && state.captureStatus === "running" && (!previousRunning || update.observationGap
        || provider.preparation.phase === "suspended")) void provider.preparePassively();
    };
    const service = new CaptureService(apply, undefined, undefined, undefined,
      payload => provider.observeSessionPayload(payload), ids => provider.observeProcessIds(ids));
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service,
      addLog: () => {}, publishState: () => {}, writeAppLog: (type, data) => stages.push({ type, ...data }), beforeCapture: () => provider.preparePassively() });
    fake.launch.mockImplementation(async () => {
      expect(fake.caps).toHaveLength(1); const listener = fake.caps[0];
      expect(listener.receive).toBeTypeOf("function"); expect(listener.minimum).toBe(0);
      expect(listener.filter).toBe(`ip and tcp and host ${replayScope.localAddress} and (port 6668 or port 6669)`);
      launched = true;
      for (const packet of replayInitialization()) listener.emit(replayPacket(packet).subarray(14));
    });
    try {
      await coordinator.launchOrCapture({ launchThroughSteam: true }); coordinator.startMonitor();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(provider.preparation.phase).toBe("collecting");
      expect(diagnostics).toContainEqual(expect.objectContaining({ freshSyn: true, attributed: false, selectionStatus: "waiting-owner" }));
      expect(fake.caps[0].close).not.toHaveBeenCalled(); expect(runtime.attemptCount).toBe(0);
      discovered = true; await vi.advanceTimersByTimeAsync(8_000);
      expect(zone.getState()).toMatchObject({ current: { rawZone: "Act_04_03" }, refreshPreparation: { phase: "ready" } });
      expect(fake.caps[0].close).not.toHaveBeenCalled(); expect(runtime.attemptCount).toBe(0);
      expect(stages).toContainEqual({ type: "sz-watch-stage", stage: "interface_selected", source: "default_route", gamePresent: false, apiFlows: 0 });
      const stageNames = stages.map(value => value.stage);
      expect(stageNames.indexOf("listener_ready")).toBeLessThan(stageNames.indexOf("shell_invoked"));
      expect(stageNames.indexOf("shell_invoked")).toBeLessThan(stageNames.indexOf("syn_selected"));
      expect(stageNames.indexOf("syn_selected")).toBeLessThan(stageNames.indexOf("owner_selected"));
      expect(stageNames).not.toContain("initialization_reset"); expect(stageNames).not.toContain("listener_closed");
      expect(JSON.stringify(stages)).not.toMatch(/CANARY|192\.0\.2|198\.51\.100|account|checksum|owningProcess|localPort/);
      expect((await provider.requestRefresh()).accepted).toBe(true); expect(runtime.attemptCount).toBe(1);
    } finally { coordinator.stopMonitor(); coordinator.clearLaunchCaptureTimer(); service.stop(); zone.dispose(); provider.dispose(); }
  });
  test("launch/runtime/parser/provider/cache wiring retains native Ready and saves after explicit portable unlock", async () => {
    vi.useFakeTimers();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-startup-delivery-")), file = path.join(directory, "login.encrypted");
    const runtime = new ElectronSatanicZoneTestRuntime();
    let game = false, zone: SatanicZoneController, provider: InitializedSatanicZoneRefreshProvider;
    const network = () => ({ gameProcessIds: game ? [42] : [], antiCheatProcessIds: [], connections: game
      ? [{ ...replayScope, localPort: 5000, owningProcess: 42, state: "established" }] : [] });
    fake.exec.mockImplementation((_exe, args, _options, done) => {
      const script = args.at(-1);
      expect(script).not.toContain("Get-FileHash"); expect(script).not.toContain("Get-CimInstance");
      if (script.includes("Get-NetRoute")) done(null, JSON.stringify({ address: replayScope.localAddress, metric: 1 }), "");
      else done(null, JSON.stringify({ ...network(), connections: network().connections.map(flow => ({
        OwningProcess: flow.owningProcess, LocalAddress: flow.localAddress, LocalPort: flow.localPort,
        RemoteAddress: flow.remoteAddress, RemotePort: flow.remotePort, State: flow.state })) }), "");
    });
    const diagnostics: unknown[] = [];
    const cache = new SatanicZoneLoginCache({ store: new SatanicZoneLoginCacheStore(file),
      networkState: async () => network(),
      onChange: () => provider?.cacheChanged(), onDiagnostic: (stage, result) => diagnostics.push({ stage, result }) });
    provider = new InitializedSatanicZoneRefreshProvider({ loginCache: cache, canPrepare: () => true,
      onPreparation: preparation => zone?.setPreparation(preparation), dependencies: {
        ...createDiagnosticCaptureDependencies(false, "startup-api"), attempt: runtime.dependencies.attempt } });
    zone = new SatanicZoneController({ provider, onStateChange: () => {} }); cache.configure(true);
    expect(await cache.unlock("SYNTHETIC startup cache passphrase")).toBe(true);
    const state = createInitialCompanionState();
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => ({ hasHeroSiegeProcess: async () => false }) as any,
      addLog: () => {}, publishState: () => {}, writeAppLog: () => {}, beforeCapture: () => provider.preparePassively() });
    fake.launch.mockImplementation(async () => {
      const cap = fake.caps.at(-1); expect(cap.receive).toBeTypeOf("function"); game = true;
      for (const packet of replayInitialization()) cap.emit(replayPacket(packet).subarray(14));
    });
    try {
      await coordinator.launchOrCapture({ launchThroughSteam: true }); await vi.advanceTimersByTimeAsync(1000);
      expect(zone.getState()).toMatchObject({ source: "captured", current: { rawZone: "Act_04_03" }, refreshPreparation: { phase: "ready" } });
      provider.observeCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" }, true);
      expect(provider.preparation.phase).toBe("ready"); expect(cache.snapshot().status).toBe("saved");
      expect(fs.existsSync(file)).toBe(true); expect(runtime.attemptCount).toBe(0);
      expect(diagnostics).toContainEqual({ stage: "save_write", result: "saved" });
      expect(JSON.stringify(diagnostics)).not.toMatch(/CANARY|192\.0\.2|account|checksum/);
    } finally { coordinator.clearLaunchCaptureTimer(); zone.dispose(); provider.dispose();
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + "hsc-startup-delivery-")) throw new Error("Unsafe test cleanup");
      fs.rmSync(directory, { recursive: true, force: true }); }
  });
  test("a short first SYN and sign-in are delivered immediately rather than waiting for more game traffic", () => {
    const receive = vi.fn(), bytes = Buffer.alloc(65_535);
    const handle = openPacketCapture("invented", "invented", bytes, receive, { nativeBufferBytes: 65_536, immediate: true });
    const cap = fake.caps.at(-1), firstSyn = Buffer.alloc(40);
    cap.emit(firstSyn);
    expect(receive).toHaveBeenCalledWith(firstSyn.length, false);
    expect(cap.setMinBytes).toHaveBeenCalledWith(0);
    handle.cap.close();
  });
  test("ordinary gameplay capture keeps its existing delivery configuration", () => {
    const handle = openPacketCapture("invented", "invented", Buffer.alloc(65_535), vi.fn());
    expect(fake.caps.at(-1).setMinBytes).not.toHaveBeenCalled(); handle.cap.close();
  });
});
