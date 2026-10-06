import { afterEach, describe, expect, test, vi } from "vitest";
import { SatanicZoneInitializedProbeController, createSatanicZoneInitializedProbeRuntime,
  type InitializedProbeDependencies } from "../../src/main/satanic-zone-initialized-controller";
import type { ParsedPayload } from "../../src/main/packet-decoder";
import { copySatanicZoneDiagnosticState, type SatanicZoneDiagnosticState } from "../../src/shared/satanic-zone-diagnostic";
import type { InitializedProbeInput, InitializedProbeOutcome } from "../../src/main/satanic-zone-initialized-transport";
import type { DiagnosticCaptureScope } from "../../src/main/satanic-zone-diagnostic-stream";
import { frameDiagnosticBody } from "../fixtures/satanic-zone-diagnostic-frames";
import { inventedProbeScope as scope, inventedConnect, inventedPostLogin, genericProbeFrame as generic,
  inventedReadyBody, opcodeOnlyReadyBody, inventedLoginSuccess, inventedZoneBody } from "../fixtures/satanic-zone-initialized";
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function packet(outbound: boolean, seq: number, payload = Buffer.alloc(0), flags = 16, port = 5000, flow = scope): ParsedPayload {
  return { src: outbound ? flow.localAddress : flow.remoteAddress, dst: outbound ? flow.remoteAddress : flow.localAddress,
    srcPort: outbound ? port : flow.remotePort, dstPort: outbound ? flow.remotePort : port,
    seq, ack: outbound ? 201 : 101, flags, payload, payloadLength: payload.length, text: "" };
}
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  let receive!: (packet: ParsedPayload, truncated: boolean) => void;
  let resolve!: (outcome: InitializedProbeOutcome) => void;
  let privateInput!: InitializedProbeInput;
  const outcome = new Promise<InitializedProbeOutcome>(yes => { resolve = yes; });
  const updates: SatanicZoneDiagnosticState[] = [], close = vi.fn(); let gamePort = 4999;
  let networkScope = scope, owner = 42;
  const dependencies: InitializedProbeDependencies = {
    prepare: vi.fn().mockResolvedValue(scope),
    open: vi.fn().mockImplementation(async (_scope, callback) => { receive = callback; return { close }; }),
    networkState: vi.fn().mockImplementation(async () => ({ gameProcessIds: [42], antiCheatProcessIds: [],
      connections: [{ ...networkScope, localPort: gamePort, owningProcess: owner, state: "established" }] })),
    canArm: () => true, onChange: value => updates.push(value),
    attempt: vi.fn().mockImplementation(input => { privateInput = input; return outcome; }),
  };
  const controller = new SatanicZoneInitializedProbeController(dependencies);
  async function collect(post = inventedPostLogin(), framing: "generic" | "api" = "generic", fragmented = false,
    options: { loginCounter?: number; connectCounter?: number; ackBody?: Buffer; initialPong?: boolean; corruptConnectToken?: boolean; nativeScope?: DiagnosticCaptureScope } = {}) {
    controller.arm(); await flush();
    const nativeScope = options.nativeScope ?? scope; networkScope = nativeScope;
    const nativePacket = (outbound: boolean, seq: number, payload?: Buffer, flags?: number) => packet(outbound, seq, payload, flags, 5000, nativeScope);
    receive(nativePacket(true, 100, undefined, 2), false); receive(nativePacket(false, 200, undefined, 18), false); gamePort = 5000;
    const connectCounter = options.connectCounter ?? 0;
    const connect = frameDiagnosticBody(inventedConnect(), connectCounter);
    if (options.corruptConnectToken) connect[0] = connect[0] === 97 ? 98 : 97;
    const ackBody = options.ackBody ?? inventedReadyBody;
    const ready = framing === "api" ? frameDiagnosticBody(ackBody, 201) : generic(ackBody);
    receive(nativePacket(true, 101, connect), false);
    const pong = options.initialPong ? generic(Buffer.from([1, 0])) : Buffer.alloc(0);
    if (pong.length) receive(nativePacket(false, 201, pong), false);
    const readySequence = 201 + pong.length;
    if (fragmented) {
      receive(nativePacket(false, readySequence, ready.subarray(0, 5)), false);
      receive(nativePacket(false, readySequence + 5, ready.subarray(5, ready.length - 1)), false);
      receive(nativePacket(false, readySequence + ready.length - 1, ready.subarray(ready.length - 1)), false);
    } else receive(nativePacket(false, readySequence, ready), false);
    receive(nativePacket(true, 101 + connect.length, frameDiagnosticBody(post, (connectCounter + 1) & 255)), false);
    const login = options.loginCounter === undefined ? generic(inventedLoginSuccess()) : frameDiagnosticBody(inventedLoginSuccess(), options.loginCounter);
    receive(nativePacket(false, readySequence + ready.length, login), false);
    await vi.advanceTimersByTimeAsync(1000); await flush();
  }
  return { controller, dependencies, updates, close, collect, resolve, receive: (p: ParsedPayload) => receive(p, false),
    input: () => privateInput, setPort: (port: number) => { gamePort = port; },
    setNetworkScope: (value: DiagnosticCaptureScope) => { networkScope = value; }, setOwner: (value: number) => { owner = value; } };
}
afterEach(() => vi.useRealTimers());
describe("private initialized probe lifecycle with synthetic native frames", () => {
  test.each(["generic", "api"] as const)("a fragmented %s opcode-only 0x1000 after pong reaches Ready without sending", async framing => {
    const f = fixture(); await f.collect(inventedPostLogin(), framing, true, { ackBody: opcodeOnlyReadyBody, initialPong: true });
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", selectionStatus: "attributed", attributed: true,
      outboundFrames: 2, inboundFrames: 3, controlFrames: 2, directOutcome: "not-attempted", requestDispatched: false,
      connectAcknowledgment: { bodyBytes: 2, opcode: "0x1000", trailingNul: false, embeddedNul: false } });
    expect(f.dependencies.attempt).not.toHaveBeenCalled(); f.controller.cancel();
  });
  test("pong cannot satisfy the native connect-ack gate", async () => {
    const f = fixture(); await f.collect(inventedPostLogin(), "generic", false, { ackBody: Buffer.from([1, 0]) });
    expect(f.controller.snapshot()).toMatchObject({ phase: "incomplete", reason: "native-post-login-order", connectAcknowledgment: null });
    expect(f.dependencies.attempt).not.toHaveBeenCalled();
  });
  test("ack rejection retains only length/opcode/NUL flags; projection drops unknown nested fields", async () => {
    const f = fixture(); await f.collect(inventedPostLogin(), "generic", false, { ackBody: Buffer.from([0, 16, 65, 0, 66]) });
    const state = f.controller.snapshot();
    expect(state).toMatchObject({ reason: "native-ack-format", connectAcknowledgment: {
      bodyBytes: 5, opcode: "0x1000", trailingNul: false, embeddedNul: true } });
    Object.assign(state.connectAcknowledgment!, { auth: "CANARY_PRIVATE" });
    const copied = copySatanicZoneDiagnosticState(state);
    expect(Object.keys(copied.connectAcknowledgment!).sort()).toEqual(["bodyBytes", "opcode", "trailingNul", "embeddedNul"].sort());
    expect(JSON.stringify(copied)).not.toContain("CANARY_PRIVATE");
    expect(f.dependencies.attempt).not.toHaveBeenCalled();
  });
  test("a restarted game can change API server and port without retaining the old endpoint", async () => {
    const f = fixture(), next = { ...scope, remoteAddress: "203.0.113.30", remotePort: 6668 };
    await f.collect(inventedPostLogin(), "generic", false, { nativeScope: next });
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", selectionStatus: "attributed", capturePackets: 6,
      apiFlowCount: 1, freshSyn: true, attributed: true, directOutcome: "not-attempted" });
    expect(f.dependencies.open).toHaveBeenCalledWith(scope, expect.any(Function), expect.any(Function), expect.anything());
    expect(f.dependencies.attempt).not.toHaveBeenCalled();
    expect(f.updates.at(-1)).toMatchObject({ phase: "ready", selectionStatus: "attributed" });
    expect(JSON.stringify(f.updates)).not.toMatch(/192\.0\.2|198\.51\.100|203\.0\.113|CANARY/);
    // Mock-only Start confirms that future request scope is the newly attributed tuple.
    f.controller.startAttempt(); await flush(); expect(f.input().scope).toEqual(next);
    f.controller.cancel(); f.resolve("cancelled"); await flush();
  });
  test("a fresh unowned candidate is buffered but never parsed or made Ready", async () => {
    const f = fixture(); f.setOwner(99); await f.collect();
    expect(f.controller.snapshot()).toMatchObject({ phase: "collecting", selectionStatus: "waiting-owner", apiFlowCount: 0,
      freshSyn: true, attributed: false, outboundFrames: 0, inboundFrames: 0, directOutcome: "not-attempted" });
    expect(f.controller.snapshot().bytesObserved).toBeGreaterThan(0);
    f.controller.startAttempt(); expect(f.dependencies.attempt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(119_000);
    expect(f.controller.snapshot()).toMatchObject({ phase: "timed-out", reason: "missing-initialization" });
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  test("midstream traffic and a changed endpoint report a missed SYN without inspecting bodies", async () => {
    const f = fixture(); f.controller.arm(); await flush();
    expect(f.controller.snapshot()).toMatchObject({ phase: "waiting-initialization", selectionStatus: "api-flow-no-syn" });
    const next = { ...scope, remoteAddress: "203.0.113.30", remotePort: 6668 }; f.setNetworkScope(next); f.setPort(5000);
    f.receive(packet(true, 101, frameDiagnosticBody(inventedConnect()), 16, 5000, next));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.controller.snapshot()).toMatchObject({ phase: "waiting-initialization", selectionStatus: "endpoint-changed-no-syn",
      capturePackets: 1, apiFlowCount: 1, freshSyn: false, attributed: false, bytesObserved: 0, outboundFrames: 0, inboundFrames: 0 });
    expect(f.dependencies.attempt).not.toHaveBeenCalled(); f.controller.cancel();
  });
  test("a changed local adapter fails closed using only sanitized scope metadata", async () => {
    const f = fixture(); f.controller.arm(); await flush(); f.setNetworkScope({ ...scope, localAddress: "192.0.2.11" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.controller.snapshot()).toMatchObject({ phase: "incomplete", selectionStatus: "adapter-changed", reason: "scope-changed" });
    expect(f.close).toHaveBeenCalledTimes(1); expect(f.dependencies.attempt).not.toHaveBeenCalled();
    expect(JSON.stringify(f.updates)).not.toContain("192.0.2");
  });
  test.each([false, true])("a second fresh flow stops ambiguity even when it uses the same endpoint: %s", async sameEndpoint => {
    const f = fixture(); f.controller.arm(); await flush(); f.receive(packet(true, 100, undefined, 2));
    f.receive(packet(true, 300, undefined, 2, 5001, sameEndpoint ? scope : { ...scope, remotePort: 6668 }));
    expect(f.controller.snapshot()).toMatchObject({ phase: "ambiguous", selectionStatus: "ambiguous", reason: "ambiguous-flow" });
    expect(f.dependencies.attempt).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  test("capture readiness is published only after open; a SYN during open is preserved", async () => {
    const f = fixture(); let release!: (value: { close: typeof f.close }) => void;
    vi.mocked(f.dependencies.open).mockImplementationOnce(async (_scope, callback) => {
      callback(packet(true, 100, undefined, 2), false);
      return new Promise(yes => { release = yes; });
    });
    f.controller.arm(); await flush();
    expect(f.controller.snapshot()).toMatchObject({ phase: "arming", selectionStatus: "waiting-owner", freshSyn: true });
    release({ close: f.close }); await flush();
    expect(f.controller.snapshot()).toMatchObject({ phase: "collecting", selectionStatus: "waiting-owner", freshSyn: true });
    expect(f.updates.some(value => value.phase === "waiting-initialization")).toBe(false);
    f.controller.cancel(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  test("fragmented API acknowledgment and independent native success counter reach Ready without sending", async () => {
    const f = fixture(); await f.collect(inventedPostLogin(), "api", true, { loginCounter: 3 });
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", directOutcome: "not-attempted", outboundFrames: 2, inboundFrames: 2 });
    expect(f.dependencies.attempt).not.toHaveBeenCalled(); expect(JSON.stringify(f.updates)).not.toContain("CANARY_ACK"); f.controller.cancel();
  });
  test("a fresh native flow can start at a nonzero counter while retaining outbound continuity", async () => {
    const f = fixture(); await f.collect(inventedPostLogin(), "generic", false, { connectCounter: 7 });
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", directOutcome: "not-attempted", outboundFrames: 2, inboundFrames: 2 });
    expect(f.dependencies.attempt).not.toHaveBeenCalled(); f.controller.cancel();
  });
  test.each([
    [{ ackBody: Buffer.from([0, 16, 65]) }, "native-ack-format", "native-acknowledgment"],
    [{ corruptConnectToken: true }, "native-frame-token", "native-outbound-framing"],
  ] as const)("collection rejection publishes only fixed stage/reason metadata", async (options, reason, stage) => {
    const f = fixture(); await f.collect(inventedPostLogin(), "generic", false, options);
    expect(f.controller.snapshot()).toMatchObject({ phase: "incomplete", reason, probeStage: stage, directOutcome: "not-attempted" });
    f.controller.startAttempt(); expect(f.dependencies.attempt).not.toHaveBeenCalled();
    expect(JSON.stringify(f.updates)).not.toMatch(/CANARY|1234567890|9876543210|checksum/);
  });
  test.each(["generic", "api"] as const)("fragmented %s string-bearing Connect acknowledgment reaches Ready", async framing => {
    const f = fixture(); await f.collect(inventedPostLogin(), framing, true);
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", directOutcome: "not-attempted" });
    expect(f.dependencies.attempt).not.toHaveBeenCalled(); expect(JSON.stringify(f.updates)).not.toContain("CANARY_ACK");
    f.controller.startAttempt(); await flush(); expect(f.dependencies.attempt).toHaveBeenCalledTimes(1);
    f.controller.cancel(); f.resolve("cancelled"); await flush();
  });
  test("collection alone never sends; separate Start sends at most once and clears exact bodies", async () => {
    const f = fixture(); expect(f.dependencies.prepare).not.toHaveBeenCalled(); await f.collect();
    expect(f.controller.snapshot().phase).toBe("ready"); expect(f.dependencies.attempt).not.toHaveBeenCalled();
    expect(JSON.stringify(f.updates)).not.toMatch(/CANARY|1234567890|9876543210|checksum/);
    f.controller.startAttempt(); f.controller.startAttempt(); await flush();
    expect(f.dependencies.attempt).toHaveBeenCalledTimes(1); expect(f.input().connectBody).toEqual(inventedConnect());
    expect(f.input().postLoginBody).toEqual(inventedPostLogin());
    f.resolve("success"); await flush(); expect(f.controller.snapshot()).toMatchObject({ phase: "complete", directOutcome: "success" });
    expect(f.input().connectBody.every(byte => byte === 0)).toBe(true); expect(f.input().postLoginBody.every(byte => byte === 0)).toBe(true);
    expect(f.close).toHaveBeenCalledTimes(1); f.controller.startAttempt(); expect(f.dependencies.attempt).toHaveBeenCalledTimes(1);
  });
  test("incoherent native data stops not-run and cannot be started", async () => {
    const f = fixture(); await f.collect(inventedPostLogin("7"));
    expect(f.controller.snapshot()).toMatchObject({ phase: "incomplete", reason: "native-post-login-coherence", probeStage: "native-post-login", directOutcome: "not-attempted" });
    f.controller.startAttempt(); expect(f.dependencies.attempt).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  test("ready expires and releases collection without automatic request", async () => {
    const f = fixture(); await f.collect(); await vi.advanceTimersByTimeAsync(119_000);
    expect(f.controller.snapshot().phase).toBe("timed-out"); expect(f.dependencies.attempt).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  test("changed owning flow at explicit Start fails closed", async () => {
    const f = fixture(); await f.collect(); f.setPort(7000); f.controller.startAttempt(); await flush();
    expect(f.controller.snapshot().reason).toBe("scope-changed"); expect(f.dependencies.attempt).not.toHaveBeenCalled();
  });
  test("capture-close failure prevents authenticated transmission", async () => {
    const f = fixture(); await f.collect(); f.close.mockImplementationOnce(() => { throw new Error("CANARY_CLOSE"); });
    f.controller.startAttempt(); await flush();
    expect(f.controller.snapshot()).toMatchObject({ phase: "incomplete", reason: "capture-failed", directOutcome: "not-attempted" });
    expect(f.dependencies.attempt).not.toHaveBeenCalled(); expect(JSON.stringify(f.updates)).not.toContain("CANARY");
  });
  test("the 30 second bound includes Start revalidation; late success cannot overwrite expiry", async () => {
    const f = fixture(); await f.collect(); f.controller.startAttempt(); await flush();
    await vi.advanceTimersByTimeAsync(30_000); expect(f.controller.snapshot()).toMatchObject({ phase: "timed-out", directOutcome: "timeout" });
    f.resolve("success"); await flush(); expect(f.controller.snapshot().phase).toBe("timed-out");
    expect(f.input().connectBody.every(byte => byte === 0)).toBe(true);
  });
  test("Cancel during collection and during attempt closes buffers once", async () => {
    const f = fixture(); await f.collect(); f.controller.cancel(); f.controller.cancel(); expect(f.close).toHaveBeenCalledTimes(1);
    const g = fixture(); await g.collect(); g.controller.startAttempt(); await flush(); g.controller.cancel();
    expect(g.controller.snapshot().directOutcome).toBe("cancelled"); expect(g.input().connectBody.every(byte => byte === 0)).toBe(true);
    g.resolve("success"); await flush(); expect(g.controller.snapshot().phase).toBe("cancelled");
  });
  test("native passive SZ after readiness cannot complete an attempt", async () => {
    const f = fixture(); await f.collect();
    // A borrowed frame on an unrelated socket cannot alter the private result.
    f.receive(packet(false, 800, generic(inventedZoneBody), 16, 7000));
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", directOutcome: "not-attempted" }); f.controller.cancel();
  });
  test("synthetic boot never inspects a real network or opens native capture", async () => {
    const controller = createSatanicZoneInitializedProbeRuntime({ canArm: () => true, onChange: () => {}, syntheticOnly: true });
    controller.arm(); await flush(); expect(controller.snapshot()).toMatchObject({ phase: "unavailable", reason: "game-not-ready" });
    controller.startAttempt(); expect(controller.snapshot().directOutcome).toBe("not-attempted"); controller.dispose();
  });
});
