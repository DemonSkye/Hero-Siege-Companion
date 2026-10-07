import { EventEmitter } from "node:events";
import type net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { ElectronSatanicZoneTestRuntime } from "../../src/main/electron-satanic-zone-test-runtime";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InitializedSatanicZoneRefreshProvider } from "../../src/main/initialized-satanic-zone-provider";
import { runInitializedSatanicZoneProbe, type InitializedProbeInput } from "../../src/main/satanic-zone-initialized-transport";
import type { ParsedPayload } from "../../src/main/packet-decoder";
import type { HeroSiegeNetworkState } from "../../src/main/capture-network";
import type { SatanicZonePreparation } from "../../src/shared/satanic-zone-preparation";
import type { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
import { frameDiagnosticBody } from "../fixtures/satanic-zone-diagnostic-frames";
import { inventedProbeScope as scope, inventedConnect, inventedPostLogin, genericProbeFrame as generic,
  opcodeOnlyReadyBody, inventedLoginSuccess, inventedZoneBody } from "../fixtures/satanic-zone-initialized";
const launch = vi.hoisted(() => ({ steam: vi.fn(), executable: vi.fn() }));
vi.mock("electron", () => ({ shell: { openExternal: launch.steam, openPath: launch.executable } }));
import { GameCaptureCoordinator } from "../../src/main/game-capture-coordinator";
import { createInitialCompanionState } from "../../src/shared/initial-state";

async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
class Socket extends EventEmitter {
  localAddress = scope.localAddress; localPort = 6000;
  remoteAddress = scope.remoteAddress; remotePort = scope.remotePort;
  connect(_port: number, _address: string, connected: () => void) { connected(); return this; }
  writes: Buffer[] = [];
  write(frame: Buffer, done: () => void) { this.writes.push(Buffer.from(frame)); done(); return true; }
  destroy = vi.fn(() => this);
  receive(body: Buffer) { this.emit("data", generic(body)); }
}
function fixture(loginCache?: SatanicZoneLoginCache) {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  let receive!: (packet: ParsedPayload, truncated: boolean) => void;
  const snapshots: SatanicZonePreparation[] = [], sockets: Socket[] = [], inputs: InitializedProbeInput[] = [];
  const diagnostics: unknown[] = [];
  const close = vi.fn(); let canPrepare = true;
  const budgets: SatanicZoneDiagnosticBufferBudget[] = [];
  const network: HeroSiegeNetworkState = { gameProcessIds: [42], antiCheatProcessIds: [],
    connections: [{ ...scope, localPort: 4999, owningProcess: 42, state: "established" }] };
  const prepare = vi.fn(async () => scope), open = vi.fn(async (_scope, callback, _failed, budget) => { receive = callback; budgets.push(budget); return { close }; });
  const networkState = vi.fn(async () => network);
  const provider = new InitializedSatanicZoneRefreshProvider({ canPrepare: () => canPrepare, loginCache,
    onReadinessDiagnostic: diagnostic => diagnostics.push(diagnostic),
    onPreparation: state => snapshots.push(state), dependencies: { prepare, open, networkState,
      attempt: (input, signal, budget, progress) => {
        inputs.push(input); const socket = new Socket(); sockets.push(socket);
        return runInitializedSatanicZoneProbe(input, signal, budget, progress, () => socket as unknown as net.Socket);
      } } });
  function packet(outbound: boolean, seq: number, payload = Buffer.alloc(0), flags = 16): ParsedPayload {
    return { src: outbound ? scope.localAddress : scope.remoteAddress, dst: outbound ? scope.remoteAddress : scope.localAddress,
      srcPort: outbound ? 5000 : scope.remotePort, dstPort: outbound ? scope.remotePort : 5000,
      seq, ack: outbound ? 201 : 101, flags, payload, payloadLength: payload.length, text: "" };
  }
  async function collect(connectBody = inventedConnect(), postLoginBody = inventedPostLogin(), prepareNow = true, nextScope = scope, localPort = 5000,
    afterAcknowledgment?: () => void) {
    if (prepareNow) provider.prepare(); await flush();
    network.connections[0] = { ...network.connections[0], ...nextScope, localPort };
    const send = (outbound: boolean, seq: number, payload?: Buffer, flags?: number) => receive({ ...packet(outbound, seq, payload, flags),
      src: outbound ? nextScope.localAddress : nextScope.remoteAddress, dst: outbound ? nextScope.remoteAddress : nextScope.localAddress,
      srcPort: outbound ? localPort : nextScope.remotePort, dstPort: outbound ? nextScope.remotePort : localPort }, false);
    send(true, 100, undefined, 2); send(false, 200, undefined, 18);
    const connect = frameDiagnosticBody(connectBody, 7), ack = generic(opcodeOnlyReadyBody);
    send(true, 101, connect); send(false, 201, ack);
    afterAcknowledgment?.();
    send(true, 101 + connect.length, frameDiagnosticBody(postLoginBody, 8));
    send(false, 201 + ack.length, generic(inventedLoginSuccess()));
    await vi.advanceTimersByTimeAsync(1_000); await flush();
  }
  async function dispatch(signal?: AbortSignal) {
    const request = provider.requestRefresh({ signal }); await flush();
    sockets.at(-1)!.receive(opcodeOnlyReadyBody); sockets.at(-1)!.receive(inventedLoginSuccess());
    return request;
  }
  return { provider, collect, dispatch, sockets, inputs, snapshots, diagnostics, network, networkState, close, prepare, open, budgets, packet,
    receive: (value: ParsedPayload, truncated = false) => receive(value, truncated),
    denyPreparation: () => { canPrepare = false; } };
}
const cacheDirectories: string[] = [];
function cacheFixture(file: string) {
  let f: ReturnType<typeof fixture> | undefined;
  const cacheBuildIdentity = vi.fn(async () => "e".repeat(64));
  const cache = new SatanicZoneLoginCache({ store: new SatanicZoneLoginCacheStore(file, new ElectronSatanicZoneTestRuntime().cacheEncryption),
    networkState: async () => f!.network, buildIdentity: cacheBuildIdentity, onChange: () => f?.provider.cacheChanged() });
  f = fixture(cache); return { ...f, cache, cacheBuildIdentity };
}
function cacheFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-provider-cache-")); cacheDirectories.push(directory);
  return path.join(directory, "login.encrypted");
}
async function restoredCacheFixture() {
  const file = cacheFile(), original = cacheFixture(file); original.cache.configure(true);
  await original.collect(); await flush(); original.provider.dispose();
  const f = cacheFixture(file); f.cache.configure(true); await f.provider.preparePassively();
  f.network.connections[0].localPort = 5000;
  const payload = { ...scope, localPort: 5000, direction: "outbound" as const,
    text: "unique_account_id=12345678901234567890&beta=0&account_id=CANARY_ACCOUNT" };
  f.provider.observeSessionPayload(payload); await flush();
  expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
  return { ...f, file, payload };
}
afterEach(() => { vi.useRealTimers(); for (const directory of cacheDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe("normal Refresh using the proven initialized transport, all boundaries mocked", () => {
  test.each([["77777777777777777777", "0"], ["12345678901234567890", "1"]])(
    "native Ready and pending save survive gameplay-only reconfiguration; private identity %s/%s still invalidates", async (uid, beta) => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true);
    let build!: (value: string) => void;
    f.cacheBuildIdentity.mockImplementationOnce(() => new Promise(resolve => { build = resolve; }));
    await f.collect();
    f.provider.observeCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" }, true);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.close).not.toHaveBeenCalled();
    build("e".repeat(64)); await flush(); expect(f.cache.snapshot().status).toBe("saved");
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    const changed = frameDiagnosticBody(inventedPostLogin(uid, beta), 9);
    // Only private packets provide this contrary identity, through real framing.
    f.receive(f.packet(true, sequence + 12, changed.subarray(12)));
    f.receive(f.packet(true, sequence, changed.subarray(0, 12))); await flush();
    expect(f.provider.preparation.phase).not.toBe("ready"); expect(fs.existsSync(file)).toBe(false);
    expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.sockets).toHaveLength(0); f.provider.dispose();
  });
  test("contrary private identity cancels the native pair save before deferred build discovery completes", async () => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true);
    let build!: (value: string) => void;
    f.cacheBuildIdentity.mockImplementationOnce(() => new Promise(resolve => { build = resolve; })); await f.collect();
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    f.receive(f.packet(true, sequence, frameDiagnosticBody(inventedPostLogin("77777777777777777777"), 9)));
    build("e".repeat(64)); await flush(); expect(fs.existsSync(file)).toBe(false);
    expect(f.provider.preparation.phase).not.toBe("ready"); expect(f.sockets).toHaveLength(0); f.provider.dispose();
    expect(f.budgets[0].usedBytes).toBe(0);
  });
  test("missing private outbound identity bytes block dispatch until the complete unchanged frame is observed", async () => {
    const f = fixture(); await f.collect();
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    const identity = frameDiagnosticBody(inventedPostLogin(), 9);
    f.receive(f.packet(true, sequence + 17, identity.subarray(17)));
    expect(f.provider.preparation).toEqual({ phase: "collecting", expiresAt: null, reason: "traffic_incomplete" });
    expect(f.snapshots.at(-1)).toEqual(f.provider.preparation);
    expect(await f.provider.getAvailability()).toMatchObject({ available: false, errorCode: "helper_not_ready" });
    expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.sockets).toHaveLength(0);
    expect(f.snapshots.at(-1)?.phase).toBe("collecting");
    f.receive(f.packet(true, sequence, identity.subarray(0, 17)));
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(f.snapshots.at(-1)).toEqual(f.provider.preparation);
    expect(await f.provider.getAvailability()).toMatchObject({ available: true, errorCode: null });
    expect((await f.dispatch()).accepted).toBe(true); expect(f.sockets).toHaveLength(1); f.provider.dispose();
  });
  test("incomplete private traffic is reported ahead of an unrelated unavailable saved-sign-in build", async () => {
    const f = cacheFixture(cacheFile()); f.cache.configure(true); f.cacheBuildIdentity.mockResolvedValueOnce(null as unknown as string);
    await f.collect(); expect(f.cache.snapshot().status).toBe("build_unavailable");
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    const identity = frameDiagnosticBody(inventedPostLogin(), 9); f.receive(f.packet(true, sequence + 17, identity.subarray(17)));
    expect(f.snapshots.at(-1)).toEqual({ phase: "collecting", expiresAt: null, reason: "traffic_incomplete" });
    expect(await f.provider.getAvailability()).toMatchObject({ available: false });
    f.receive(f.packet(true, sequence, identity.subarray(0, 17)));
    expect(f.snapshots.at(-1)).toEqual({ phase: "ready", expiresAt: null }); f.provider.dispose();
  });
  test("an owned attempt ending while private continuity is incomplete cannot advertise Refresh availability", async () => {
    const f = fixture(); await f.collect(); const request = await f.dispatch();
    const waiting = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    const identity = frameDiagnosticBody(inventedPostLogin(), 9); f.receive(f.packet(true, sequence + 17, identity.subarray(17)));
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect(await waiting).toMatchObject({ kind: "terminal", refreshAvailable: false });
    expect(f.snapshots.at(-1)).toEqual({ phase: "collecting", expiresAt: null, reason: "traffic_incomplete" }); f.provider.dispose();
  });
  test("explicit Refresh retries a transient local build/save failure while the coherent native pair remains usable", async () => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true);
    f.cacheBuildIdentity.mockResolvedValueOnce(null as unknown as string); await f.collect();
    expect(f.cache.snapshot().status).toBe("build_unavailable"); expect(fs.existsSync(file)).toBe(false);
    const result = await f.dispatch(); await flush(); expect(result.accepted).toBe(true);
    expect(f.cache.snapshot().status).toBe("saved"); expect(fs.existsSync(file)).toBe(true);
    expect(f.cacheBuildIdentity).toHaveBeenCalledTimes(2); f.provider.dispose();
  });
  test("readiness diagnostics report safe stage/counts, throttle unchanged stages and never include identity or bodies", async () => {
    const f = fixture(); await f.provider.preparePassively(); await flush();
    const count = f.diagnostics.length;
    for (let i = 0; i < 10; i++) f.receive(f.packet(true, 101, inventedConnect()));
    expect(f.diagnostics).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.diagnostics.at(-1)).toMatchObject({ phase: "waiting-initialization", selectionStatus: "api-flow-no-syn",
      capturePackets: 10, freshSyn: false, attributed: false, initializationComplete: false });
    await f.collect(); expect(f.diagnostics.at(-1)).toMatchObject({ phase: "ready", attributed: true, initializationComplete: true });
    expect(JSON.stringify(f.diagnostics)).not.toMatch(/CANARY|1234567890|9876543210|192\.0\.2|198\.51\.100|checksum|account_uid/);
    expect(Object.keys(f.diagnostics.at(-1)!).sort()).toEqual(["phase", "reason", "selectionStatus", "probeStage", "capturePackets",
      "bytesObserved", "freshSyn", "attributed", "initializationComplete", "outboundFrames", "inboundFrames",
      "preparationReason", "cacheEnabled", "cacheStatus"].sort()); f.provider.dispose();
  });
  test("gameplay capture reconfiguration during sign-in preserves the independent listener, reaches Ready and saves without sending", async () => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true);
    await f.collect(inventedConnect(), inventedPostLogin(), true, scope, 5000, () => {
      f.provider.observeCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" }, true);
      f.provider.observeCaptureUpdate({ status: "waiting" }, true);
    }); await flush();
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.cache.snapshot().status).toBe("saved");
    expect(fs.existsSync(file)).toBe(true); expect(f.close).not.toHaveBeenCalled(); expect(f.sockets).toHaveLength(0);
    expect((await f.dispatch()).accepted).toBe(true); expect(f.sockets).toHaveLength(1); f.provider.dispose();
  });
  test.each([
    ["changed UID", "77777777777777777777", "0"], ["changed beta", "12345678901234567890", "1"],
    ["unchanged identity", "12345678901234567890", "0"],
  ])("Ready then unknown gap with %s via private listener only cannot send on the same PID/tuple", async (_label, uid, beta) => {
    const f = fixture(); await f.collect();
    const topology = JSON.stringify(f.network);
    f.provider.observeCaptureUpdate({ observationGap: true }, true);
    await f.provider.preparePassively(); await flush();
    // Ordinary identity frame, no SYN/coherent initialization; never offered to gameplay observer.
    f.receive(f.packet(true, 1000, frameDiagnosticBody(inventedPostLogin(uid, beta), 9)));
    expect(JSON.stringify(f.network)).toBe(topology);
    const request = f.provider.requestRefresh(); await flush();
    expect(f.sockets).toHaveLength(0); expect((await request).accepted).toBe(false);
    expect(f.provider.preparation.phase).not.toBe("ready");
    if (_label === "unchanged identity") {
      await f.collect(inventedConnect(), inventedPostLogin(), false);
      expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0);
      expect((await f.dispatch()).accepted).toBe(true); expect(f.sockets).toHaveLength(1);
    }
    f.provider.dispose();
  });
  test.each([
    ["changed UID", "77777777777777777777", "0"], ["changed beta", "12345678901234567890", "1"],
    ["unchanged identity", "12345678901234567890", "0"],
  ])("unknown gap with %s via private listener rejects the pending response and sends no retry", async (_label, uid, beta) => {
    const f = fixture(); await f.collect(); const request = await f.dispatch();
    const waiting = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    const topology = JSON.stringify(f.network), writes = f.sockets[0].writes.length;
    f.provider.observeCaptureUpdate({ observationGap: true }, true);
    await f.provider.preparePassively(); await flush();
    f.receive(f.packet(true, 1000, frameDiagnosticBody(inventedPostLogin(uid, beta), 9)));
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect((await waiting)?.kind).not.toBe("observation");
    expect(JSON.stringify(f.network)).toBe(topology);
    expect(f.sockets[0].destroy).toHaveBeenCalled(); expect(f.sockets[0].writes).toHaveLength(writes);
    expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.sockets).toHaveLength(1);
    f.provider.dispose();
  });
  test("an unknown gap cancels an async save of a prepared pair without resaving old identity", async () => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true); let release!: (build: string) => void;
    f.cacheBuildIdentity.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await f.collect(); expect(f.provider.preparation.phase).toBe("ready"); expect(fs.existsSync(file)).toBe(false);
    f.provider.observeCaptureUpdate({ observationGap: true }, true); await flush();
    expect(f.provider.preparation.phase).toBe("suspended"); expect(fs.existsSync(file)).toBe(false);
    release("e".repeat(64)); await flush(); expect(fs.existsSync(file)).toBe(false);
    expect(f.cacheBuildIdentity).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1); expect(f.sockets).toHaveLength(0); f.provider.dispose();
    expect(f.budgets[0].usedBytes).toBe(0);
  });
  test.each([{ observationGap: true as const }, { status: "error" as const }, { running: false }])(
    "an unclassified gap, error or actual Stop still suspends native Ready: %j", async update => {
      const f = fixture(); await f.collect(); f.provider.observeCaptureUpdate(update, true);
      expect(f.provider.preparation.phase).toBe("suspended"); expect(f.close).toHaveBeenCalledTimes(1);
      expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.sockets).toHaveLength(0); f.provider.dispose();
    });
  test("gameplay reconfiguration invalidates cached identity and requires new evidence without background authentication", async () => {
    const f = await restoredCacheFixture();
    f.provider.observeCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" }, true);
    expect(f.cache.restoreInput()).toBeNull(); expect(f.provider.preparation.phase).not.toBe("ready");
    expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.close).toHaveBeenCalledTimes(1);
    await f.provider.preparePassively(); expect(f.provider.preparation.phase).not.toBe("ready");
    f.provider.observeSessionPayload(f.payload); await flush();
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
    expect(f.sockets).toHaveLength(0); f.provider.dispose();
  });
  test("an independent API listener failure invalidates cached validation before passive retry", async () => {
    const f = await restoredCacheFixture(); f.open.mock.calls[0][2](); await flush();
    expect(f.cache.restoreInput()).toBeNull(); expect(f.provider.preparation.phase).not.toBe("ready");
    await vi.advanceTimersByTimeAsync(5_000); expect(f.open).toHaveBeenCalledTimes(2);
    expect(f.provider.preparation.phase).not.toBe("ready"); expect(f.sockets).toHaveLength(0);
    f.provider.observeSessionPayload(f.payload); await flush();
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" }); f.provider.dispose();
  });
  test("identical ordinary evidence during deferred cached preflight still permits the explicit send", async () => {
    const f = await restoredCacheFixture(); let release!: (build: string) => void;
    f.cacheBuildIdentity.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.provider.requestRefresh(); await flush();
    expect(release).toBeTypeOf("function"); expect(f.sockets).toHaveLength(0);
    const validation = f.cache.restoreInput()!.scope;
    f.provider.observeSessionPayload({ ...f.payload }); await flush();
    release("e".repeat(64)); await flush();
    expect(f.sockets).toHaveLength(1);
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess()); await flush();
    const request = await pending;
    expect(request.accepted).toBe(true); expect(f.sockets).toHaveLength(1);
    expect(f.cache.restoreInput()!.scope).toBe(validation);
    f.provider.dispose();
  });
  test("identical ordinary evidence during deferred cached postflight preserves a successful response", async () => {
    const f = await restoredCacheFixture(), request = await f.dispatch();
    const waiting = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    let release!: (build: string) => void;
    f.cacheBuildIdentity.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.sockets[0].receive(inventedZoneBody); await flush(); expect(release).toBeTypeOf("function");
    const validation = f.cache.restoreInput()!.scope;
    f.provider.observeSessionPayload({ ...f.payload }); await flush();
    release("e".repeat(64)); await flush();
    expect((await waiting)?.kind).toBe("observation"); expect(f.sockets).toHaveLength(1);
    expect(f.cache.restoreInput()!.scope).toBe(validation);
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" }); f.provider.dispose();
  });
  test.each(["preflight", "postflight"] as const)("wrong identity or an observation gap still rejects deferred cached %s", async stage => {
    for (const invalidation of ["identity", "gap"] as const) {
      const f = await restoredCacheFixture(); let release!: (build: string) => void;
      const request = stage === "postflight" ? await f.dispatch() : null;
      f.cacheBuildIdentity.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = request ? f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 }) : f.provider.requestRefresh();
      if (request) f.sockets[0].receive(inventedZoneBody);
      await flush(); expect(release).toBeTypeOf("function");
      if (invalidation === "identity") f.provider.observeSessionPayload({ ...f.payload, text: "unique_account_id=888888&beta=0" });
      else { f.provider.suspend(); await f.provider.preparePassively(); f.provider.observeSessionPayload({ ...f.payload }); }
      await flush(); release("e".repeat(64)); await flush();
      const result = await pending;
      if (request) expect(result).not.toMatchObject({ kind: "observation" });
      else expect(result).toMatchObject({ accepted: false });
      expect(f.sockets).toHaveLength(request ? 1 : 0); f.provider.dispose();
    }
  });
  test("collect once, close/reopen, validate cached identity/build and explicit Refresh alone sends", async () => {
    const file = cacheFile(), original = cacheFixture(file); original.cache.configure(true);
    await original.collect(); await flush(); expect(original.cache.snapshot().status).toBe("saved");
    expect(original.sockets).toHaveLength(0); original.provider.dispose();
    const f = cacheFixture(file); f.cache.configure(true); await f.provider.preparePassively(); await flush();
    expect(f.provider.preparation).toMatchObject({ phase: "waiting_connection", reason: "cache_identity_required" });
    expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.sockets).toHaveLength(0);
    f.network.connections[0].localPort = 5000;
    f.provider.observeSessionPayload({ ...scope, localPort: 5000, direction: "outbound",
      text: "unique_account_id=12345678901234567890&beta=0" }); await flush();
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null, origin: "cached" });
    expect(f.sockets).toHaveLength(0); const request = await f.dispatch();
    expect(request.accepted).toBe(true); expect(f.sockets).toHaveLength(1);
    expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    const wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation");
    f.provider.dispose(); expect(fs.existsSync(file)).toBe(true);
  });
  test("cached Ready loses validation on Stop and the same old numeric tuple cannot resume it", async () => {
    const file = cacheFile(), original = cacheFixture(file); original.cache.configure(true); await original.collect(); await flush(); original.provider.dispose();
    const f = cacheFixture(file); f.cache.configure(true); await f.provider.preparePassively(); f.network.connections[0].localPort = 5000;
    const payload = { ...scope, localPort: 5000, direction: "outbound" as const, text: "unique_account_id=12345678901234567890&beta=0" };
    f.provider.observeSessionPayload(payload); await flush(); expect(f.provider.preparation.origin).toBe("cached");
    f.provider.suspend(); await f.provider.preparePassively(); await flush();
    expect(f.provider.preparation.phase).not.toBe("ready"); expect((await f.provider.requestRefresh()).accepted).toBe(false);
    expect(f.sockets).toHaveLength(0); f.provider.observeSessionPayload(payload); await flush();
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
    f.cache.clear(); expect(f.provider.preparation.phase).not.toBe("ready"); expect(fs.existsSync(file)).toBe(false); f.provider.dispose();
  });
  test("wrong current account clears restored cache and cannot invoke the transport", async () => {
    const file = cacheFile(), original = cacheFixture(file); original.cache.configure(true); await original.collect(); await flush(); original.provider.dispose();
    const f = cacheFixture(file); f.cache.configure(true); await f.provider.preparePassively(); f.network.connections[0].localPort = 5000;
    f.provider.observeSessionPayload({ ...scope, localPort: 5000, direction: "outbound", text: "unique_account_id=888888&beta=0" }); await flush();
    expect(f.cache.snapshot().status).toBe("identity_mismatch"); expect((await f.provider.requestRefresh()).accepted).toBe(false);
    expect(f.sockets).toHaveLength(0); expect(fs.existsSync(file)).toBe(false); f.provider.dispose();
  });
  test.each([true, false])("HSC opens the listener before launch (Steam=%s) delivers the first SYN and login; only explicit Refresh sends", async steam => {
    const f = fixture(), order: string[] = [];
    f.network.gameProcessIds = []; f.network.connections = [];
    const originalOpen = f.open.getMockImplementation()!;
    f.open.mockImplementation(async (_scope, callback, _failed, budget) => {
      order.push("listener");
      // Preserve the fixture's invented packet receiver.
      return originalOpen(_scope, callback, _failed, budget);
    });
    const coordinator = new GameCaptureCoordinator({ state: createInitialCompanionState(),
      getCaptureService: () => ({ hasHeroSiegeProcess: async () => false, start: vi.fn(), stop: vi.fn(),
        diagnostics: async () => ({}), setCapturePreferences: vi.fn() }),
      beforeCapture: () => f.provider.preparePassively(),
      addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const launched = async () => {
      order.push("launch"); expect(f.open).toHaveBeenCalledTimes(1);
      f.network.gameProcessIds = [42];
      f.network.connections = [{ ...scope, localPort: 4999, owningProcess: 42, state: "established" }];
      await f.collect(inventedConnect(), inventedPostLogin(), false);
      return "";
    };
    launch.steam.mockImplementation(launched); launch.executable.mockImplementation(launched);
    await coordinator.launchOrCapture({ launchThroughSteam: steam, executablePath: "invented.exe" });
    expect(order).toEqual(["listener", "launch"]);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0);
    expect((await f.dispatch()).accepted).toBe(true); expect(f.sockets).toHaveLength(1);
    f.provider.dispose(); coordinator.clearLaunchCaptureTimer();
  });
  test("launch waits for a delayed listener open; cancelling it cannot accept late login or send", async () => {
    const f = fixture(); let opened!: (handle: { close: () => void }) => void;
    f.open.mockImplementationOnce(() => new Promise(resolve => { opened = resolve; }));
    let listening = false;
    const watch = f.provider.preparePassively().then(value => { listening = value; });
    await flush(); expect(listening).toBe(false); expect(f.provider.preparation.phase).toBe("opening");
    f.provider.stop(); opened({ close: f.close }); await watch;
    expect(listening).toBe(false); expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.provider.preparation.phase).toBe("idle"); expect(f.sockets).toHaveLength(0);
  });
  test("Companion before game keeps watching past two minutes, then becomes Ready automatically without authentication", async () => {
    const f = fixture(); f.network.connections = []; f.network.gameProcessIds = [];
    await f.provider.preparePassively(); await vi.advanceTimersByTimeAsync(125_000);
    expect(f.provider.preparation).toEqual({ phase: "waiting_connection", expiresAt: null });
    f.network.gameProcessIds = [42]; f.network.connections = [{ ...scope, localPort: 4999, owningProcess: 42, state: "established" }];
    await f.collect(inventedConnect(), inventedPostLogin(), false);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0);
    expect(f.open).toHaveBeenCalledTimes(1); f.provider.dispose();
  });
  test("Companion after login reports the missed sign-in and partial traffic cannot invent readiness", async () => {
    const f = fixture(); await f.provider.preparePassively(); await flush();
    expect(f.provider.preparation.reason).toBe("login_missed");
    f.receive(f.packet(true, 101, frameDiagnosticBody(inventedConnect(), 7)));
    f.receive(f.packet(false, 201, generic(inventedLoginSuccess())));
    await vi.advanceTimersByTimeAsync(125_000);
    expect(f.provider.preparation.phase).toBe("waiting_connection");
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "helper_not_ready" });
    expect(f.sockets).toHaveLength(0); f.provider.dispose();
  });
  test.each(["fresh-syn", "fin", "reset"])("%s reconnect automatically reuses the open listener, clears old bodies and needs a complete new login", async change => {
    const f = fixture(); await f.provider.preparePassively(); await f.collect();
    const request = await f.dispatch(), wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); await wait; await flush();
    if (change !== "fresh-syn") f.receive(f.packet(true, 1000, undefined, change === "fin" ? 1 : 4));
    const uid = "77777777777777777777", connect = Buffer.from(inventedConnect().toString().replace("12345678901234567890", uid));
    await f.collect(connect, inventedPostLogin(uid), false);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
    expect(f.inputs[0].postLoginBody.every(byte => byte === 0)).toBe(true);
    expect(f.sockets).toHaveLength(1); expect(f.budgets[0].peakBytes).toBeLessThanOrEqual(1024 * 1024);
    f.provider.dispose(); expect(f.budgets[0].usedBytes).toBe(0);
  });
  test("listener failure retries passive acquisition only; disabling cancels retries", async () => {
    const f = fixture(); f.prepare.mockRejectedValueOnce(new Error("CANARY_PRIVATE_FAILURE"));
    await f.provider.preparePassively(); expect(f.provider.preparation.phase).toBe("unavailable");
    expect(f.provider.suppressRawLogging).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000); expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.provider.preparation.phase).toBe("waiting_connection"); expect(f.sockets).toHaveLength(0);
    expect(JSON.stringify(f.snapshots)).not.toContain("CANARY_PRIVATE");
    f.provider.stop(); await vi.advanceTimersByTimeAsync(30_000);
    expect(f.open).toHaveBeenCalledTimes(1); expect(f.provider.suppressRawLogging).toBe(false);
  });
  test("ordinary server and local-port changes on the same adapter reacquire from the first SYN without reopening", async () => {
    const f = fixture(); await f.provider.preparePassively(); await f.collect();
    const changed = { ...scope, remoteAddress: "203.0.113.30", remotePort: 6668 };
    await f.collect(inventedConnect(), inventedPostLogin(), false, changed, 5001);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.sockets).toHaveLength(0); f.provider.dispose();
  });
  test("a SYN belonging to the explicit app request cannot replace the native game context", async () => {
    const f = fixture(); await f.collect(); const request = f.provider.requestRefresh(); await flush();
    f.receive({ ...f.packet(true, 100, undefined, 2), srcPort: 6000 });
    expect(f.provider.preparation.phase).toBe("requesting");
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
    const result = await request, wait = f.provider.waitForObservation(result.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation");
    expect(f.inputs[0].connectBody).toEqual(inventedConnect()); f.provider.dispose();
  });
  test("delayed capture of the failed app socket SYN cannot erase Ready before another explicit Refresh", async () => {
    const f = fixture(); await f.collect(); const failed = f.provider.requestRefresh(); await flush();
    f.sockets[0].emit("error", new Error("invented connection failure")); await failed; await flush();
    expect(f.provider.preparation.phase).toBe("ready");
    f.receive({ ...f.packet(true, 100, undefined, 2), srcPort: 6000 });
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    const request = await f.dispatch(), wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    f.sockets[1].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation"); f.provider.dispose();
  });
  test("an app socket failing before connect has no registered tuple; its delayed SYN cannot erase Ready", async () => {
    const f = fixture(); await f.collect();
    vi.spyOn(Socket.prototype, "connect").mockImplementationOnce(function () {
      this.emit("error", new Error("invented pre-connect failure")); return this;
    });
    expect((await f.provider.requestRefresh()).accepted).toBe(false); await flush();
    const preserved = f.inputs[0].connectBody;
    f.receive({ ...f.packet(true, 100, undefined, 2), srcPort: 6000 }); await flush();
    expect(f.provider.preparation.phase).toBe("ready"); expect(preserved).toEqual(inventedConnect());
    expect(f.sockets).toHaveLength(1); expect(f.sockets[0].writes).toHaveLength(0);
    expect((await f.dispatch()).accepted).toBe(true); f.provider.dispose();
  });
  test("ownership lookup can finish after queued new login frames without losing the game reconnect", async () => {
    const f = fixture(); await f.collect(); let release!: (network: HeroSiegeNetworkState) => void;
    f.networkState.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const collection = f.collect(inventedConnect(), inventedPostLogin(), false, scope, 5001);
    await flush(); expect(f.provider.preparation.phase).toBe("ready");
    release(f.network); await collection; await flush();
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.sockets).toHaveLength(0); f.provider.dispose();
  });
  test("an adapter change closes the old listener and reselects passively; completed login is never reconstructed", async () => {
    const f = fixture(); await f.provider.preparePassively(); await f.collect();
    const changed = { ...scope, localAddress: "192.0.2.11" };
    f.network.connections[0] = { ...f.network.connections[0], ...changed }; f.provider.observeConnections(f.network.connections);
    await flush(); expect(f.close).toHaveBeenCalledTimes(1);
    f.prepare.mockResolvedValue(changed); await vi.advanceTimersByTimeAsync(5_000);
    expect(f.open).toHaveBeenCalledTimes(2); expect(f.provider.preparation.reason).toBe("login_missed");
    expect(f.provider.preparation.phase).toBe("waiting_connection"); expect(f.sockets).toHaveLength(0);
    await f.collect(inventedConnect(), inventedPostLogin(), false, changed);
    expect(f.provider.preparation.phase).toBe("ready"); f.provider.dispose();
  });
  test("a failed or timed-out native candidate is bounded and automatically watches the next sign-in without authentication", async () => {
    const f = fixture(); await f.provider.preparePassively();
    f.receive(f.packet(true, 100, undefined, 2)); await vi.advanceTimersByTimeAsync(120_000);
    expect(f.provider.preparation.phase).toBe("expired");
    await vi.advanceTimersByTimeAsync(5_000); expect(f.open).toHaveBeenCalledTimes(2);
    await f.collect(inventedConnect(), inventedPostLogin(), false);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0); f.provider.dispose();
  });
  test("readiness uses allowlisted fields, keeps the listener open at Ready and sends nothing", async () => {
    const f = fixture(); expect(f.prepare).not.toHaveBeenCalled(); await f.collect();
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(f.close).not.toHaveBeenCalled(); expect(f.sockets).toHaveLength(0);
    expect(f.provider.suppressRawLogging).toBe(true);
    expect(f.snapshots.every(snapshot => Object.keys(snapshot).every(key => ["expiresAt", "phase", "reason"].includes(key)))).toBe(true);
    expect(JSON.stringify(f.snapshots)).not.toMatch(/CANARY|1234567890|9876543210|checksum|192\.0\.2/);
    f.provider.dispose(); expect(f.provider.suppressRawLogging).toBe(false);
  });
  test("only an owned zone is returned; explicit clicks reuse RAM context hours later without timers or replay", async () => {
    const f = fixture(); await f.collect(); const first = await f.dispatch();
    expect(first.accepted).toBe(true);
    expect(f.sockets[0].writes).toHaveLength(4);
    const wait = f.provider.waitForObservation(first.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody);
    expect(await wait).toMatchObject({ kind: "observation", observation: { zone: { rawZone: "Act_04_03" } }, availabilityConsumed: false });
    await flush(); expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    expect(f.sockets[0].destroy).toHaveBeenCalledTimes(1);
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "refresh_cooldown" });
    await vi.advanceTimersByTimeAsync(8 * 60 * 60_000);
    expect(f.networkState).toHaveBeenCalledTimes(4); // collection + explicit pre/postflight, no Ready polling
    expect(f.sockets).toHaveLength(1);
    const second = await f.dispatch();
    expect(f.inputs[1].connectBody).toBe(f.inputs[0].connectBody);
    expect(f.sockets[1].writes[0]).toEqual(f.sockets[0].writes[0]);
    const waitAgain = f.provider.waitForObservation(second.correlationId!, { timeoutMs: 30_000 });
    f.sockets[1].receive(inventedZoneBody); expect((await waitAgain)?.kind).toBe("observation"); await flush();
    expect(f.provider.preparation.expiresAt).toBeNull();
    await vi.advanceTimersByTimeAsync(89_000);
    expect(f.provider.preparation.phase).toBe("ready");
    expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    expect(f.provider.suppressRawLogging).toBe(true); expect(f.sockets).toHaveLength(2);
    f.provider.dispose();
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
    expect(f.inputs[0].postLoginBody.every(byte => byte === 0)).toBe(true);
    expect(f.inputs[0].identity.uniqueAccountId).toBe("");
    expect(f.provider.suppressRawLogging).toBe(false); expect(f.sockets).toHaveLength(2);
  });
  test.each(["pid", "port", "server", "adapter", "closed-flow"])("%s change invalidates retained readiness without replay", async change => {
    const f = fixture(); await f.collect();
    if (change === "pid") f.network.gameProcessIds = [];
    if (change === "port") f.network.connections[0].localPort++;
    if (change === "server") f.network.connections[0].remoteAddress = "203.0.113.1";
    if (change === "adapter") f.network.connections[0].localAddress = "192.0.2.11";
    if (change === "closed-flow") f.network.connections[0].state = "closewait";
    if (change === "pid") f.provider.observeProcessIds(f.network.gameProcessIds);
    else f.provider.observeConnections(f.network.connections);
    expect(f.provider.preparation.phase).toBe("waiting_connection"); expect(f.sockets).toHaveLength(0);
    expect(f.provider.suppressRawLogging).toBe(true);
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "helper_not_ready" });
  });
  test.each([[1, true], [4, false], [2, true]] as const)("observed FIN/reset/new SYN flags %s outbound=%s erase context before topology catches up", async (flags, outbound) => {
    const f = fixture(); await f.collect(); const request = await f.dispatch();
    const wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    const native = { src: outbound ? scope.localAddress : scope.remoteAddress, dst: outbound ? scope.remoteAddress : scope.localAddress,
      srcPort: outbound ? 5000 : scope.remotePort, dstPort: outbound ? scope.remotePort : 5000, flags };
    f.provider.observeTcpLifecycle({ ...native, srcPort: 6000 }); expect(f.provider.preparation.phase).toBe("requesting");
    f.provider.observeTcpLifecycle({ ...native, flags: 18 }); expect(f.provider.preparation.phase).toBe("requesting");
    f.provider.observeTcpLifecycle(native); expect((await wait)?.kind).toBe("terminal");
    expect(f.provider.preparation.phase).toBe("waiting_connection"); expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
    expect(f.sockets[0].destroy).toHaveBeenCalledTimes(1); f.provider.dispose();
  });
  test("scope is revalidated before login writes and invalidation during initialization cancels the socket", async () => {
    const f = fixture(); await f.collect(); f.network.connections[0].localPort++;
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "helper_failed" });
    expect(f.sockets).toHaveLength(0);
    const g = fixture(); await g.collect(); const pending = g.provider.requestRefresh(); await flush();
    expect(g.sockets[0].writes).toHaveLength(2); g.network.gameProcessIds = [];
    g.provider.observeProcessIds(g.network.gameProcessIds); await flush();
    expect(await pending).toMatchObject({ accepted: false, errorCode: "helper_failed" });
    expect(g.sockets[0].destroy).toHaveBeenCalledTimes(1);
    expect(g.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
  });
  test("a valid owned response cannot settle after the game flow changes before its topology event", async () => {
    const f = fixture(); await f.collect(); const dispatched = await f.dispatch();
    const wait = f.provider.waitForObservation(dispatched.correlationId!, { timeoutMs: 30_000 });
    f.network.connections[0].localPort = 5001;
    f.sockets[0].receive(inventedZoneBody);
    expect(await wait).toMatchObject({ kind: "terminal", errorCode: "helper_failed" });
    expect(f.provider.preparation.phase).toBe("unavailable");
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
  });
  test("inconclusive postflight topology rejects the owned result but preserves RAM context for a later explicit request", async () => {
    const f = fixture(); await f.collect(); const request = await f.dispatch();
    const wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    f.network.connections = []; f.sockets[0].receive(inventedZoneBody);
    expect(await wait).toMatchObject({ kind: "terminal", refreshAvailable: true });
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(f.inputs[0].connectBody).toEqual(inventedConnect()); f.provider.dispose();
  });
  test.each(["stop", "dispose", "account", "beta", "process"])("%s clears RAM and prevents late results", async action => {
    const f = fixture(); await f.collect(); const dispatched = await f.dispatch();
    const abort = new AbortController();
    const wait = f.provider.waitForObservation(dispatched.correlationId!, { timeoutMs: 30_000, signal: abort.signal });
    if (action === "stop") f.provider.stop();
    if (action === "dispose") f.provider.dispose();
    if (action === "process") f.provider.observeProcessIds([]);
    if (action === "account" || action === "beta") f.provider.observeSessionPayload({ direction: "outbound", ...scope,
      text: action === "account" ? "unique_account_id=555" : "unique_account_id=12345678901234567890&beta=1" });
    expect((await wait)?.kind).toBe("terminal");
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect(f.provider.preparation.phase).not.toBe("ready");
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
    expect(f.provider.suppressRawLogging).toBe(!["stop", "dispose"].includes(action));
  });
  test("one flight, deadline and no automatic retry after missing owned response", async () => {
    const f = fixture(); await f.collect(); const dispatched = await f.dispatch();
    const wait = f.provider.waitForObservation(dispatched.correlationId!, { timeoutMs: 30_000 });
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "refresh_in_progress" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await wait).toMatchObject({ kind: "terminal", errorCode: "response_timeout", refreshAvailable: true });
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    await vi.advanceTimersByTimeAsync(90_000); expect(f.sockets).toHaveLength(1);
    const next = await f.dispatch();
    const nextWait = f.provider.waitForObservation(next.correlationId!, { timeoutMs: 30_000 });
    f.sockets[1].receive(inventedZoneBody); expect((await nextWait)?.kind).toBe("observation"); f.provider.dispose();
  });
  test("extra API flows do not erase or block an exact established game flow", async () => {
    const f = fixture(); await f.collect();
    f.network.connections.push({ ...f.network.connections[0], localPort: 5001 });
    f.provider.observeConnections(f.network.connections);
    expect(f.provider.preparation.phase).toBe("ready");
    const request = await f.dispatch(); const wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation"); f.provider.dispose();
  });
  test.each(["empty-topology", "query-error"])("%s retains context but fails the explicit attempt before any authentication writes", async failure => {
    const f = fixture(); await f.collect(); const original = { ...f.network.connections[0] };
    if (failure === "empty-topology") { f.network.connections = []; f.provider.observeConnections([]); }
    else f.networkState.mockRejectedValueOnce(new Error("invented transient"));
    expect(f.provider.preparation.phase).toBe("ready");
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "helper_failed" });
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null }); expect(f.sockets).toHaveLength(0);
    f.network.connections = [original];
    const request = await f.dispatch(); const wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation"); f.provider.dispose();
  });
  test.each(["abort", "socket-error"])("%s cancels one owned attempt without destroying valid context or accepting late results", async failure => {
    const f = fixture(); await f.collect(); const request = await f.dispatch(); const abort = new AbortController();
    const wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000, signal: abort.signal });
    if (failure === "abort") abort.abort();
    if (failure === "socket-error") f.sockets[0].emit("error", new Error("invented transient"));
    expect(await wait).toMatchObject({ kind: "terminal", refreshAvailable: true });
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(f.inputs[0].connectBody).toEqual(inventedConnect()); expect(f.sockets[0].destroy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000); expect(f.sockets).toHaveLength(1); f.provider.dispose();
  });
  test.each(["missed-account-change", "reused-pid-tuple", "unchanged-verified-native-prefix"])("%s across a blind interval cannot authorize replay from PID/tuple or partial identity evidence", async scenario => {
    const f = fixture(); await f.collect(); const first = await f.dispatch();
    const wait = f.provider.waitForObservation(first.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation"); await flush();
    f.provider.suspend();
    expect(f.provider.preparation).toEqual({ phase: "suspended", expiresAt: null });
    f.provider.observeProcessIds([42]); f.provider.observeConnections(f.network.connections);
    f.provider.observeSessionPayload({ direction: "outbound", ...scope, text: "unique_account_id=12345678901234567890&beta=0" });
    await vi.advanceTimersByTimeAsync(8 * 60 * 60_000);
    expect(await f.provider.getAvailability()).toMatchObject({ available: false });
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "helper_not_ready" });
    expect(f.sockets).toHaveLength(1); expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    expect(f.provider.suppressRawLogging).toBe(true);
    f.provider.preparePassively(); await flush();
    expect(f.provider.preparation.phase).toBe("waiting_connection"); expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    const uid = scenario === "missed-account-change" ? "77777777777777777777" : "12345678901234567890";
    const connect = Buffer.from(inventedConnect().toString("utf8").replace("12345678901234567890", uid));
    await f.collect(connect, inventedPostLogin(uid));
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
    expect(f.budgets[1]).toBe(f.budgets[0]); expect(f.budgets[0].usedBytes).toBe(connect.length + inventedPostLogin(uid).length);
    expect(f.sockets).toHaveLength(1); // Fresh evidence acquisition never authenticated.
    const next = await f.dispatch(); expect(f.inputs[1].identity.uniqueAccountId).toBe(uid);
    const nextWait = f.provider.waitForObservation(next.correlationId!, { timeoutMs: 30_000 });
    f.sockets[1].receive(inventedZoneBody); expect((await nextWait)?.kind).toBe("observation"); f.provider.dispose();
  });
  test.each(["cancel", "second-gap"])("%s during passive reacquisition returns suspended RAM context without replay or a renewed Ready lifetime", async action => {
    const f = fixture(); await f.collect(); const first = await f.dispatch();
    const wait = f.provider.waitForObservation(first.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); await wait; await flush(); f.provider.suspend();
    f.provider.preparePassively(); await flush(); expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    if (action === "cancel") f.provider.cancelPreparation();
    if (action === "second-gap") f.provider.suspend();
    expect(f.provider.preparation).toEqual({ phase: "suspended", expiresAt: null });
    expect(f.inputs[0].connectBody).toEqual(inventedConnect()); expect(f.provider.suppressRawLogging).toBe(true);
    expect(f.budgets[0].usedBytes).toBe(inventedConnect().length + inventedPostLogin().length);
    await vi.advanceTimersByTimeAsync(120_000); expect(f.open).toHaveBeenCalledTimes(2); expect(f.sockets).toHaveLength(1);
    f.provider.stop(); expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true); expect(f.budgets[0].usedBytes).toBe(0);
  });
  test.each(["preflight", "initializing", "awaiting-response", "postflight"])("observation interruption during %s cancels ownership and never resumes after old evidence arrives", async stage => {
    const f = fixture(); await f.collect(); let resolve!: (network: HeroSiegeNetworkState) => void;
    if (stage === "preflight") f.networkState.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = f.provider.requestRefresh(); await flush();
    let wait: ReturnType<typeof f.provider.waitForObservation> | undefined;
    if (["awaiting-response", "postflight"].includes(stage)) {
      f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
      const dispatch = await request; wait = f.provider.waitForObservation(dispatch.correlationId!, { timeoutMs: 30_000 });
      if (stage === "postflight") {
        f.networkState.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        f.sockets[0].receive(inventedZoneBody); await flush();
      }
    }
    f.provider.suspend(); await flush();
    if (wait) expect(await wait).toMatchObject({ kind: "terminal", refreshAvailable: false });
    else expect(await request).toMatchObject({ accepted: false });
    if (resolve) resolve(f.network);
    f.sockets[0]?.receive(opcodeOnlyReadyBody); f.sockets[0]?.receive(inventedLoginSuccess()); f.sockets[0]?.receive(inventedZoneBody); await flush();
    expect(f.provider.preparation).toEqual({ phase: "suspended", expiresAt: null });
    if (stage === "preflight") expect(f.sockets).toHaveLength(0);
    if (stage === "initializing") expect(f.sockets[0].writes).toHaveLength(2);
    if (f.inputs[0]) expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    f.provider.dispose();
  });
  test("an incoherent fresh prefix frees only candidate buffers; disable clears retained and candidate RAM", async () => {
    const f = fixture(); await f.collect(); const first = await f.dispatch();
    const wait = f.provider.waitForObservation(first.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); await wait; await flush(); f.provider.suspend();
    await f.collect(inventedConnect(), inventedPostLogin("77777777777777777777"));
    expect(f.provider.preparation.phase).toBe("suspended"); expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    expect(f.budgets[0].usedBytes).toBe(inventedConnect().length + inventedPostLogin().length);
    f.provider.preparePassively(); await flush(); expect(f.provider.preparation.phase).toBe("waiting_connection");
    f.provider.stop(); expect(f.provider.preparation.phase).toBe("idle");
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true); expect(f.budgets[0].usedBytes).toBe(0);
    expect(f.provider.suppressRawLogging).toBe(false);
  });
  test("a timed-out preflight cannot resume authentication after its query resolves, or affect the next attempt", async () => {
    const f = fixture(); await f.collect(); let resolve!: (network: HeroSiegeNetworkState) => void;
    f.networkState.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = f.provider.requestRefresh(); await flush(); await vi.advanceTimersByTimeAsync(30_000);
    expect(await first).toMatchObject({ accepted: false, errorCode: "response_timeout" });
    const next = f.provider.requestRefresh(); await flush(); expect(f.sockets).toHaveLength(1);
    resolve(f.network); await flush(); expect(f.sockets).toHaveLength(1); expect(f.provider.preparation.phase).toBe("requesting");
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
    const request = await next; const wait = f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation"); f.provider.dispose();
  });
  test("passive watching has no two-minute window and never sends authentication", async () => {
    const f = fixture(); f.provider.preparePassively(); await flush(); f.provider.preparePassively();
    expect(f.open).toHaveBeenCalledTimes(1); expect(f.sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(120_000); expect(f.provider.preparation).toMatchObject({ phase: "waiting_connection", expiresAt: null, reason: "login_missed" });
    await vi.advanceTimersByTimeAsync(60_000); expect(f.open).toHaveBeenCalledTimes(1); expect(f.sockets).toHaveLength(0);
    f.provider.dispose();
  });
  test("Stop between accepted dispatch and observation registration does not strand a pending request", async () => {
    const f = fixture(); await f.collect(); expect((await f.dispatch()).accepted).toBe(true);
    // Main can disable/Stop before its controller registers the observation wait.
    f.provider.stop(); await flush();
    await vi.advanceTimersByTimeAsync(30_000); await f.collect();
    expect(f.provider.preparation.phase).toBe("ready");
    const second = await f.dispatch(); expect(second.accepted).toBe(true);
    const wait = f.provider.waitForObservation(second.correlationId!, { timeoutMs: 30_000 });
    f.sockets[1].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation");
    f.provider.dispose();
  });
  test("disabled/busy preparation cannot open a capture and default E2E mode stays native/socket free", async () => {
    const f = fixture(); f.denyPreparation(); f.provider.prepare(); await flush();
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.provider.preparation.phase).toBe("unavailable");
    const nativeFree = new InitializedSatanicZoneRefreshProvider({ syntheticOnly: true, canPrepare: () => true, onPreparation: vi.fn() });
    nativeFree.prepare(); await flush(); expect(nativeFree.preparation.phase).toBe("unavailable");
    expect(await nativeFree.requestRefresh()).toMatchObject({ accepted: false }); nativeFree.dispose();
  });
});
