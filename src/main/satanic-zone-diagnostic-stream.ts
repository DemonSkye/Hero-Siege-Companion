import { createHash } from "node:crypto";
import type { DiagnosticFrameKind, DiagnosticNativeFailure } from "../shared/satanic-zone-diagnostic";
import type { ParsedPayload } from "./packet-decoder";
import { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import { classifySatanicZoneDiagnosticApiBody } from "./satanic-zone-diagnostic-frame-kind";

export interface DiagnosticCaptureScope {
  localAddress: string;
  remoteAddress: string;
  remotePort: number;
}
/** A startup listener has no remote endpoint until a fresh SYN selects it. */
export type SatanicZoneListenScope = Pick<DiagnosticCaptureScope, "localAddress"> & Partial<DiagnosticCaptureScope>;
export interface DiagnosticFrame {
  outbound: boolean;
  kind: DiagnosticFrameKind;
  counter: number | null;
  body: Buffer;
}
export type DiagnosticStreamFailure = "stream-gap" | "invalid-frame" | "ambiguous-flow";
const MAX_SEGMENTS = 4096;

export class DiagnosticFrameError extends Error {
  constructor(readonly reason: Extract<DiagnosticNativeFailure, "native-frame-length" | "native-frame-token" | "native-request-counter">,
    readonly direction: "outbound" | "inbound") { super("invalid-frame"); }
}

function counterForFrame(token: Buffer, body: Buffer, budget: SatanicZoneDiagnosticBufferBudget): number | null {
  let found: number | null = null;
  const counterByte = budget.allocate(1);
  try {
    for (let counter = 0; counter < 256; counter++) {
      counterByte[0] = counter;
      const value = createHash("md5").update(body).update(counterByte).digest("hex").slice(0, 12);
      if (value !== token.toString("ascii").toLowerCase()) continue;
      if (found !== null) return null;
      found = counter;
    }
  } finally { budget.release(counterByte); }
  return found;
}

class OrderedDiagnosticBytes {
  private bytes: Buffer = Buffer.alloc(0);
  private parsed = 0;
  private pending: { offset: number; bytes: Buffer }[] = [];
  private lastCounter: number | null = null;
  private disposed = false;
  private compactCompletedFrames = false;

  constructor(private firstSequence: number, private readonly outbound: boolean,
    private readonly onFrame: (frame: DiagnosticFrame) => void, private readonly budget: SatanicZoneDiagnosticBufferBudget) {}

  push(sequence: number, bytes: Buffer): void {
    if (this.disposed) return;
    let offset = (sequence - this.firstSequence) | 0;
    if (offset < 0) {
      if (!this.compactCompletedFrames) throw new Error("stream-gap" satisfies DiagnosticStreamFailure);
      // Completed passive bytes have been erased. Ignore old retransmissions;
      // a segment spanning the current boundary contributes only its new tail.
      if (offset + bytes.length <= 0) return;
      bytes = bytes.subarray(-offset); offset = 0;
    }
    if (offset > this.bytes.length) {
      if (this.pending.length >= MAX_SEGMENTS) throw new Error("stream-gap" satisfies DiagnosticStreamFailure);
      this.pending.push({ offset, bytes: this.budget.copy(bytes) });
      return;
    }
    this.append(offset, bytes);
    while (true) {
      const index = this.pending.findIndex((segment) => segment.offset <= this.bytes.length);
      if (index < 0) break;
      const [segment] = this.pending.splice(index, 1);
      try { this.append(segment.offset, segment.bytes); } finally { this.budget.release(segment.bytes); }
    }
    this.drain();
    if (this.compactCompletedFrames) this.eraseCompletedFrames();
  }

  get complete(): boolean { return this.pending.length === 0 && this.parsed === this.bytes.length; }

  continueWithoutHistory(): void {
    this.compactCompletedFrames = true; this.eraseCompletedFrames();
  }

  private eraseCompletedFrames(): void {
    if (this.disposed || !this.parsed) return;
    const consumed = this.parsed, previous = this.bytes;
    this.bytes = consumed === previous.length ? Buffer.alloc(0) : this.budget.copy(previous.subarray(consumed));
    this.parsed = 0; this.firstSequence = (this.firstSequence + consumed) >>> 0;
    for (const segment of this.pending) segment.offset -= consumed;
    this.budget.release(previous);
  }

  dispose(): void {
    this.disposed = true;
    this.budget.release(this.bytes);
    for (const segment of this.pending) this.budget.release(segment.bytes);
    this.bytes = Buffer.alloc(0);
    this.pending = [];
  }

  private append(offset: number, bytes: Buffer): void {
    const overlap = Math.min(this.bytes.length - offset, bytes.length);
    if (overlap && !this.bytes.subarray(offset, offset + overlap).equals(bytes.subarray(0, overlap))) {
      throw new Error("ambiguous-flow" satisfies DiagnosticStreamFailure);
    }
    if (overlap === bytes.length) return;
    const previous = this.bytes;
    this.bytes = this.budget.concat([previous, bytes.subarray(overlap)]);
    this.budget.release(previous);
  }

  private drain(): void {
    while (!this.disposed && this.bytes.length - this.parsed >= 8) {
      const remaining = this.bytes.subarray(this.parsed);
      // A fragmented API token is not an eight-byte generic header.
      if (remaining.length < 16 && /^[a-f0-9]+$/i.test(remaining.subarray(0, Math.min(12, remaining.length)).toString("ascii"))) return;
      const api = remaining.length >= 12 && /^[a-f0-9]{12}$/i.test(remaining.subarray(0, 12).toString("ascii"));
      const header = api ? 16 : 8;
      if (remaining.length < header) return;
      const length = remaining.readUInt32LE(api ? 12 : 4);
      const direction = this.outbound ? "outbound" : "inbound";
      if (length > 1_048_576) throw new DiagnosticFrameError("native-frame-length", direction);
      if (remaining.length < header + length) return;
      const body = remaining.subarray(header, header + length);
      const counter = api ? counterForFrame(remaining.subarray(0, 12), body, this.budget) : null;
      if (api && counter === null) throw new DiagnosticFrameError("native-frame-token", direction);
      // Native outbound application counters are continuous. Server response
      // ordering is not established; the working SZ response parser permits
      // independent counters. Keep token validation without imposing that order.
      if (api && this.outbound && this.lastCounter !== null && counter !== ((this.lastCounter + 1) & 255)) {
        throw new DiagnosticFrameError("native-request-counter", direction);
      }
      if (api) this.lastCounter = counter;
      const kind: DiagnosticFrameKind = api ? classifySatanicZoneDiagnosticApiBody(body, this.outbound) : "generic";
      this.parsed += header + length;
      // Copies are short lived; the caller must erase any retained body on cleanup.
      const frameBody = this.budget.copy(body);
      try { this.onFrame({ outbound: this.outbound, kind, counter, body: frameBody }); }
      finally { this.budget.release(frameBody); }
    }
  }
}

/** One fresh TCP handshake and its contiguous native initialization, in RAM only. */
export class SatanicZoneDiagnosticStream {
  private localPort: number | null = null;
  private clientSyn: number | null = null;
  private serverSyn: number | null = null;
  private outgoing: OrderedDiagnosticBytes | null = null;
  private incoming: OrderedDiagnosticBytes | null = null;
  private attributed = false;
  private queued: ParsedPayload[] = [];
  private disposed = false;
  private incomingOnly = false;

  constructor(readonly scope: DiagnosticCaptureScope, private readonly onFrame: (frame: DiagnosticFrame) => void,
    private readonly budget = new SatanicZoneDiagnosticBufferBudget()) {}

  get port(): number | null { return this.localPort; }
  get freshSyn(): boolean { return this.clientSyn !== null; }
  get observesBothDirections(): boolean { return !this.disposed && !this.incomingOnly && Boolean(this.outgoing && this.incoming); }
  get complete(): boolean {
    return this.attributed && this.queued.length === 0 && this.clientSyn !== null && this.serverSyn !== null
      && Boolean((this.incomingOnly || this.outgoing?.complete) && this.incoming?.complete);
  }
  /** After native initialization, current account/mode evidence comes from outbound frames. */
  get outboundComplete(): boolean {
    return this.attributed && this.queued.length === 0 && this.clientSyn !== null && this.serverSyn !== null
      && Boolean(this.outgoing?.complete);
  }

  /** After Ready, keep only bounded unparsed inbound bytes for passive updates. */
  continueIncoming(): void {
    this.incomingOnly = true;
    this.outgoing?.dispose(); this.outgoing = null;
    this.incoming?.continueWithoutHistory();
  }
  /** Product Ready still observes identity-bearing outbound frames and erases history. */
  continueBothDirections(): void {
    this.outgoing?.continueWithoutHistory(); this.incoming?.continueWithoutHistory();
  }

  matches(packet: ParsedPayload): boolean {
    const outgoing = packet.src === this.scope.localAddress && packet.dst === this.scope.remoteAddress
      && packet.dstPort === this.scope.remotePort;
    const incoming = packet.dst === this.scope.localAddress && packet.src === this.scope.remoteAddress
      && packet.srcPort === this.scope.remotePort;
    return outgoing || incoming;
  }

  push(packet: ParsedPayload): void {
    if (this.disposed || !this.matches(packet)) return;
    const outbound = packet.src === this.scope.localAddress;
    if (this.incomingOnly && outbound) return;
    const port = outbound ? packet.srcPort : packet.dstPort;
    const syn = (packet.flags & 2) !== 0;
    const ack = (packet.flags & 16) !== 0;
    if (outbound && syn && !ack) {
      if (packet.payload.length) throw new Error("invalid-frame" satisfies DiagnosticStreamFailure);
      if (this.localPort !== null && (port !== this.localPort || packet.seq !== this.clientSyn)) {
        throw new Error("ambiguous-flow" satisfies DiagnosticStreamFailure);
      }
      if (this.localPort === null) {
        this.localPort = port;
        this.clientSyn = packet.seq;
        this.outgoing = new OrderedDiagnosticBytes((packet.seq + 1) >>> 0, true, this.onFrame, this.budget);
      }
      return;
    }
    if (port !== this.localPort || this.clientSyn === null) return;
    if ((packet.flags & 5) !== 0) throw new Error("stream-gap" satisfies DiagnosticStreamFailure);
    if (!outbound && syn && ack) {
      if (packet.payload.length) throw new Error("invalid-frame" satisfies DiagnosticStreamFailure);
      if (packet.ack !== ((this.clientSyn + 1) >>> 0)
        || (this.serverSyn !== null && this.serverSyn !== packet.seq)) {
        throw new Error("ambiguous-flow" satisfies DiagnosticStreamFailure);
      }
      if (this.serverSyn === null) {
        this.serverSyn = packet.seq;
        this.incoming = new OrderedDiagnosticBytes((packet.seq + 1) >>> 0, false, this.onFrame, this.budget);
      }
      this.flush();
      return;
    }
    if (!packet.payload.length) return;
    if (this.queued.length >= MAX_SEGMENTS) throw new Error("stream-gap" satisfies DiagnosticStreamFailure);
    const copy = { ...packet, payload: this.budget.copy(packet.payload), text: "" };
    this.queued.push(copy);
    this.flush();
  }

  attribute(): void { this.attributed = true; this.flush(); }

  dispose(): void {
    this.disposed = true;
    this.outgoing?.dispose(); this.incoming?.dispose();
    for (const packet of this.queued) this.budget.release(packet.payload);
    this.queued = [];
  }

  private flush(): void {
    if (!this.attributed || this.serverSyn === null) return;
    while (!this.disposed && this.queued.length) {
      const packet = this.queued.shift()!;
      try {
        const stream = packet.src === this.scope.localAddress ? this.outgoing : this.incoming;
        stream?.push(packet.seq, packet.payload);
      } finally { this.budget.release(packet.payload); }
    }
  }
}
