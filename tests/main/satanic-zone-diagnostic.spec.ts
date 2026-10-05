import { afterEach, describe, expect, test, vi } from "vitest";
import { SatanicZoneDiagnosticController, type SatanicZoneDiagnosticDependencies } from "../../src/main/satanic-zone-diagnostic-controller";
import { diagnosticCapturePreferences, createSatanicZoneDiagnosticRuntime } from "../../src/main/satanic-zone-diagnostic-runtime";
import { buildDirectApiPingFrame, buildDirectSatanicZoneFrame, extractSatanicZoneObservation } from "../../src/main/direct-satanic-zone-protocol";
import type { DirectSatanicZoneTransportTrace } from "../../src/main/direct-satanic-zone-provider";
import type { SatanicZoneRequestContext } from "../../src/main/captured-session-context";
import type { ParsedPayload } from "../../src/main/packet-decoder";
import type { SatanicZoneDiagnosticState } from "../../src/shared/satanic-zone-diagnostic";
import { copySatanicZoneDiagnosticState, SZ_DIAGNOSTIC_MAX_BYTES } from "../../src/shared/satanic-zone-diagnostic";

const scope = { localAddress: "192.0.2.10", remoteAddress: "198.51.100.20", remotePort: 6669 };
const context: SatanicZoneRequestContext = { generation: 1, revision: 1, updatedAt: 0,
  uniqueAccountId: "CANARY_ACCOUNT_7", crossregionIdentifier: "CANARY_SESSION_9", beta: "0",
  endpoint: { address: scope.remoteAddress, port: scope.remotePort }, scopeKey: "CANARY_SCOPE" };
const body = Buffer.from(JSON.stringify({ satanicZoneName: "Act_04_03", buffs: "", debuffs: "" }));
const zone = extractSatanicZoneObservation(body, 1000)!;

function generic(bytes: Buffer): Buffer {
  const header = Buffer.alloc(8); header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
}
const pong = generic(Buffer.from([1, 0]));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

function packet(outbound: boolean, seq: number, payload: Buffer = Buffer.alloc(0), flags = 16, port = 5000): ParsedPayload {
  return { src: outbound ? scope.localAddress : scope.remoteAddress, dst: outbound ? scope.remoteAddress : scope.localAddress,
    srcPort: outbound ? port : scope.remotePort, dstPort: outbound ? scope.remotePort : port,
    seq, ack: outbound ? 201 : 101, flags, payload, payloadLength: payload.length, text: "" };
}

function harness() {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const updates: SatanicZoneDiagnosticState[] = [];
  const close = vi.fn();
  const dispatched = deferred<void>();
  const outcome = deferred<typeof zone>();
  const abort = vi.fn(() => { dispatched.reject(new Error("CANARY_CANCEL")); outcome.reject(new Error("CANARY_CANCEL")); });
  let receive!: (packet: ParsedPayload, truncated: boolean) => void;
  let trace!: (event: DirectSatanicZoneTransportTrace) => void;
  let gamePort = 4999;
  let gamePid = 42;
  const dependencies: SatanicZoneDiagnosticDependencies = {
    prepare: vi.fn().mockResolvedValue(scope),
    open: vi.fn().mockImplementation(async (_scope, handler, _failed, budget) => {
      receive = handler; const readBuffer = budget.allocate(65_535); const releaseNative = budget.reserve(65_536);
      return { close() { try { close(); } finally { budget.release(readBuffer); releaseNative(); } } };
    }),
    networkState: vi.fn().mockImplementation(async () => ({ gameProcessIds: [gamePid], antiCheatProcessIds: [],
      connections: [{ ...scope, owningProcess: gamePid, state: "established", localPort: gamePort }] })),
    transport: vi.fn().mockImplementation((_context, _signal, observer) => { trace = observer;
      return { dispatched: dispatched.promise, outcome: outcome.promise, abort }; }),
    canArm: vi.fn().mockReturnValue(true), onChange: (state) => updates.push(state),
  };
  const controller = new SatanicZoneDiagnosticController(dependencies);
  async function arm() { controller.arm(); await flush(); }
  function handshake() { receive(packet(true, 100, undefined, 2), false); receive(packet(false, 200, undefined, 18), false); gamePort = 5000; }
  async function initialize(options: { gap?: boolean; split?: boolean; natural?: boolean; controls?: Buffer[]; extraInbound?: Buffer[] } = {}) {
    handshake();
    const requests = Buffer.concat([buildDirectApiPingFrame(0), buildDirectSatanicZoneFrame(context, 1)]);
    if (options.split) {
      receive(packet(true, 106, requests.subarray(5)), false);
      receive(packet(true, 101, requests.subarray(0, 5)), false);
    } else receive(packet(true, options.gap ? 102 : 101, requests), false);
    const responses = Buffer.concat([...(options.controls ?? [pong]), ...(options.extraInbound ?? []),
      options.natural === false ? Buffer.alloc(0) : generic(body)]);
    receive(packet(false, 201, responses.subarray(0, 6)), false);
    receive(packet(false, 207, responses.subarray(6)), false);
    await vi.advanceTimersByTimeAsync(1000); await flush();
  }
  async function direct(options: { second?: Buffer; success?: boolean; localPort?: number } = {}) {
    trace({ kind: "connected", ...scope, localPort: options.localPort ?? 6000 });
    trace({ kind: "outgoing", phase: "bootstrap", bytes: buildDirectApiPingFrame(0) });
    trace({ kind: "incoming", bytes: pong.subarray(0, 3) });
    trace({ kind: "incoming", bytes: pong.subarray(3) });
    trace({ kind: "bootstrapped" });
    trace({ kind: "outgoing", phase: "zone", bytes: buildDirectSatanicZoneFrame(context, 1) });
    dispatched.resolve(); await flush();
    const response = Buffer.concat([options.second ?? pong, options.success ? generic(body) : Buffer.alloc(0)]);
    trace({ kind: "incoming", bytes: response.subarray(0, 7) });
    trace({ kind: "incoming", bytes: response.subarray(7) });
    if (options.success) outcome.resolve(zone);
    await flush();
  }
  return { controller, dependencies, updates, close, abort, outcome, receive: (value: ParsedPayload, truncated = false) => receive(value, truncated),
    arm, handshake, initialize, direct, setGamePid: (value: number) => { gamePid = value; }, dispatched };
}

