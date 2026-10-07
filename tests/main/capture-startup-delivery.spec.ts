import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const fake = vi.hoisted(() => ({ caps: [] as any[], exec: vi.fn(), launch: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: fake.exec, default: { execFile: fake.exec } }));
vi.mock("electron", () => ({ shell: { openExternal: fake.launch } }));
vi.mock("node:module", () => { const createRequire = () => () => ({ Cap: class {
  minimum = 16_000; buffered: Buffer[] = []; bytes!: Buffer; receive!: (n: number, truncated: boolean) => void;
  close = vi.fn();
  constructor() { fake.caps.push(this); }
  static findDevice() { return "invented-device"; }
  open(_device: string, _filter: string, _capacity: number, bytes: Buffer) { this.bytes = bytes; return "RAW"; }
  on(_event: string, receive: typeof this.receive) { this.receive = receive; }
  setMinBytes = vi.fn((minimum: number) => { this.minimum = minimum; });
  emit(bytes: Buffer) { this.buffered.push(bytes); if (this.buffered.reduce((sum, b) => sum + b.length, 0) < this.minimum) return;
    for (const bytes of this.buffered.splice(0)) { bytes.copy(this.bytes); this.receive(bytes.length, false); } }
} }); return { createRequire, default: { createRequire } }; });
import { openPacketCapture } from "../../src/main/capture-adapter";
import { createDiagnosticCaptureDependencies } from "../../src/main/satanic-zone-diagnostic-runtime";
import { getHeroSiegeBuildIdentity } from "../../src/main/capture-network";
import { GameCaptureCoordinator } from "../../src/main/game-capture-coordinator";
import { InitializedSatanicZoneRefreshProvider } from "../../src/main/initialized-satanic-zone-provider";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { SatanicZoneController } from "../../src/main/satanic-zone-controller";
import { ElectronSatanicZoneTestRuntime } from "../../src/main/electron-satanic-zone-test-runtime";
import { createInitialCompanionState } from "../../src/shared/initial-state";
import { replayInitialization, replayPacket, replayScope } from "../fixtures/network-replay";
afterEach(() => { vi.useRealTimers(); fake.exec.mockReset(); fake.launch.mockReset(); fake.caps.splice(0); });

describe("startup capture delivery, with an invented buffering Windows adapter", () => {
  test("actual launch/runtime/parser/provider/cache wiring reaches native Ready, retains it through gameplay open and persists via fallback", async () => {
    vi.useFakeTimers();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-startup-delivery-")), file = path.join(directory, "login.encrypted");
    const runtime = new ElectronSatanicZoneTestRuntime();
    let game = false, zone: SatanicZoneController, provider: InitializedSatanicZoneRefreshProvider;
    const network = () => ({ gameProcessIds: game ? [42] : [], antiCheatProcessIds: [], connections: game
      ? [{ ...replayScope, localPort: 5000, owningProcess: 42, state: "established" }] : [] });
    fake.exec.mockImplementation((_exe, args, _options, done) => {
      const script = args.at(-1);
      if (script.includes("Get-FileHash")) { expect(script).toContain("Get-CimInstance");
        done(null, JSON.stringify({ stage: "ready", hash: "e".repeat(64) }), ""); }
      else if (script.includes("Get-NetRoute")) done(null, JSON.stringify({ address: replayScope.localAddress, metric: 1 }), "");
      else done(null, JSON.stringify({ ...network(), connections: network().connections.map(flow => ({
        OwningProcess: flow.owningProcess, LocalAddress: flow.localAddress, LocalPort: flow.localPort,
        RemoteAddress: flow.remoteAddress, RemotePort: flow.remotePort, State: flow.state })) }), "");
    });
    const diagnostics: unknown[] = [];
    const cache = new SatanicZoneLoginCache({ store: new SatanicZoneLoginCacheStore(file, runtime.cacheEncryption),
      networkState: async () => network(), buildIdentity: getHeroSiegeBuildIdentity,
      onChange: () => provider?.cacheChanged(), onDiagnostic: (stage, result) => diagnostics.push({ stage, result }) });
    provider = new InitializedSatanicZoneRefreshProvider({ loginCache: cache, canPrepare: () => true,
      onPreparation: preparation => zone?.setPreparation(preparation), dependencies: {
        ...createDiagnosticCaptureDependencies(false, "startup-api"), attempt: runtime.dependencies.attempt } });
    zone = new SatanicZoneController({ provider, onStateChange: () => {} }); cache.configure(true);
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
