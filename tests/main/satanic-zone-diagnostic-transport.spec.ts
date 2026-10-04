import { EventEmitter } from "node:events";
import type net from "node:net";
import { describe, expect, test, vi } from "vitest";
import { createDirectSatanicZoneTransport, type DirectSatanicZoneTransportTrace } from "../../src/main/direct-satanic-zone-provider";
import { buildDirectApiPingFrame, buildDirectSatanicZoneFrame } from "../../src/main/direct-satanic-zone-protocol";
import type { SatanicZoneRequestContext } from "../../src/main/captured-session-context";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";

const context: SatanicZoneRequestContext = { generation: 1, revision: 1, updatedAt: 1,
  uniqueAccountId: "CANARY_ACCOUNT", crossregionIdentifier: "CANARY_SESSION", beta: "0", scopeKey: "CANARY_SCOPE",
  endpoint: { address: "198.51.100.20", port: 6669 } };
function generic(body: Buffer) { const header = Buffer.alloc(8); header.writeUInt32LE(body.length, 4); return Buffer.concat([header, body]); }
const pong = generic(Buffer.from([1, 0]));
const response = generic(Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}'));
class MockSocket extends EventEmitter {
  localAddress = "192.0.2.10";
  localPort = 6000;
  writes: Buffer[] = [];
  connected!: () => void;
  expired!: () => void;
  writeError: Error | null = null;
  connect = vi.fn((_port: number, _address: string, callback: () => void) => { this.connected = callback; return this; });
  setTimeout = vi.fn((_ms: number, callback: () => void) => { this.expired = callback; return this; });
  write(bytes: Buffer, callback: (error?: Error) => void) { this.writes.push(Buffer.from(bytes)); callback(this.writeError ?? undefined); return true; }
  destroy = vi.fn(() => { this.emit("close"); return this; });
  end = vi.fn(() => { this.emit("close"); return this; });
}
function fixture(observer?: (event: DirectSatanicZoneTransportTrace) => void, signal?: AbortSignal, bufferBudget?: SatanicZoneDiagnosticBufferBudget) {
  const socket = new MockSocket(); const logs: unknown[] = [];
  const request = createDirectSatanicZoneTransport(context, signal, (name, details) => logs.push({ name, details }),
    { createSocket: () => socket as unknown as net.Socket, trace: observer, bufferBudget });
  void request.dispatched.catch(() => undefined);
  return { socket, request, logs };
}

describe("production SZ diagnostic transport with mocked sockets only", () => {
  test("exposes borrowed trace bytes while the production decoder handles fragmented pong and zone", async () => {
    const kinds: string[] = []; const f = fixture((event) => kinds.push(event.kind));
    f.socket.connected(); expect(f.socket.writes).toEqual([buildDirectApiPingFrame(0)]);
    f.socket.emit("data", pong.subarray(0, 7)); expect(f.socket.writes).toHaveLength(1);
    f.socket.emit("data", pong.subarray(7)); await f.request.dispatched;
    expect(f.socket.writes[1]).toEqual(buildDirectSatanicZoneFrame(context, 1));
    f.socket.emit("data", Buffer.concat([pong, response.subarray(0, 11)])); f.socket.emit("data", response.subarray(11));
    expect(await f.request.outcome).toMatchObject({ rawZone: "Act_04_03" });
    expect(kinds).toContain("connected"); expect(kinds).toContain("bootstrapped"); expect(f.socket.end).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.logs)).not.toMatch(/CANARY|198\.51|192\.0|unique_account|crossregion|scopeKey|payload/);
  });
  test("observer exceptions never enter logs or interrupt success", async () => {
    const f = fixture(() => { throw new Error("CANARY_SECRET"); }); f.socket.connected();
    f.socket.emit("data", Buffer.concat([pong, response])); await f.request.dispatched;
    expect(await f.request.outcome).toMatchObject({ rawZone: "Act_04_03" }); expect(JSON.stringify(f.logs)).not.toContain("CANARY");
  });
  test("cancellation inside connected attribution prevents both writes", async () => {
    const abort = new AbortController(); const f = fixture(() => abort.abort(), abort.signal); f.socket.connected();
    await expect(f.request.dispatched).rejects.toThrow("cancelled"); expect(f.socket.writes).toEqual([]); expect(f.socket.destroy).toHaveBeenCalledTimes(1);
  });
  test("an already cancelled action never connects", async () => {
    const abort = new AbortController(); abort.abort(); const f = fixture(undefined, abort.signal);
    await expect(f.request.dispatched).rejects.toThrow("cancelled"); expect(f.socket.connect).not.toHaveBeenCalled();
  });
  test("malformed bootstrap prevents authenticated dispatch", async () => {
    const f = fixture(); f.socket.connected(); f.socket.emit("data", generic(Buffer.from([2, 0])));
    await expect(f.request.dispatched).rejects.toThrow("invalid-bootstrap"); expect(f.socket.writes).toHaveLength(1);
  });
  test("a second control alone remains pending until timeout without retry", async () => {
    const f = fixture(); f.socket.connected(); f.socket.emit("data", pong); await f.request.dispatched;
    f.socket.emit("data", pong); f.socket.expired(); await expect(f.request.outcome).rejects.toThrow();
    expect(f.socket.writes).toHaveLength(2); expect(f.socket.destroy).toHaveBeenCalledTimes(1);
  });
  test("socket and write exceptions expose only bounded failure categories", async () => {
    const f = fixture(); f.socket.connected(); f.socket.writeError = new Error("CANARY_PASSWORD"); f.socket.emit("data", pong);
    await expect(f.request.dispatched).rejects.toThrow("CANARY_PASSWORD");
    expect(JSON.stringify(f.logs)).not.toContain("CANARY"); expect(f.socket.destroy).toHaveBeenCalledTimes(1);
    const g = fixture(); g.socket.emit("error", new Error("CANARY_ENDPOINT"));
    await expect(g.request.dispatched).rejects.toThrow("transport"); expect(JSON.stringify(g.logs)).not.toContain("CANARY");
  });
  test("production buffering counts borrowed response chunks and releases all owned storage", async () => {
    const budget = new SatanicZoneDiagnosticBufferBudget(256); const f = fixture(undefined, undefined, budget);
    f.socket.connected(); f.socket.emit("data", pong); await f.request.dispatched; f.socket.emit("data", response);
    expect(await f.request.outcome).toMatchObject({ rawZone: "Act_04_03" }); expect(budget.usedBytes).toBe(0); expect(budget.peakBytes).toBeLessThanOrEqual(256);
  });
  test("allocation failure at bootstrap or response stops without uncaught exceptions or retries", async () => {
    const small = new SatanicZoneDiagnosticBufferBudget(8); const f = fixture(undefined, undefined, small);
    expect(() => f.socket.connected()).not.toThrow(); await expect(f.request.dispatched).rejects.toThrow("byte-limit");
    expect(small.usedBytes).toBe(0); expect(f.socket.writes).toHaveLength(0);
    const budget = new SatanicZoneDiagnosticBufferBudget(256); const g = fixture(undefined, undefined, budget);
    g.socket.connected(); g.socket.emit("data", pong); await g.request.dispatched; g.socket.emit("data", Buffer.alloc(200));
    await expect(g.request.outcome).rejects.toThrow(); expect(budget.usedBytes).toBe(0); expect(budget.exceeded).toBe(true); expect(g.socket.writes).toHaveLength(2);
  });
});
