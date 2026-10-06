import { EventEmitter } from "node:events";
import type net from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runInitializedSatanicZoneProbe, type InitializedProbeProgress } from "../../src/main/satanic-zone-initialized-transport";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
import { buildDirectApiFrame, buildDirectApiPingFrame, buildDirectSatanicZoneFrame } from "../../src/main/direct-satanic-zone-protocol";
import { connectProbeIdentity, coherentProbePostLogin, isProbeConnectAcknowledgment, summarizeProbeConnectAcknowledgment, successfulProbeIdentifier } from "../../src/main/satanic-zone-initialized-protocol";
import { inventedProbeScope as scope, inventedProbeIdentity as identity, inventedConnect, inventedPostLogin,
  genericProbeFrame as generic, inventedReadyBody, opcodeOnlyReadyBody, inventedLoginSuccess, inventedZoneBody } from "../fixtures/satanic-zone-initialized";
import { connectDiagnosticBody } from "../fixtures/satanic-zone-diagnostic-frames";

class MockSocket extends EventEmitter {
  localAddress = scope.localAddress; localPort = 6000;
  remoteAddress = scope.remoteAddress; remotePort = scope.remotePort;
  connected!: () => void;
  writes: Buffer[] = [];
  callbacks: ((error?: Error) => void)[] = [];
  delayed = false;
  connect = vi.fn((_port: number, _address: string, callback: () => void) => { this.connected = callback; return this; });
  write(bytes: Buffer, callback: (error?: Error) => void) {
    this.writes.push(Buffer.from(bytes)); this.callbacks.push(callback); if (!this.delayed) callback(); return true;
  }
  destroy = vi.fn(() => this);
}
function fixture(limit = 1_048_576) {
  vi.useFakeTimers();
  const socket = new MockSocket(), abort = new AbortController(), budget = new SatanicZoneDiagnosticBufferBudget(limit);
  const progress: InitializedProbeProgress[] = [];
  const connectBody = inventedConnect(), postLoginBody = inventedPostLogin();
  const result = runInitializedSatanicZoneProbe({ connectBody, postLoginBody, identity, scope, nativePort: 5000 },
    abort.signal, budget, value => progress.push(value), () => socket as unknown as net.Socket);
  const incoming = (body: Buffer) => socket.emit("data", generic(body));
  return { socket, abort, budget, result, progress, connectBody, postLoginBody, incoming };
}
afterEach(() => vi.useRealTimers());
describe("initialized probe with invented bodies and a mocked owned socket", () => {
  test.each(["generic", "api"] as const)("a fragmented %s opcode-only 0x1000 advances only after its entire frame", async framing => {
    const f = fixture(); f.socket.connected();
    const ack = framing === "api" ? buildDirectApiFrame(opcodeOnlyReadyBody, 201) : generic(opcodeOnlyReadyBody);
    expect(generic(opcodeOnlyReadyBody)).toHaveLength(10);
    f.socket.emit("data", Buffer.concat([generic(Buffer.from([1, 0])), ack.subarray(0, ack.length - 1)]));
    expect(f.socket.writes).toHaveLength(2);
    f.socket.emit("data", Buffer.from(ack.subarray(ack.length - 1)));
    expect(f.socket.writes[2]).toEqual(buildDirectApiFrame(f.postLoginBody, 2));
    expect(f.progress.at(-1)?.connectAcknowledgment).toEqual({ bodyBytes: 2, opcode: "0x1000", trailingNul: false, embeddedNul: false });
    f.incoming(inventedLoginSuccess()); f.incoming(inventedZoneBody);
    expect(await f.result).toBe("success"); expect(f.budget.usedBytes).toBe(0);
    expect(f.progress.at(-1)).toMatchObject({ inboundFrames: 4, outboundFrames: 4, controlFrames: 2,
      observation: { zone: { rawZone: "Act_04_03" } } });
  });
  test("malformed ack evidence contains only length, known opcode and NUL flags", async () => {
    const f = fixture(); f.socket.connected(); f.incoming(Buffer.from([0, 16, 65, 0, 66]));
    expect(await f.result).toBe("failed");
    expect(f.progress.at(-1)?.connectAcknowledgment).toEqual({ bodyBytes: 5, opcode: "0x1000", trailingNul: false, embeddedNul: true });
    expect(f.socket.writes).toHaveLength(2); expect(f.budget.usedBytes).toBe(0);
    expect(summarizeProbeConnectAcknowledgment(Buffer.from([255, 255, 0]))).toEqual({ bodyBytes: 3, opcode: "other", trailingNul: true, embeddedNul: false });
    expect(summarizeProbeConnectAcknowledgment(Buffer.from([0]))).toEqual({ bodyBytes: 1, opcode: "missing", trailingNul: false, embeddedNul: false });
  });
  test("an opcode-only acknowledgment repeated after PostLogin still fails order", async () => {
    const f = fixture(); f.socket.connected(); f.incoming(opcodeOnlyReadyBody); f.incoming(opcodeOnlyReadyBody);
    expect(await f.result).toBe("failed"); expect(f.socket.writes).toHaveLength(3);
    expect(f.budget.usedBytes).toBe(0);
  });
  test.each(["generic", "api"] as const)("fragmented %s string-bearing acknowledgment permits PostLogin only after its terminator", async framing => {
    const f = fixture(); f.socket.connected();
    const ack = framing === "api" ? buildDirectApiFrame(inventedReadyBody, 201) : generic(inventedReadyBody);
    f.socket.emit("data", Buffer.from(ack.subarray(0, 5)));
    f.socket.emit("data", Buffer.from(ack.subarray(5, ack.length - 1)));
    expect(f.socket.writes).toHaveLength(2);
    f.socket.emit("data", Buffer.from(ack.subarray(ack.length - 1)));
    expect(f.socket.writes[2]).toEqual(buildDirectApiFrame(f.postLoginBody, 2));
    f.incoming(inventedLoginSuccess()); f.incoming(inventedZoneBody);
    expect(await f.result).toBe("success"); expect(f.budget.usedBytes).toBe(0);
    expect(JSON.stringify(f.progress)).not.toContain("CANARY_ACK");
  });
  test.each([Buffer.from([0, 16, 65]), Buffer.from([0, 16, 65, 0, 66]),
    Buffer.from([0, 16, 255, 0]), Buffer.concat([Buffer.from([0, 16]), Buffer.alloc(16_383)])])(
    "malformed or oversize acknowledgment prevents PostLogin", async body => {
      expect(isProbeConnectAcknowledgment(body)).toBe(false);
      const f = fixture(); f.socket.connected(); f.incoming(body);
      expect(await f.result).toBe("failed"); expect(f.socket.writes).toHaveLength(2); expect(f.budget.usedBytes).toBe(0);
    });
  test("an empty type-11 string is complete; a different opcode is not an acknowledgment", () => {
    expect(isProbeConnectAcknowledgment(opcodeOnlyReadyBody)).toBe(true);
    expect(isProbeConnectAcknowledgment(Buffer.from([0, 16, 0]))).toBe(true);
    expect(isProbeConnectAcknowledgment(Buffer.from([1, 16, 0]))).toBe(false);
    expect(isProbeConnectAcknowledgment(Buffer.from([1, 0]))).toBe(false);
    expect(isProbeConnectAcknowledgment(Buffer.alloc(0))).toBe(false);
    expect(isProbeConnectAcknowledgment(Buffer.from([0]))).toBe(false);
  });
  test("native success permits repeated nested keys but rejects duplicate or escaped duplicate root keys", () => {
    const json = '{"status":1,"globalIdentifier":"9876543210","records":[{"id":1},{"id":2,"status":0}],"note":"\\\"status\\\":0"}';
    expect(successfulProbeIdentifier(inventedLoginSuccess(json))).toBe("9876543210");
    expect(successfulProbeIdentifier(inventedLoginSuccess('{"status":1,"status":1,"globalIdentifier":"9876543210"}'))).toBeNull();
    expect(successfulProbeIdentifier(inventedLoginSuccess('{"status":1,"sta\\u0074us":1,"globalIdentifier":"9876543210"}'))).toBeNull();
  });
  test("preserves exact native bodies, advances own counters and uses the NEW login identifier", async () => {
    const f = fixture(); f.socket.connected();
    expect(f.socket.writes).toEqual([buildDirectApiFrame(f.connectBody, 0), buildDirectApiPingFrame(1)]);
    const ready = generic(inventedReadyBody); f.socket.emit("data", Buffer.from(ready.subarray(0, 5)));
    expect(f.socket.writes).toHaveLength(2); f.socket.emit("data", Buffer.from(ready.subarray(5)));
    expect(f.socket.writes[2]).toEqual(buildDirectApiFrame(f.postLoginBody, 2));
    f.incoming(inventedLoginSuccess());
    expect(f.socket.writes[3]).toEqual(buildDirectSatanicZoneFrame({ ...identity, crossregionIdentifier: "9876543210",
      generation: 1, revision: 1, updatedAt: 0, scopeKey: "unused", endpoint: { address: scope.remoteAddress, port: scope.remotePort } }, 3));
    const zone = generic(inventedZoneBody); f.socket.emit("data", Buffer.from(zone.subarray(0, 15)));
    f.socket.emit("data", Buffer.from(zone.subarray(15))); expect(await f.result).toBe("success");
    expect(f.socket.connect).toHaveBeenCalledTimes(1); expect(f.socket.destroy).toHaveBeenCalledTimes(1);
    expect(f.budget.usedBytes).toBe(0); expect(f.socket.listenerCount("data")).toBe(0);
    expect(JSON.stringify(f.progress)).not.toMatch(/CANARY|1234567890|9876543210|checksum/);
  });
  test("a coalesced pre-request zone cannot prove request success", async () => {
    const f = fixture(); f.socket.connected(); f.incoming(inventedReadyBody);
    f.socket.emit("data", Buffer.concat([generic(inventedLoginSuccess()), generic(inventedZoneBody)]));
    expect(f.socket.writes).toHaveLength(4); await vi.advanceTimersByTimeAsync(30_000);
    expect(await f.result).toBe("timeout"); expect(f.socket.connect).toHaveBeenCalledTimes(1);
  });
  test("API-framed inbound replies can fragment and carry independent counters", async () => {
    const f = fixture(); f.socket.connected(); f.incoming(inventedReadyBody);
    const login = buildDirectApiFrame(inventedLoginSuccess(), 200);
    f.socket.emit("data", Buffer.from(login.subarray(0, 8))); f.socket.emit("data", Buffer.from(login.subarray(8)));
    f.socket.emit("data", buildDirectApiFrame(inventedZoneBody, 3));
    expect(await f.result).toBe("success"); expect(f.budget.usedBytes).toBe(0);
  });
  test.each([ '{"status":0,"globalIdentifier":"9876543210"}', '{"status":1,"globalIdentifier":"CANARY_ID"}',
    '{"status":1,"status":0,"globalIdentifier":"9876543210"}', '{"status":1,"globalIdentifier":9007199254740993}' ])(
    "invalid/rejected PostLogin response prevents SZ", async json => {
      const f = fixture(); f.socket.connected(); f.incoming(inventedReadyBody); f.incoming(inventedLoginSuccess(json));
      expect(await f.result).toBe("failed"); expect(f.socket.writes).toHaveLength(3); expect(f.budget.usedBytes).toBe(0);
    });
  test("pong/control traffic cannot extend the absolute attempt deadline", async () => {
    const f = fixture(); f.socket.connected();
    await vi.advanceTimersByTimeAsync(29_000); f.incoming(Buffer.from([1, 0]));
    await vi.advanceTimersByTimeAsync(1000); expect(await f.result).toBe("timeout"); expect(f.socket.writes).toHaveLength(2);
  });
  test("cancellation releases pending writes even when write callbacks never arrive", async () => {
    const f = fixture(); f.socket.delayed = true; f.socket.connected(); f.abort.abort();
    expect(await f.result).toBe("cancelled"); expect(f.budget.usedBytes).toBe(0);
    f.socket.callbacks[0](); expect(f.socket.writes).toHaveLength(1); expect(f.socket.destroy).toHaveBeenCalledTimes(1);
  });
  test("wrong socket attribution fails before transmitting", async () => {
    const f = fixture(); f.socket.localPort = 5000; f.socket.connected();
    expect(await f.result).toBe("failed"); expect(f.socket.writes).toHaveLength(0);
  });
  test("byte-budget exhaustion and socket errors stop once", async () => {
    const f = fixture(16); f.socket.connected(); expect(await f.result).toBe("byte-limit"); expect(f.budget.usedBytes).toBe(0);
    const g = fixture(); g.socket.emit("error", new Error("CANARY_SECRET")); expect(await g.result).toBe("failed");
    expect(JSON.stringify(g.progress)).not.toContain("CANARY"); expect(g.socket.connect).toHaveBeenCalledTimes(1);
  });
  test("represented-input validation rejects incoherent UID/beta without rebuilding native strings", () => {
    expect(connectProbeIdentity(inventedConnect())).toEqual(identity);
    expect(coherentProbePostLogin(inventedPostLogin(), identity)).toBe(true);
    expect(coherentProbePostLogin(inventedPostLogin("7"), identity)).toBe(false);
    expect(coherentProbePostLogin(inventedPostLogin(identity.uniqueAccountId, "1"), identity)).toBe(false);
    expect(successfulProbeIdentifier(inventedLoginSuccess())).toBe("9876543210");
    expect(connectProbeIdentity(connectDiagnosticBody(JSON.stringify({ account: 42, account_uid: identity.uniqueAccountId, checksum: 99 })))).toEqual(identity);
  });
});
