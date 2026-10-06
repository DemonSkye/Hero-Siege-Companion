import { describe, expect, test } from "vitest";
import { SatanicZoneDiagnosticStream, DiagnosticFrameError, type DiagnosticFrame } from "../../src/main/satanic-zone-diagnostic-stream";
import { buildDirectApiPingFrame } from "../../src/main/direct-satanic-zone-protocol";
import type { ParsedPayload } from "../../src/main/packet-decoder";
import { connectDiagnosticBody, frameDiagnosticBody, requestDiagnosticBody } from "../fixtures/satanic-zone-diagnostic-frames";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
import { genericProbeFrame, inventedZoneBody } from "../fixtures/satanic-zone-initialized";
const scope = { localAddress: "192.0.2.10", remoteAddress: "198.51.100.20", remotePort: 6669 };
function packet(outbound: boolean, seq: number, flags: number, payload: Buffer = Buffer.alloc(0)): ParsedPayload {
  return { src: outbound ? scope.localAddress : scope.remoteAddress, dst: outbound ? scope.remoteAddress : scope.localAddress,
    srcPort: outbound ? 5000 : 6669, dstPort: outbound ? 6669 : 5000, seq, ack: outbound ? 201 : 101,
    flags, payload, payloadLength: payload.length, text: "" };
}
function fixture(onFrame: (frame: DiagnosticFrame) => void = () => {}, budget?: SatanicZoneDiagnosticBufferBudget) {
  const stream = new SatanicZoneDiagnosticStream(scope, onFrame, budget);
  stream.push(packet(true, 100, 2)); stream.push(packet(false, 200, 18)); stream.attribute(); return stream;
}
describe("diagnostic stream attribution and framing", () => {
  test("passive inbound compaction erases initialization and handles more than a MiB across TCP wrap under a small shared budget", () => {
    const budget = new SatanicZoneDiagnosticBufferBudget(1024); let count = 0;
    const stream = new SatanicZoneDiagnosticStream(scope, () => { count++; }, budget);
    stream.push(packet(true, 100, 2)); stream.push(packet(false, 0xfffffff0, 18)); stream.attribute();
    stream.push(packet(true, 101, 16, frameDiagnosticBody(connectDiagnosticBody(), 7)));
    expect(budget.usedBytes).toBeGreaterThan(0); stream.continueIncoming(); expect(budget.usedBytes).toBe(0);
    count = 0;
    const frame = genericProbeFrame(Buffer.from(inventedZoneBody.toString().padEnd(180, " ")));
    let sequence = 0xfffffff1;
    for (let index = 0; index < 6000; index++) {
      stream.push(packet(false, sequence, 24, frame)); sequence = (sequence + frame.length) >>> 0;
      expect(budget.usedBytes).toBe(0);
    }
    expect(frame.length * count).toBeGreaterThan(1_048_576); expect(count).toBe(6000);
    expect(budget.peakBytes).toBeLessThanOrEqual(1024); expect(stream.complete).toBe(true);
    stream.dispose(); expect(budget.usedBytes).toBe(0);
  });

  test("passive compaction preserves partial/coalesced/out-of-order bytes and ignores consumed retransmissions", () => {
    const budget = new SatanicZoneDiagnosticBufferBudget(1024), bodies: string[] = [];
    const stream = fixture(frame => bodies.push(frame.body.toString()), budget); stream.continueIncoming();
    const frame = genericProbeFrame(inventedZoneBody);
    stream.push(packet(false, 201, 24, Buffer.concat([frame, frame.subarray(0, 9)])));
    expect(bodies).toHaveLength(1); expect(budget.usedBytes).toBe(9);
    stream.push(packet(false, 201 + frame.length + 23, 24, frame.subarray(23)));
    stream.push(packet(false, 201 + frame.length - 13, 24, Buffer.concat([frame.subarray(-13), frame.subarray(0, 23)])));
    stream.push(packet(false, 201, 24, frame));
    expect(bodies).toEqual([inventedZoneBody.toString(), inventedZoneBody.toString()]);
    expect(stream.complete).toBe(true); expect(budget.usedBytes).toBe(0); stream.dispose();
  });

  test("passive compaction still rejects conflicting unparsed bytes and frees them on disposal", () => {
    const budget = new SatanicZoneDiagnosticBufferBudget(1024), stream = fixture(() => {}, budget); stream.continueIncoming();
    const frame = genericProbeFrame(inventedZoneBody);
    stream.push(packet(false, 201, 24, Buffer.concat([frame, frame.subarray(0, 9)])));
    const conflict = Buffer.from(frame.subarray(0, 9)); conflict[8] ^= 1;
    expect(() => stream.push(packet(false, 201 + frame.length, 24, conflict))).toThrow("ambiguous-flow");
    stream.dispose(); expect(budget.usedBytes).toBe(0);
  });
  test("inbound API counters may jump or repeat while tokens and TCP order remain valid", () => {
    const counters: (number | null)[] = []; const stream = fixture(frame => counters.push(frame.counter));
    stream.push(packet(false, 201, 16, Buffer.concat([buildDirectApiPingFrame(201), buildDirectApiPingFrame(3), buildDirectApiPingFrame(3)])));
    expect(counters).toEqual([201, 3, 3]); expect(stream.complete).toBe(true); stream.dispose();
  });
  test("outbound counter gaps still fail with a fixed reason, while bad inbound tokens remain rejected", () => {
    const stream = fixture();
    let failure: unknown;
    try { stream.push(packet(true, 101, 16, Buffer.concat([buildDirectApiPingFrame(0), buildDirectApiPingFrame(2)]))); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DiagnosticFrameError);
    expect(failure).toMatchObject({ message: "invalid-frame", reason: "native-request-counter", direction: "outbound" }); stream.dispose();
    const incoming = fixture(); const invalid = buildDirectApiPingFrame(201); invalid[0] = invalid[0] === 97 ? 98 : 97;
    try { incoming.push(packet(false, 201, 16, invalid)); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ reason: "native-frame-token", direction: "inbound" }); incoming.dispose();
  });
  test("complete fragmented/coalesced frames distinguish connect shape, API families and ping", () => {
    const kinds: string[] = []; const stream = fixture((frame) => kinds.push(frame.kind));
    const bytes = Buffer.concat([frameDiagnosticBody(connectDiagnosticBody(), 0),
      frameDiagnosticBody(requestDiagnosticBody(2), 1), frameDiagnosticBody(requestDiagnosticBody(3), 2), buildDirectApiPingFrame(3)]);
    stream.push(packet(true, 101, 16, bytes.subarray(0, 25))); expect(kinds).toEqual([]);
    stream.push(packet(true, 126, 16, bytes.subarray(25))); expect(kinds).toEqual(["connect-shaped", "api-request", "region-api-request", "ping"]);
    expect(stream.complete).toBe(true); stream.dispose();
  });
  test("a complete connect-shaped body with an incomplete envelope or invalid token cannot produce a category", () => {
    const kinds: string[] = []; const stream = fixture((frame) => kinds.push(frame.kind));
    const bytes = frameDiagnosticBody(connectDiagnosticBody(), 0);
    stream.push(packet(true, 101, 16, bytes.subarray(0, -1))); expect(kinds).toEqual([]); stream.dispose();
    const invalid = fixture((frame) => kinds.push(frame.kind)); bytes[0] = bytes[0] === 97 ? 98 : 97;
    expect(() => invalid.push(packet(true, 101, 16, bytes))).toThrow("invalid-frame"); expect(kinds).toEqual([]); invalid.dispose();
  });
  test.each([8, 9, 11, 12, 15])("never treats a %s-byte API header fragment as a generic frame", (length) => {
    const kinds: string[] = []; const stream = fixture((frame) => kinds.push(frame.kind)); const bytes = buildDirectApiPingFrame();
    stream.push(packet(true, 101, 16, bytes.subarray(0, length))); expect(stream.complete).toBe(false); expect(kinds).toEqual([]);
    stream.push(packet(true, 101 + length, 16, bytes.subarray(length))); expect(kinds).toEqual(["ping"]); expect(stream.complete).toBe(true); stream.dispose();
  });
  test("rejects conflicting retransmissions and a closed stream", () => {
    const stream = fixture(); stream.push(packet(true, 101, 16, buildDirectApiPingFrame()));
    expect(() => stream.push(packet(true, 101, 16, Buffer.from([0])))).toThrow("ambiguous-flow"); stream.dispose();
    const closed = fixture(); expect(() => closed.push(packet(false, 201, 17))).toThrow("stream-gap"); closed.dispose();
  });
  test("bounds out-of-order segment metadata even for one-byte packets", () => {
    const stream = fixture(); for (let index = 0; index < 4096; index++) stream.push(packet(true, 2000 + index, 16, Buffer.from([1])));
    expect(() => stream.push(packet(true, 7000, 16, Buffer.from([1])))).toThrow("stream-gap"); stream.dispose();
  });
  test.each([false, true])("callback cancellation erases the borrowed body and does not decode later coalesced frames (passive=%s)", passive => {
    let borrowed: Buffer | null = null; let count = 0;
    const stream = fixture((frame) => { borrowed = frame.body; count++; stream.dispose(); });
    if (passive) stream.continueIncoming();
    stream.push(packet(!passive, passive ? 201 : 101, 16, Buffer.concat([buildDirectApiPingFrame(), buildDirectApiPingFrame(1)])));
    expect(count).toBe(1); expect(borrowed).toEqual(Buffer.alloc(2));
  });
});
