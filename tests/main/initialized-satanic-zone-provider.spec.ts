import { EventEmitter } from "node:events";
import type net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InitializedSatanicZoneRefreshProvider } from "../../src/main/initialized-satanic-zone-provider";
import { runInitializedSatanicZoneProbe, type InitializedProbeInput, type InitializedProbeProgress } from "../../src/main/satanic-zone-initialized-transport";
import { SatanicZoneController } from "../../src/main/satanic-zone-controller";
import type { SatanicZoneState } from "../../src/shared/satanic-zone";
import { satanicZoneDisplay, satanicZoneRefreshControl } from "../../src/renderer/src/lib/satanic-zone-display";
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
function fixture(loginCache?: SatanicZoneLoginCache, onPreparation?: (state: SatanicZonePreparation) => void) {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  let receive!: (packet: ParsedPayload, truncated: boolean) => void;
  const snapshots: SatanicZonePreparation[] = [], sockets: Socket[] = [], inputs: InitializedProbeInput[] = [];
  const diagnostics: unknown[] = [], transportProgress: InitializedProbeProgress[] = [];
  const close = vi.fn(); let canPrepare = true;
  const budgets: SatanicZoneDiagnosticBufferBudget[] = [];
  const network: HeroSiegeNetworkState = { gameProcessIds: [42], antiCheatProcessIds: [],
    connections: [{ ...scope, localPort: 4999, owningProcess: 42, state: "established" }] };
  const prepare = vi.fn(async () => scope), open = vi.fn(async (_scope, callback, _failed, budget) => { receive = callback; budgets.push(budget); return { close }; });
  const networkState = vi.fn(async () => network);
  const provider = new InitializedSatanicZoneRefreshProvider({ canPrepare: () => canPrepare, loginCache,
    onReadinessDiagnostic: diagnostic => diagnostics.push(diagnostic),
    onPreparation: state => { snapshots.push(state); onPreparation?.(state); }, dependencies: { prepare, open, networkState,
      attempt: (input, signal, budget, progress) => {
        inputs.push(input); const socket = new Socket(); sockets.push(socket);
        return runInitializedSatanicZoneProbe(input, signal, budget, value => { transportProgress.push(value); progress?.(value); }, () => socket as unknown as net.Socket);
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
  return { provider, collect, dispatch, sockets, inputs, snapshots, diagnostics, transportProgress, network, networkState, close, prepare, open, budgets, packet,
    receive: (value: ParsedPayload, truncated = false) => receive(value, truncated),
    denyPreparation: () => { canPrepare = false; } };
}
const cacheDirectories: string[] = [];
const cachePassphrase = "SYNTHETIC provider cache passphrase";
function cacheFixture(file: string) {
  let f: ReturnType<typeof fixture> | undefined;
  const cacheNetworkState = vi.fn(async () => f!.network);
  const cache = new SatanicZoneLoginCache({ store: new SatanicZoneLoginCacheStore(file),
    networkState: cacheNetworkState, onChange: () => f?.provider.cacheChanged() });
  f = fixture(cache); return { ...f, cache, cacheNetworkState };
}
function cacheFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-provider-cache-")); cacheDirectories.push(directory);
  return path.join(directory, "login.encrypted");
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const directory of cacheDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe("normal Refresh using the proven initialized transport, all boundaries mocked", () => {
  test("generic owned receipt is reported separately while a specific passive zone stays displayed", async () => {
    const f = fixture(); const changed = vi.fn();
    const controller = new SatanicZoneController({ provider: f.provider, now: Date.now, onStateChange: changed });
    await f.collect();
    const incomingSequence = 201 + generic(opcodeOnlyReadyBody).length + generic(inventedLoginSuccess()).length;
    f.receive(f.packet(false, incomingSequence, generic(inventedZoneBody)));
    const passiveAt = Date.now();
    expect(controller.getState()).toMatchObject({ phase: "current", source: "captured", current: { rawZone: "Act_04_03" } });
    const request = controller.refreshNow(); await flush();
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
    expect(await request).toEqual({ accepted: true, errorCode: null });
    await vi.advanceTimersByTimeAsync(100); const receivedAt = Date.now();
    f.sockets[0].receive(Buffer.from('{"satanicZoneName":"Unknown","buffs":"","debuffs":""}')); await flush();
    expect(controller.getState()).toMatchObject({ phase: "current", source: "captured", errorCode: null,
      current: { rawZone: "Act_04_03" }, lastSuccessAt: receivedAt });
    expect(receivedAt).toBeGreaterThan(passiveAt);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ source: "captured", lastSuccessAt: receivedAt }), true);
    expect(satanicZoneDisplay(controller.getState(), receivedAt).phase).toBe("current");
    controller.dispose(); f.provider.dispose();
  });
  test("a validated owned SZ arriving before wait registration is delivered once after transport returns Ready", async () => {
    const f = fixture(); await f.collect(); const request = await f.dispatch();
    const responseAt = Date.now(); f.sockets[0].receive(inventedZoneBody); await flush();
    expect(f.transportProgress.at(-1)).toMatchObject({ stage: "zone", zoneWritten: true,
      observation: { zone: { rawZone: "Act_04_03", updatedAt: responseAt }, observedAt: responseAt } });
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: null });
    expect(await f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 }))
      .toMatchObject({ kind: "observation", observation: { zone: { rawZone: "Act_04_03", updatedAt: responseAt }, observedAt: responseAt },
        availabilityConsumed: false, refreshAvailable: true });
    expect(await f.provider.waitForObservation(request.correlationId!, { timeoutMs: 30_000 })).toBeNull();
    expect(f.sockets).toHaveLength(1); f.provider.dispose();
  });
  test.each(["wait first", "owned response before public wait"])("owned success reaches public controller and renderer with %s despite competing passive traffic", async ordering => {
    let controller!: SatanicZoneController;
    const states: SatanicZoneState[] = [], f = fixture(undefined, preparation => controller?.setPreparation(preparation));
    controller = new SatanicZoneController({ provider: f.provider, now: Date.now, onStateChange: state => states.push(state) });
    await f.collect(); controller.observePassiveTimeout(); expect(controller.getState().errorCode).toBe("response_timeout");
    const wait = vi.spyOn(f.provider, "waitForObservation"), originalRequest = f.provider.requestRefresh.bind(f.provider);
    let releaseDispatch!: () => void;
    const handoff = new Promise<void>(resolve => { releaseDispatch = resolve; });
    if (ordering === "owned response before public wait") vi.spyOn(f.provider, "requestRefresh").mockImplementation(async options => {
      const dispatched = await originalRequest(options); await handoff; return dispatched;
    });
    const attemptedAt = Date.now(), request = controller.refreshNow(); await flush();
    expect(f.sockets).toHaveLength(1); expect(controller.getState()).toMatchObject({ phase: "refreshing", lastAttemptAt: attemptedAt, errorCode: null });
    const incomingSequence = 201 + generic(opcodeOnlyReadyBody).length + generic(inventedLoginSuccess()).length;
    const firstPassive = generic(Buffer.from('{"satanicZoneName":"Act_01_01","buffs":"","debuffs":""}'));
    f.receive(f.packet(false, incomingSequence, firstPassive));
    expect(controller.getState()).toMatchObject({ phase: "refreshing", source: "captured", current: { rawZone: "Act_01_01" } });
    controller.observePassiveRequest(); controller.observePassiveTimeout();
    expect(controller.getState().phase).toBe("refreshing"); expect(wait).not.toHaveBeenCalled();
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess()); await flush();
    if (ordering === "wait first") { expect(await request).toEqual({ accepted: true, errorCode: null }); expect(wait).toHaveBeenCalledTimes(1); }
    else expect(wait).not.toHaveBeenCalled();
    f.receive(f.packet(false, incomingSequence + firstPassive.length,
      generic(Buffer.from('{"satanicZoneName":"Act_02_04","buffs":"","debuffs":""}'))));
    controller.observePassiveTimeout();
    expect(controller.getState()).toMatchObject({ phase: "refreshing", source: "captured", current: { rawZone: "Act_02_04" } });
    await vi.advanceTimersByTimeAsync(100); const responseAt = Date.now();
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect(f.transportProgress.at(-1)?.observation?.zone.rawZone).toBe("Act_04_03");
    expect(f.provider.preparation.phase).toBe("ready");
    if (ordering === "owned response before public wait") {
      expect(wait).not.toHaveBeenCalled(); expect(controller.getState().phase).toBe("refreshing");
      releaseDispatch(); expect(await request).toEqual({ accepted: true, errorCode: null }); await flush();
    }
    expect(wait).toHaveBeenCalledTimes(1);
    const completed = controller.getState();
    expect(completed).toMatchObject({ phase: "current", source: "manual", current: { rawZone: "Act_04_03", updatedAt: responseAt },
      lastAttemptAt: attemptedAt, lastSuccessAt: responseAt, errorCode: null, refreshAvailable: true, refreshPreparation: { phase: "ready" } });
    expect(completed.validUntil).toBeGreaterThan(responseAt); expect(completed.nextAllowedRefreshAt).toBeGreaterThan(responseAt);
    expect(satanicZoneDisplay(completed, responseAt)).toMatchObject({ phase: "current", statusLabel: "Current",
      statusDetail: "Received through manual refresh.", observedLabel: "Observed just now" });
    expect(satanicZoneRefreshControl(completed, responseAt, false)).toMatchObject({ visible: true, disabled: true });
    expect(states.filter(state => state.phase === "current" && state.source === "manual" && state.lastSuccessAt === responseAt)).toHaveLength(1);
    controller.observePassiveTimeout(responseAt + 500, attemptedAt - 500);
    expect(controller.getState()).toMatchObject({ phase: "current", errorCode: null, lastSuccessAt: responseAt });
    await vi.advanceTimersByTimeAsync(30_000); await flush();
    expect(controller.getState()).toMatchObject({ phase: "current", source: "manual", lastSuccessAt: responseAt, errorCode: null });
    expect(satanicZoneRefreshControl(controller.getState(), Date.now(), false)).toMatchObject({ visible: true, disabled: false });
    expect(f.sockets).toHaveLength(1); controller.dispose(); f.provider.dispose();
  });
  test.each([["77777777777777777777", "0"], ["12345678901234567890", "1"]])(
    "private identity %s/%s invalidates native continuity but preserves deliberately saved inputs", async (uid, beta) => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true);
    expect(await f.cache.unlock(cachePassphrase)).toBe(true);
    await f.collect();
    f.provider.observeCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" }, true);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.close).not.toHaveBeenCalled();
    expect(f.cache.snapshot().status).toBe("saved");
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    const changed = frameDiagnosticBody(inventedPostLogin(uid, beta), 9);
    // Only private packets provide this contrary identity, through real framing.
    f.receive(f.packet(true, sequence + 12, changed.subarray(12)));
    f.receive(f.packet(true, sequence, changed.subarray(0, 12))); await flush();
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" }); expect(fs.existsSync(file)).toBe(true);
    expect(f.sockets).toHaveLength(0); expect((await f.dispatch()).accepted).toBe(true); f.provider.dispose();
  });
  test("contrary private identity after a failed local save prevents resaving stale native credentials", async () => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true);
    expect(await f.cache.unlock(cachePassphrase)).toBe(true);
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("synthetic write failure"); });
    await f.collect(); expect(f.cache.snapshot().status).toBe("storage_error");
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    f.receive(f.packet(true, sequence, frameDiagnosticBody(inventedPostLogin("77777777777777777777"), 9)));
    await flush(); expect(fs.existsSync(file)).toBe(false);
    expect((await f.provider.requestRefresh()).accepted).toBe(false);
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
  test("incomplete private traffic is reported ahead of an unrelated locked portable cache", async () => {
    const f = cacheFixture(cacheFile()); f.cache.configure(true);
    await f.collect(); expect(f.cache.snapshot().status).toBe("locked");
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    const identity = frameDiagnosticBody(inventedPostLogin(), 9); f.receive(f.packet(true, sequence + 17, identity.subarray(17)));
    expect(f.snapshots.at(-1)).toEqual({ phase: "collecting", expiresAt: null, reason: "traffic_incomplete" });
    expect(await f.provider.getAvailability()).toMatchObject({ available: false });
    f.receive(f.packet(true, sequence, identity.subarray(0, 17)));
    expect(f.snapshots.at(-1)).toEqual({ phase: "ready", expiresAt: null }); f.provider.dispose();
  });
  test("a gameplay-only reconfiguration during a partial private identity keeps its observer open until the matching tail", async () => {
    const f = fixture(); await f.collect();
    const sequence = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    const identity = frameDiagnosticBody(inventedPostLogin(), 9);
    f.receive(f.packet(true, sequence, identity.subarray(0, 17)));
    expect(f.provider.preparation.phase).toBe("collecting");
    f.provider.observeCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" }, true);
    expect(f.provider.preparation).toEqual({ phase: "collecting", expiresAt: null, reason: "traffic_incomplete" });
    expect(f.close).not.toHaveBeenCalled(); expect(f.open).toHaveBeenCalledTimes(1);
    expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.sockets).toHaveLength(0);
    f.receive(f.packet(true, sequence + 17, identity.subarray(17)));
    expect(f.snapshots.at(-1)).toEqual({ phase: "ready", expiresAt: null });
    expect((await f.dispatch()).accepted).toBe(true); expect(f.sockets).toHaveLength(1); f.provider.dispose();
  });
  test("overlapping inbound/outbound fragments need no simultaneous idle boundary after native initialization", async () => {
    const f = fixture(); await f.collect();
    let outgoing = 101 + frameDiagnosticBody(inventedConnect(), 7).length + frameDiagnosticBody(inventedPostLogin(), 8).length;
    let incoming = 201 + generic(opcodeOnlyReadyBody).length + generic(inventedLoginSuccess()).length;
    const response = generic(inventedZoneBody);
    f.receive(f.packet(false, incoming, response.subarray(0, 17)));
    for (let counter = 9; counter < 13; counter++) {
      const identity = frameDiagnosticBody(inventedPostLogin(), counter);
      f.receive(f.packet(true, outgoing, identity.subarray(0, 17)));
      expect(f.provider.preparation.phase).toBe("collecting");
      if (counter > 9) {
        f.receive(f.packet(false, incoming + 17, response.subarray(17))); incoming += response.length;
        f.receive(f.packet(false, incoming, response.subarray(0, 17)));
      }
      f.receive(f.packet(true, outgoing + 17, identity.subarray(17))); outgoing += identity.length;
      expect(f.snapshots.at(-1)).toEqual({ phase: "ready", expiresAt: null });
      expect(await f.provider.getAvailability()).toMatchObject({ available: true });
      expect(f.sockets).toHaveLength(0);
    }
    expect((await f.dispatch()).accepted).toBe(true); expect(f.sockets).toHaveLength(1); f.provider.dispose();
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
  test("explicit Refresh retries a local disk failure while the native pair remains usable", async () => {
    const file = cacheFile(), f = cacheFixture(file); f.cache.configure(true);
    expect(await f.cache.unlock(cachePassphrase)).toBe(true);
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("synthetic write failure"); });
    await f.collect(); expect(f.cache.snapshot().status).toBe("storage_error"); expect(fs.existsSync(file)).toBe(false);
    const result = await f.dispatch(); await flush(); expect(result.accepted).toBe(true);
    expect(f.cache.snapshot().status).toBe("saved"); expect(fs.existsSync(file)).toBe(true);
    expect(rename).toHaveBeenCalledTimes(2); rename.mockRestore(); f.provider.dispose();
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
    expect(await f.cache.unlock(cachePassphrase)).toBe(true);
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
  test.each([{ observationGap: true as const }, { status: "error" as const }, { running: false }])(
    "an unclassified gap, error or actual Stop still suspends native Ready: %j", async update => {
      const f = fixture(); await f.collect(); f.provider.observeCaptureUpdate(update, true);
      expect(f.provider.preparation.phase).toBe("suspended"); expect(f.close).toHaveBeenCalledTimes(1);
      expect((await f.provider.requestRefresh()).accepted).toBe(false); expect(f.sockets).toHaveLength(0); f.provider.dispose();
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
      launchExecutable: async () => { await launch.executable(); },
      addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    const launched = async () => {
      order.push("launch"); expect(f.open).toHaveBeenCalledTimes(1);
      f.network.gameProcessIds = [42];
      f.network.connections = [{ ...scope, localPort: 4999, owningProcess: 42, state: "established" }];
      await f.collect(inventedConnect(), inventedPostLogin(), false);
      return "";
    };
    launch.steam.mockImplementation(launched); launch.executable.mockImplementation(launched);
    await coordinator.launchOrCapture({ launchThroughSteam: steam });
    expect(order).toEqual(["listener", "launch"]);
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0);
    expect((await f.dispatch()).accepted).toBe(true); expect(f.sockets).toHaveLength(1);
    f.provider.dispose(); coordinator.clearLaunchCaptureTimer();
  });
  test("saved Ready still opens the listener before HSC launch and collects an updated native pair without sending", async () => {
    const file = cacheFile(), f = cacheFixture(file), order: string[] = [];
    f.cache.configure(true); await f.cache.unlock(cachePassphrase);
    await f.cache.remember({ connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), scope,
      identity: { uniqueAccountId: "12345678901234567890", beta: "0" }, nativePort: 5000 }, 42);
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
    const originalOpen = f.open.getMockImplementation()!;
    f.open.mockImplementation(async (...args) => { order.push("listener"); return originalOpen(...args); });
    const coordinator = new GameCaptureCoordinator({ state: createInitialCompanionState(),
      getCaptureService: () => ({ hasHeroSiegeProcess: async () => false, start: vi.fn(), stop: vi.fn(),
        diagnostics: async () => ({}), setCapturePreferences: vi.fn() }),
      beforeCapture: () => f.provider.preparePassively(), addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    const replacement = Buffer.from(inventedPostLogin().toString().replace("a".repeat(64), "b".repeat(64)));
    launch.steam.mockImplementation(async () => { order.push("launch"); await f.collect(inventedConnect(), replacement, false); });
    await coordinator.launchOrCapture({ launchThroughSteam: true });
    expect(order).toEqual(["listener", "launch"]); expect(f.cache.restoreInput()?.postLoginBody).toEqual(replacement);
    expect(f.provider.preparation).toMatchObject({ phase: "ready" }); expect(f.provider.preparation.origin).toBeUndefined();
    expect(f.sockets).toHaveLength(0); f.provider.dispose(); coordinator.clearLaunchCaptureTimer();
  });
  test.each([true, false])("saved attempt SYN captured before owned progress=%s cannot consume the next game initialization", async early => {
    const f = cacheFixture(cacheFile()); f.cache.configure(true); await f.cache.unlock(cachePassphrase);
    await f.cache.remember({ connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), scope,
      identity: { uniqueAccountId: "12345678901234567890", beta: "0" }, nativePort: 5000 }, 42);
    await f.provider.preparePassively();
    const ownSyn = { ...f.packet(true, 100, undefined, 2), srcPort: 6000 };
    if (early) vi.spyOn(Socket.prototype, "connect").mockImplementation(function (_port, _address, connected) {
      f.receive(ownSyn); connected(); return this;
    });
    const request = f.provider.requestRefresh(); await flush(); if (!early) f.receive(ownSyn);
    const replacement = Buffer.from(inventedPostLogin().toString().replace("a".repeat(64), "b".repeat(64)));
    await f.collect(inventedConnect(), replacement, false);
    expect(f.cache.restoreInput()?.postLoginBody).toEqual(replacement);
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
    const accepted = await request, waiting = f.provider.waitForObservation(accepted.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await waiting)?.kind).toBe("observation");
    expect(f.provider.preparation).toMatchObject({ phase: "ready" }); expect(f.provider.preparation.origin).toBeUndefined();
    expect(f.sockets).toHaveLength(1); f.provider.dispose();
  });
  test.each(["owned first", "game first", "game completes before connect"])("both SYNs before saved connect completion preserve native initialization: %s", async ordering => {
    const f = cacheFixture(cacheFile()); f.cache.configure(true); await f.cache.unlock(cachePassphrase);
    await f.cache.remember({ connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), scope,
      identity: { uniqueAccountId: "12345678901234567890", beta: "0" }, nativePort: 5000 }, 42);
    await f.provider.preparePassively();
    let connected!: () => void;
    vi.spyOn(Socket.prototype, "connect").mockImplementation(function (_port, _address, callback) { connected = callback; return this; });
    const request = f.provider.requestRefresh(); await flush();
    const ownSyn = { ...f.packet(true, 100, undefined, 2), srcPort: 6000 };
    if (ordering === "owned first") f.receive(ownSyn);
    const replacement = Buffer.from(inventedPostLogin().toString().replace("a".repeat(64), "b".repeat(64)));
    const collecting = f.collect(inventedConnect(), replacement, false,
      scope, 5000, ordering !== "owned first" ? () => f.receive(ownSyn) : undefined);
    if (ordering === "game completes before connect") {
      await collecting;
      expect(f.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
      connected(); await flush();
    } else { await flush(); connected(); await collecting; }
    expect(f.cache.restoreInput()?.postLoginBody).toEqual(replacement);
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
    const accepted = await request, waiting = f.provider.waitForObservation(accepted.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody); expect((await waiting)?.kind).toBe("observation");
    expect(f.provider.preparation).toMatchObject({ phase: "ready" }); expect(f.provider.preparation.origin).toBeUndefined();
    await f.collect(inventedConnect(), inventedPostLogin(), false);
    expect(f.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
    expect(f.sockets).toHaveLength(1); f.provider.dispose();
  });
  test("an unresolved second SYN exceeding its packet bound cannot become native Ready or overwrite saved inputs", async () => {
    const f = cacheFixture(cacheFile()); f.cache.configure(true); await f.cache.unlock(cachePassphrase);
    await f.cache.remember({ connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), scope,
      identity: { uniqueAccountId: "12345678901234567890", beta: "0" }, nativePort: 5000 }, 42);
    await f.provider.preparePassively();
    vi.spyOn(Socket.prototype, "connect").mockImplementation(function () { return this; });
    const abort = new AbortController(), request = f.provider.requestRefresh({ signal: abort.signal }); await flush();
    const replacement = Buffer.from(inventedPostLogin().toString().replace("a".repeat(64), "b".repeat(64)));
    await f.collect(inventedConnect(), replacement, false, scope, 5000, () => {
      f.receive({ ...f.packet(true, 100, undefined, 2), srcPort: 5001 });
      for (let i = 0; i < 128; i++) f.receive({ ...f.packet(true, 101 + i, Buffer.from([0])), srcPort: 5001 });
    });
    expect(f.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
    expect(f.diagnostics).toContainEqual(expect.objectContaining({ reason: "byte-limit", phase: "incomplete" }));
    expect(f.sockets[0].writes).toHaveLength(0);
    abort.abort(); expect(await request).toMatchObject({ accepted: false }); f.provider.dispose(); await flush();
    expect(f.budgets[0].usedBytes).toBe(0);
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