afterEach(() => { vi.useRealTimers(); });

describe("bounded SZ diagnostic", () => {
  test("does nothing on construction and requires one explicit arm", async () => {
    const fixture = harness();
    expect(fixture.controller.snapshot().phase).toBe("idle");
    expect(fixture.dependencies.prepare).not.toHaveBeenCalled();
    await fixture.arm(); fixture.controller.arm();
    expect(fixture.dependencies.prepare).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.open).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.transport).not.toHaveBeenCalled();
    fixture.controller.cancel(); expect(fixture.close).toHaveBeenCalledTimes(1);
  });

  test("attributes a fresh fragmented/coalesced initialization before one independent refresh", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize({ split: true });
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "requesting", freshSyn: true,
      attributed: true, initializationComplete: true, naturalBaseline: true, requestDispatched: false });
    expect(fixture.dependencies.transport).toHaveBeenCalledTimes(1);
    await fixture.direct({ success: true });
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "complete", directOutcome: "success",
      requestDispatched: true, bootstrapPong: true, secondControl: "same-as-pong", requestBodyMatchesNative: true });
    expect(fixture.controller.snapshot()).toMatchObject({ nativeBootstrapControl: "same-as-pong", secondControlMatchesNative: true });
    expect(fixture.controller.snapshot().frames.map((frame) => frame.direction)).toEqual(["outbound", "outbound", "inbound", "inbound"]);
    expect(fixture.controller.snapshot().directEvents.map((event) => event.kind)).toContain("second-control");
    expect(fixture.controller.snapshot().peakOwnedBufferBytes).toBeLessThanOrEqual(SZ_DIAGNOSTIC_MAX_BYTES);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(fixture.abort).toHaveBeenCalled();
    const report = JSON.stringify(fixture.updates);
    expect(report).not.toMatch(/CANARY|192\.0\.2|198\.51\.100|unique_account|crossregion|scopeKey|payload|endpoint/);
    expect(fixture.controller.snapshot().frames.map((frame) => frame.kind)).toEqual(["ping", "zone-request", "generic", "generic"]);
    expect(fixture.controller.snapshot().frames.slice(2)).toMatchObject([
      { inboundOrdinal: 1, controlOrdinal: 1, zoneObserved: false },
      { inboundOrdinal: 2, controlOrdinal: null, zoneObserved: true },
    ]);
    expect(fixture.controller.snapshot().nativeZoneInboundOrdinal).toBe(2);
    expect(fixture.controller.snapshot().directEvents.filter((event) => event.controlOrdinal !== null)
      .map((event) => event.controlOrdinal)).toEqual([1, 2]);
  });

  test("the direct second control compares with the first native inbound body, not the second native control", async () => {
    const fixture = harness(); await fixture.arm();
    await fixture.initialize({ controls: [pong, generic(Buffer.from([2, 0]))] }); await fixture.direct();
    const state = fixture.controller.snapshot();
    expect(state.frames.filter((frame) => frame.controlOrdinal !== null)).toMatchObject([
      { inboundOrdinal: 1, controlOrdinal: 1, control: "same-as-pong" },
      { inboundOrdinal: 2, controlOrdinal: 2, control: "other-control" },
    ]);
    expect(state).toMatchObject({ nativeZoneInboundOrdinal: 3, secondControlMatchesNative: true, directOutcome: "pending" });
    fixture.controller.cancel();
  });

  test("a later native control cannot replace the non-control first inbound comparison target", async () => {
    const fixture = harness(); await fixture.arm();
    await fixture.initialize({ controls: [], extraInbound: [generic(Buffer.from('{"ignored":"CANARY_PRIVATE"}')), pong] });
    await fixture.direct();
    expect(fixture.controller.snapshot()).toMatchObject({ nativeBootstrapControl: "not-control",
      nativeZoneInboundOrdinal: 3, secondControlMatchesNative: null });
    expect(fixture.controller.snapshot().frames[3]).toMatchObject({ inboundOrdinal: 2, controlOrdinal: 1 });
    expect(JSON.stringify(fixture.updates)).not.toContain("CANARY"); fixture.controller.cancel();
  });

  test("a zone object before the SZ request cannot mark the baseline or its response ordinal", async () => {
    const fixture = harness(); await fixture.arm(); fixture.handshake();
    const ping = buildDirectApiPingFrame(0); const response = generic(body);
    fixture.receive(packet(true, 101, ping)); fixture.receive(packet(false, 201, response));
    await vi.advanceTimersByTimeAsync(1000); await flush();
    expect(fixture.controller.snapshot()).toMatchObject({ naturalBaseline: false, nativeZoneInboundOrdinal: null });
    expect(fixture.controller.snapshot().frames[1]).toMatchObject({ inboundOrdinal: 1, zoneObserved: false });
    expect(fixture.dependencies.transport).not.toHaveBeenCalled();
    fixture.receive(packet(true, 101 + ping.length, buildDirectSatanicZoneFrame(context, 1)));
    fixture.receive(packet(false, 201 + response.length, response)); await flush();
    expect(fixture.controller.snapshot()).toMatchObject({ naturalBaseline: true, nativeZoneInboundOrdinal: 2 });
    expect(fixture.dependencies.transport).toHaveBeenCalledTimes(1); fixture.controller.cancel();
  });

  test("the first zone ordinal survives the frame display cap without retaining ignored response contents", async () => {
    const fixture = harness(); await fixture.arm();
    const ignored = generic(Buffer.from('{"ignored":"CANARY_PRIVATE_COMMAND_AND_AUTH"}'));
    await fixture.initialize({ extraInbound: Array.from({ length: 32 }, () => ignored) });
    const state = fixture.controller.snapshot();
    expect(state).toMatchObject({ frameSummaryLimited: true, nativeZoneInboundOrdinal: 34, naturalBaseline: true });
    expect(state.frames).toHaveLength(32); expect(state.frames.some((frame) => frame.zoneObserved)).toBe(false);
    expect(state.frames.at(-1)).toMatchObject({ inboundOrdinal: 30, controlOrdinal: null });
    expect(JSON.stringify(fixture.updates)).not.toContain("CANARY"); fixture.controller.cancel();
  });

  test("metadata projection strips arbitrary operation, field and response values from both sequences", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize(); await fixture.direct();
    const state = fixture.controller.snapshot();
    Object.assign(state.frames[0], { operation: "CANARY_UNKNOWN_COMMAND", fieldValues: { auth: "CANARY_PRIVATE" } });
    Object.assign(state.directEvents[0], { raw: Buffer.from("CANARY_PRIVATE"), response: "CANARY_PRIVATE" });
    const projected = copySatanicZoneDiagnosticState(state);
    expect(JSON.stringify(projected)).not.toContain("CANARY");
    expect(Object.keys(projected.frames[0]).sort()).toEqual(["direction", "kind", "bodyBytes", "counter", "control",
      "inboundOrdinal", "controlOrdinal", "zoneObserved"].sort());
    expect(Object.keys(projected.directEvents[0]).sort()).toEqual(["kind", "direction", "bytes", "control", "controlOrdinal"].sort());
    fixture.controller.cancel();
  });

  test("passive baseline never counts as direct success", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize(); await fixture.direct();
    expect(fixture.controller.snapshot()).toMatchObject({ naturalBaseline: true, directOutcome: "pending" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "timed-out", directOutcome: "timeout", secondControl: "same-as-pong" });
    expect(fixture.dependencies.transport).toHaveBeenCalledTimes(1);
  });

  test("classifies an unknown second control without exposing its value", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize();
    await fixture.direct({ second: generic(Buffer.from([0xab, 0xcd])) });
    expect(fixture.controller.snapshot().secondControl).toBe("other-control");
    expect(fixture.controller.snapshot().secondControlMatchesNative).toBe(false);
    expect(JSON.stringify(fixture.updates)).not.toMatch(/abcd|52651/);
    fixture.controller.cancel();
  });

  test("missing SYN cannot be called complete and never sends a request", async () => {
    const fixture = harness(); await fixture.arm();
    fixture.receive(packet(true, 101, buildDirectSatanicZoneFrame(context, 1)));
    fixture.receive(packet(false, 201, generic(body)));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "timed-out", reason: "missing-initialization", initializationComplete: false });
    expect(fixture.dependencies.transport).not.toHaveBeenCalled();
  });

  test("a fresh stream gap prevents natural-baseline readiness", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize({ gap: true });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(fixture.controller.snapshot().initializationComplete).toBe(false);
    expect(fixture.dependencies.transport).not.toHaveBeenCalled();
  });

  test("no natural zone exchange stops without asking for resets", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize({ natural: false });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "timed-out", reason: "missing-baseline" });
    expect(fixture.dependencies.transport).not.toHaveBeenCalled();
  });

  test("a second fresh candidate is ambiguous", async () => {
    const fixture = harness(); await fixture.arm(); fixture.handshake(); fixture.receive(packet(true, 300, undefined, 2, 5001));
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "ambiguous", reason: "ambiguous-flow" });
    expect(fixture.close).toHaveBeenCalledTimes(1); expect(fixture.dependencies.transport).not.toHaveBeenCalled();
  });

  test("the independent socket must have a different attributed local port", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize(); await fixture.direct({ localPort: 5000 });
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "ambiguous", directOutcome: "failed", requestDispatched: false });
  });

  test("truncation and the cumulative byte cap fail closed", async () => {
    const fixture = harness(); await fixture.arm(); fixture.receive(packet(true, 100, undefined, 2), true);
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "incomplete", reason: "capture-truncated" });
    await fixture.arm(); fixture.receive(packet(true, 101, Buffer.alloc(SZ_DIAGNOSTIC_MAX_BYTES + 1)));
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "incomplete", reason: "byte-limit" });
    expect(fixture.dependencies.transport).not.toHaveBeenCalled();
  });

  test("cancel and shutdown fence late outcomes and permit no duplicate dispatch", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize();
    fixture.controller.cancel(); fixture.outcome.resolve(zone); fixture.dispatched.resolve(); await flush();
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "cancelled", directOutcome: "cancelled" });
    fixture.controller.dispose(); fixture.controller.arm();
    expect(fixture.dependencies.transport).toHaveBeenCalledTimes(1);
    expect(fixture.controller.snapshot().phase).toBe("cancelled");
  });

  test("a replaced game PID cancels only this diagnostic", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize(); fixture.setGamePid(43);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "incomplete", reason: "scope-changed" });
  });

  test("dependency exceptions never become public errors or summaries", async () => {
    const fixture = harness(); vi.mocked(fixture.dependencies.prepare).mockRejectedValue(new Error("CANARY_PASSWORD endpoint=198.51.100.20"));
    await fixture.arm(); expect(fixture.controller.snapshot()).toMatchObject({ phase: "unavailable", reason: "game-not-ready" });
    expect(JSON.stringify(fixture.updates)).not.toMatch(/CANARY|198\.51/);
    vi.mocked(fixture.dependencies.canArm).mockImplementation(() => { throw new Error("CANARY_TOKEN"); });
    fixture.controller.arm(); expect(fixture.controller.snapshot().reason).toBe("busy");
  });

  test("late adapter opening after cancellation closes only that owned handle", async () => {
    const fixture = harness(); const opening = deferred<{ close(): void }>();
    vi.mocked(fixture.dependencies.open).mockReturnValue(opening.promise);
    await fixture.arm(); fixture.controller.cancel(); opening.resolve({ close: fixture.close }); await flush();
    expect(fixture.close).toHaveBeenCalledTimes(1); expect(fixture.controller.snapshot().phase).toBe("cancelled");
  });

  test("synthetic-only app runtime never reaches native capture or a socket", async () => {
    const updates: SatanicZoneDiagnosticState[] = [];
    const controller = createSatanicZoneDiagnosticRuntime({ syntheticOnly: true, canArm: () => true, onChange: (state) => updates.push(state) });
    expect(controller.snapshot().phase).toBe("idle"); controller.arm(); await flush();
    expect(controller.snapshot()).toMatchObject({ phase: "unavailable", reason: "game-not-ready" }); controller.dispose();
  });

  test("normal capture logging stays suspended despite enabled Deep preferences", () => {
    const requested = { captureDebugLogging: true, capturePayloadLogging: true, captureWideLogging: true, satanicZoneDebugLogging: true };
    expect(diagnosticCapturePreferences(requested, true)).toEqual({ captureDebugLogging: false, capturePayloadLogging: false,
      captureWideLogging: false, satanicZoneDebugLogging: false });
    expect(diagnosticCapturePreferences(requested, false)).toEqual(requested);
  });

  test("an accepted diagnostic dispatch blocks other refreshes through the existing spacing interval", async () => {
    const fixture = harness(); await fixture.arm(); await fixture.initialize(); await fixture.direct({ success: true });
    expect(fixture.controller.blocksManualRefresh).toBe(true); fixture.controller.arm();
    expect(fixture.controller.snapshot().reason).toBe("busy"); expect(fixture.dependencies.transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000); expect(fixture.controller.blocksManualRefresh).toBe(false);
    await fixture.arm(); fixture.controller.cancel(); expect(fixture.dependencies.open).toHaveBeenCalledTimes(2);
  });

  test("shutdown while waiting clears the owned handle and fences all later packets", async () => {
    const fixture = harness(); await fixture.arm(); fixture.controller.dispose();
    fixture.receive(packet(true, 100, undefined, 2)); await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "cancelled", reason: "shutdown", freshSyn: false });
    expect(fixture.close).toHaveBeenCalledTimes(1); expect(fixture.dependencies.transport).not.toHaveBeenCalled();
  });

  test("native open, polling, close, and transport failures never publish dependency strings", async () => {
    const fixture = harness(); vi.mocked(fixture.dependencies.open).mockRejectedValueOnce(new Error("CANARY_OPEN"));
    await fixture.arm(); expect(fixture.controller.snapshot().reason).toBe("adapter-unavailable");
    await fixture.arm(); vi.mocked(fixture.dependencies.networkState).mockRejectedValueOnce(new Error("CANARY_POLL"));
    await vi.advanceTimersByTimeAsync(1000); expect(fixture.controller.snapshot().reason).toBe("capture-failed");
    await fixture.arm(); fixture.close.mockImplementationOnce(() => { throw new Error("CANARY_CLOSE"); });
    await fixture.initialize(); expect(fixture.controller.snapshot().reason).toBe("capture-failed");
    await fixture.arm(); vi.mocked(fixture.dependencies.transport).mockImplementationOnce(() => { throw new Error("CANARY_TRANSPORT"); });
    await fixture.initialize(); expect(fixture.controller.snapshot().reason).toBe("direct-failed");
    expect(JSON.stringify(fixture.updates)).not.toMatch(/CANARY|192\.0|198\.51/);
  });

  test("owned transient copies stop below the observed-payload cap", async () => {
    const fixture = harness(); await fixture.arm(); fixture.handshake(); await vi.advanceTimersByTimeAsync(1000);
    fixture.receive(packet(true, 101, generic(Buffer.alloc(450_000))));
    expect(fixture.controller.snapshot()).toMatchObject({ phase: "incomplete", reason: "byte-limit" });
    expect(fixture.controller.snapshot().bytesObserved).toBeLessThan(SZ_DIAGNOSTIC_MAX_BYTES);
    expect(fixture.controller.snapshot().peakOwnedBufferBytes).toBeLessThanOrEqual(SZ_DIAGNOSTIC_MAX_BYTES);
    expect(fixture.dependencies.transport).not.toHaveBeenCalled(); expect(fixture.close).toHaveBeenCalledTimes(1);
  });
});
