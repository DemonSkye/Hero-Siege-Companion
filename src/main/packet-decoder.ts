export interface ParsedPayload {
  src: string;
  dst: string;
  srcPort: number;
  dstPort: number;
  seq: number;
  ack: number | undefined;
  flags: number;
  payloadLength: number;
  payload: Buffer;
  text: string;
}

export interface CompletedPayload {
  packet: ParsedPayload;
  text: string;
}

const IPV4_PROTOCOL_TCP = 6;
const ETHERNET_IPV4_ETHER_TYPE = 0x0800;
const TCP_FLAG_SYN = 0x02;
const TCP_FLAG_PSH = 0x08;
const MAX_STREAMS = 128;
const MAX_STREAM_BUFFER_BYTES = 1_000_000;
const MAX_PENDING_SEGMENTS = 256;
const MAX_STREAM_IDLE_MS = 30_000;
const API_TOKEN_BYTES = 12;
const API_HEADER_BYTES = API_TOKEN_BYTES + 4;
const GENERIC_PREFIX_BYTES = 4;
const GENERIC_HEADER_BYTES = GENERIC_PREFIX_BYTES + 4;
const MAX_LENGTH_PREFIXED_BODY_BYTES = 64 * 1024;

type ApplicationFraming = "unknown" | "length-prefixed" | "legacy";

interface PendingSegment {
  packet: ParsedPayload;
  sequence: number;
  payload: Buffer;
}

interface BufferedTcpStream {
  nextSequence: number;
  frameStartSequence: number;
  frameBuffer: Buffer;
  framePacket: ParsedPayload;
  pendingCommandFrame: CompletedPayload | null;
  tentativeFrameSequence: number | null;
  applicationFraming: ApplicationFraming;
  allowInitialPrepend: boolean;
  pending: Map<number, PendingSegment>;
  lastSeenAt: number;
}

export class PacketBuffers {
  private readonly streams = new Map<string, BufferedTcpStream>();

  push(packet: ParsedPayload, now = Date.now()): CompletedPayload[] {
    const sourceKey = directionalFlowKey(packet);
    const sequence = payloadSequence(packet);
    let stream = this.streams.get(sourceKey);
    if (stream && now - stream.lastSeenAt > MAX_STREAM_IDLE_MS) {
      this.streams.delete(sourceKey);
      stream = undefined;
    }
    if (!stream) {
      stream = {
        nextSequence: sequence,
        frameStartSequence: sequence,
        frameBuffer: Buffer.alloc(0),
        framePacket: packetAtSequence(packet, sequence),
        pendingCommandFrame: null,
        tentativeFrameSequence: null,
        applicationFraming: "unknown",
        allowInitialPrepend: true,
        pending: new Map(),
        lastSeenAt: now,
      };
      this.streams.set(sourceKey, stream);
      this.pruneStreams();
    }

    stream.lastSeenAt = now;
    this.acceptSegment(stream, { packet, sequence, payload: packet.payload });
    this.drainPendingSegments(stream);
    const completed = drainApplicationFrames(stream, packet);
    if (streamBufferedBytes(stream) > MAX_STREAM_BUFFER_BYTES || stream.pending.size > MAX_PENDING_SEGMENTS) {
      this.streams.delete(sourceKey);
    }
    return completed;
  }

  clear(): void {
    this.streams.clear();
  }

  stats(): { streams: number; pendingSegments: number; bufferedBytes: number } {
    let pendingSegments = 0;
    let bufferedBytes = 0;
    for (const stream of this.streams.values()) {
      pendingSegments += stream.pending.size;
      bufferedBytes += streamBufferedBytes(stream);
    }
    return {
      streams: this.streams.size,
      pendingSegments,
      bufferedBytes,
    };
  }

  private acceptSegment(stream: BufferedTcpStream, segment: PendingSegment): void {
    let acceptedSegment = segment;
    if (stream.allowInitialPrepend) {
      const startDelta = sequenceDelta(segment.sequence, stream.frameStartSequence);
      const endDelta = sequenceDelta(addSequence(segment.sequence, segment.payload.length), stream.frameStartSequence);
      if (startDelta < 0 && endDelta >= 0) {
        const prefixLength = Math.min(-startDelta, segment.payload.length);
        stream.frameBuffer = Buffer.concat([segment.payload.subarray(0, prefixLength), stream.frameBuffer]);
        stream.frameStartSequence = segment.sequence;
        stream.framePacket = packetAtSequence(segment.packet, segment.sequence);
        acceptedSegment = {
          packet: segment.packet,
          sequence: addSequence(segment.sequence, prefixLength),
          payload: segment.payload.subarray(prefixLength),
        };
        if (acceptedSegment.payload.length === 0) return;
      }
    }

    const delta = sequenceDelta(acceptedSegment.sequence, stream.nextSequence);
    if (delta > 0) {
      const existing = stream.pending.get(acceptedSegment.sequence);
      if (!existing || existing.payload.length < acceptedSegment.payload.length) {
        stream.pending.set(acceptedSegment.sequence, acceptedSegment);
      }
      return;
    }

    const overlap = Math.max(-delta, 0);
    if (overlap >= acceptedSegment.payload.length) return;
    if (stream.frameBuffer.length === 0) {
      stream.frameStartSequence = addSequence(acceptedSegment.sequence, overlap);
      stream.framePacket = packetAtSequence(acceptedSegment.packet, stream.frameStartSequence);
    }
    const payload = overlap === 0 ? acceptedSegment.payload : acceptedSegment.payload.subarray(overlap);
    stream.frameBuffer = Buffer.concat([stream.frameBuffer, payload]);
    stream.nextSequence = addSequence(stream.nextSequence, payload.length);
  }

  private drainPendingSegments(stream: BufferedTcpStream): void {
    while (stream.pending.size > 0) {
      let candidate: PendingSegment | null = null;
      let candidateDelta = Number.NEGATIVE_INFINITY;
      for (const segment of stream.pending.values()) {
        const delta = sequenceDelta(segment.sequence, stream.nextSequence);
        if (delta > 0 || -delta >= segment.payload.length || delta <= candidateDelta) continue;
        candidate = segment;
        candidateDelta = delta;
      }
      if (!candidate) return;
      stream.pending.delete(candidate.sequence);
      this.acceptSegment(stream, candidate);
    }
  }

  private pruneStreams(): void {
    while (this.streams.size > MAX_STREAMS) {
      let oldestKey = "";
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, stream] of this.streams.entries()) {
        if (stream.lastSeenAt >= oldestAt) continue;
        oldestKey = key;
        oldestAt = stream.lastSeenAt;
      }
      if (!oldestKey) return;
      this.streams.delete(oldestKey);
    }
  }
}

function streamBufferedBytes(stream: BufferedTcpStream): number {
  let total = stream.frameBuffer.length + (stream.pendingCommandFrame?.packet.payloadLength ?? 0);
  for (const segment of stream.pending.values()) total += segment.payload.length;
  return total;
}

function drainApplicationFrames(stream: BufferedTcpStream, latestPacket: ParsedPayload): CompletedPayload[] {
  const completed: CompletedPayload[] = [];

  if (stream.applicationFraming === "legacy" && stream.pendingCommandFrame === null) {
    const recovery = recoverLegacyFrameBoundary(stream, latestPacket);
    if (recovery === "waiting") return completed;
    if (recovery === "recovered") stream.applicationFraming = "unknown";
  }

  if (stream.applicationFraming !== "legacy") {
    const lengthPrefixed = drainLengthPrefixedFrames(stream, latestPacket, completed);
    if (lengthPrefixed || stream.applicationFraming === "length-prefixed") return completed;
    if (shouldAwaitFramingDecision(stream.frameBuffer)) return completed;
    stream.applicationFraming = "legacy";
  }

  drainLegacyFrames(stream, latestPacket, completed);
  if (stream.frameBuffer.length === 0 && stream.pendingCommandFrame === null) {
    stream.tentativeFrameSequence = null;
    stream.applicationFraming = "unknown";
  }
  return completed;
}

function recoverLegacyFrameBoundary(
  stream: BufferedTcpStream,
  latestPacket: ParsedPayload,
): "none" | "waiting" | "recovered" {
  if (hasLegacyFrameStart(stream.frameBuffer)) {
    stream.tentativeFrameSequence = null;
    return "none";
  }

  if (stream.tentativeFrameSequence !== null) {
    const tentativeOffset = sequenceDelta(stream.tentativeFrameSequence, stream.frameStartSequence);
    if (tentativeOffset < 0 || tentativeOffset > stream.frameBuffer.length) {
      stream.tentativeFrameSequence = null;
    } else {
      const available = stream.frameBuffer.length - tentativeOffset;
      if (available < GENERIC_HEADER_BYTES) return "waiting";

      const candidate = lengthPrefixedFrameAt(stream.frameBuffer, tentativeOffset, true);
      if (isRecoverableLengthPrefixedFrame(stream.frameBuffer, tentativeOffset, candidate)) {
        stream.tentativeFrameSequence = null;
        discardFramePrefix(stream, tentativeOffset);
        return "recovered";
      }
      if (isIncompleteOpaqueGenericFrame(stream.frameBuffer, tentativeOffset, candidate)) return "waiting";
      stream.tentativeFrameSequence = null;
    }
  }

  const packetBoundaryOffset = sequenceDelta(latestPacket.seq, stream.frameStartSequence);
  if (packetBoundaryOffset > 0 && packetBoundaryOffset <= stream.frameBuffer.length) {
    const available = stream.frameBuffer.length - packetBoundaryOffset;
    if (available < GENERIC_HEADER_BYTES) {
      // Preserve a new TCP-segment boundary until an opaque generic header is
      // complete; legacy NUL draining would otherwise destroy a split header.
      stream.tentativeFrameSequence = latestPacket.seq;
      return "waiting";
    }

    const candidate = lengthPrefixedFrameAt(stream.frameBuffer, packetBoundaryOffset, true);
    if (isRecoverableLengthPrefixedFrame(stream.frameBuffer, packetBoundaryOffset, candidate)) {
      discardFramePrefix(stream, packetBoundaryOffset);
      return "recovered";
    }
    if (isIncompleteOpaqueGenericFrame(stream.frameBuffer, packetBoundaryOffset, candidate)) {
      stream.tentativeFrameSequence = latestPacket.seq;
      return "waiting";
    }
  }

  const candidate = lengthPrefixedFrameAt(stream.frameBuffer, 0);
  if (isRecoverableLengthPrefixedFrame(stream.frameBuffer, 0, candidate)) return "recovered";

  const recovered = findLengthPrefixedFrame(stream.frameBuffer);
  if (!recovered) return "none";
  discardFramePrefix(stream, recovered.offset);
  return "recovered";
}

function shouldAwaitFramingDecision(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.length >= GENERIC_HEADER_BYTES) return false;
  if (hasLegacyFrameStart(buffer)) return false;
  return !isCompleteStandaloneJson(decodeApplicationText(buffer));
}

function drainLengthPrefixedFrames(
  stream: BufferedTcpStream,
  latestPacket: ParsedPayload,
  completed: CompletedPayload[],
): boolean {
  let handledLengthPrefixedData = false;

  while (stream.frameBuffer.length > 0) {
    let candidate = lengthPrefixedFrameAt(stream.frameBuffer, 0);
    if (
      stream.applicationFraming === "unknown" &&
      candidate.kind === "incomplete" &&
      candidate.headerLength === undefined
    ) {
      // A partial prefix is not enough to establish framing. Keep the bytes
      // until the generic/API header is complete without locking the stream.
      return true;
    }
    const candidateIsIncomplete = candidate.kind === "incomplete";
    if (
      stream.applicationFraming === "unknown" &&
      isOpaqueGenericFrame(stream.frameBuffer, 0, candidate) &&
      !isRecoverableLengthPrefixedFrame(stream.frameBuffer, 0, candidate)
    ) {
      // Capture can begin in the middle of an established flow after Npcap is
      // reopened. Arbitrary body bytes may contain a plausible little-endian
      // length, so an opaque prefix is tentative until its complete body proves
      // that it starts with a supported application frame. Prefer a later exact
      // TCP-segment boundary when it contains a validated fresh frame.
      const recovery = recoverLegacyFrameBoundary(stream, latestPacket);
      if (recovery === "recovered") continue;
      if (recovery === "waiting" || candidateIsIncomplete) return true;
      candidate = { kind: "invalid" };
    }
    if (candidate.kind === "invalid") {
      if (stream.applicationFraming === "unknown" && hasLegacyFrameStart(stream.frameBuffer)) {
        return handledLengthPrefixedData;
      }

      const recovered = findLengthPrefixedFrame(stream.frameBuffer);
      if (!recovered) {
        if (stream.applicationFraming === "unknown") return handledLengthPrefixedData;
        retainPossibleLengthPrefixedHeader(stream);
        return true;
      }
      discardFramePrefix(stream, recovered.offset);
      candidate = recovered.candidate;
    }

    if (candidate.kind === "incomplete") {
      stream.applicationFraming = "length-prefixed";
      return true;
    }

    if (candidate.kind !== "complete") return handledLengthPrefixedData;
    stream.applicationFraming = "length-prefixed";
    handledLengthPrefixedData = true;
    const rawFrame = stream.frameBuffer.subarray(0, candidate.frameLength);
    const body = rawFrame.subarray(candidate.headerLength);
    const text = decodeLengthPrefixedBody(body);
    if (hasApplicationFrameStart(text)) {
      completed.push(completedPayload(stream.framePacket, body, text));
    }
    consumeFrameBytes(stream, candidate.frameLength);
  }

  return handledLengthPrefixedData;
}

type LengthPrefixedFrameCandidate =
  | { kind: "invalid" }
  | { kind: "incomplete"; headerLength?: number; frameLength?: number }
  | { kind: "complete"; headerLength: number; frameLength: number };

function lengthPrefixedFrameAt(
  buffer: Buffer,
  offset: number,
  allowOpaqueGenericPrefix = offset === 0,
): LengthPrefixedFrameCandidate {
  const available = buffer.length - offset;
  if (available <= 0) return { kind: "incomplete" };

  if (available < GENERIC_HEADER_BYTES) {
    const partialPrefix = buffer.subarray(offset, offset + Math.min(available, GENERIC_PREFIX_BYTES));
    return isHexAscii(partialPrefix) || (allowOpaqueGenericPrefix && hasBinaryBytes(partialPrefix))
      ? { kind: "incomplete" }
      : { kind: "invalid" };
  }

  // Client API tokens are ASCII hex, while live server responses use an opaque
  // four-byte prefix. The bounded body length is the authoritative generic-frame
  // signal; requiring the response prefix to be hex drops every inbound event.
  const genericBodyLength = buffer.readUInt32LE(offset + GENERIC_PREFIX_BYTES);
  const genericPrefix = buffer.subarray(offset, offset + GENERIC_PREFIX_BYTES);
  if (
    isSupportedFrameBodyLength(genericBodyLength) &&
    (allowOpaqueGenericPrefix || isHexAscii(genericPrefix))
  ) {
    const frameLength = GENERIC_HEADER_BYTES + genericBodyLength;
    return available < frameLength
      ? { kind: "incomplete", headerLength: GENERIC_HEADER_BYTES, frameLength }
      : { kind: "complete", headerLength: GENERIC_HEADER_BYTES, frameLength };
  }

  const apiPrefixLength = Math.min(available, API_TOKEN_BYTES);
  if (!isHexAscii(buffer.subarray(offset, offset + apiPrefixLength))) return { kind: "invalid" };
  if (available < API_HEADER_BYTES) return { kind: "incomplete" };

  const apiBodyLength = buffer.readUInt32LE(offset + API_TOKEN_BYTES);
  if (!isSupportedFrameBodyLength(apiBodyLength)) return { kind: "invalid" };
  const frameLength = API_HEADER_BYTES + apiBodyLength;
  return available < frameLength
    ? { kind: "incomplete", headerLength: API_HEADER_BYTES, frameLength }
    : { kind: "complete", headerLength: API_HEADER_BYTES, frameLength };
}

function findLengthPrefixedFrame(
  buffer: Buffer,
): { offset: number; candidate: Extract<LengthPrefixedFrameCandidate, { kind: "complete" | "incomplete" }> } | null {
  for (let offset = 1; offset < buffer.length; offset += 1) {
    const candidate = lengthPrefixedFrameAt(buffer, offset, false);
    if (candidate.kind === "complete" || (candidate.kind === "incomplete" && candidate.frameLength !== undefined)) {
      return { offset, candidate };
    }

    const opaqueCandidate = lengthPrefixedFrameAt(buffer, offset, true);
    if (isRecoverableLengthPrefixedFrame(buffer, offset, opaqueCandidate)) {
      return { offset, candidate: opaqueCandidate };
    }
  }
  return null;
}

function isOpaqueGenericFrame(
  buffer: Buffer,
  offset: number,
  candidate: LengthPrefixedFrameCandidate,
): boolean {
  if (candidate.kind === "invalid" || candidate.headerLength !== GENERIC_HEADER_BYTES) return false;
  return !isHexAscii(buffer.subarray(offset, offset + GENERIC_PREFIX_BYTES));
}

function isIncompleteOpaqueGenericFrame(
  buffer: Buffer,
  offset: number,
  candidate: LengthPrefixedFrameCandidate,
): boolean {
  return candidate.kind === "incomplete" && isOpaqueGenericFrame(buffer, offset, candidate);
}

function isRecoverableLengthPrefixedFrame(
  buffer: Buffer,
  offset: number,
  candidate: LengthPrefixedFrameCandidate,
): candidate is Extract<LengthPrefixedFrameCandidate, { kind: "complete" | "incomplete" }> {
  if (candidate.kind === "invalid" || candidate.frameLength === undefined || candidate.headerLength === undefined) {
    return false;
  }
  if (candidate.headerLength === API_HEADER_BYTES) return true;

  const genericPrefix = buffer.subarray(offset, offset + GENERIC_PREFIX_BYTES);
  if (isHexAscii(genericPrefix)) return true;
  if (candidate.kind !== "complete") return false;

  const bodyStart = offset + candidate.headerLength;
  const body = buffer.subarray(bodyStart, offset + candidate.frameLength);
  const text = decodeLengthPrefixedBody(body);
  return hasApplicationFrameStart(text) || /^[\u0000-\u0020]*[01]\|[a-f0-9]{16,}$/i.test(text);
}

function retainPossibleLengthPrefixedHeader(stream: BufferedTcpStream): void {
  const keepBytes = Math.min(stream.frameBuffer.length, API_HEADER_BYTES - 1);
  discardFramePrefix(stream, stream.frameBuffer.length - keepBytes);
}

function discardFramePrefix(stream: BufferedTcpStream, byteLength: number): void {
  if (byteLength <= 0) return;
  consumeFrameBytes(stream, Math.min(byteLength, stream.frameBuffer.length));
  stream.allowInitialPrepend = false;
}

function consumeFrameBytes(stream: BufferedTcpStream, byteLength: number): void {
  stream.frameBuffer = stream.frameBuffer.subarray(byteLength);
  stream.frameStartSequence = addSequence(stream.frameStartSequence, byteLength);
  stream.framePacket = packetAtSequence(stream.framePacket, stream.frameStartSequence);
  stream.allowInitialPrepend = false;
}

function isSupportedFrameBodyLength(value: number): boolean {
  return value > 0 && value <= MAX_LENGTH_PREFIXED_BODY_BYTES;
}

function isHexAscii(value: Buffer): boolean {
  if (value.length === 0) return false;
  for (const byte of value) {
    const decimal = byte >= 0x30 && byte <= 0x39;
    const lowercase = byte >= 0x61 && byte <= 0x66;
    const uppercase = byte >= 0x41 && byte <= 0x46;
    if (!decimal && !lowercase && !uppercase) return false;
  }
  return true;
}

function hasBinaryBytes(value: Buffer): boolean {
  for (const byte of value) {
    if (byte < 0x20 || byte > 0x7e) return true;
  }
  return false;
}

function hasLegacyFrameStart(buffer: Buffer): boolean {
  const firstDelimiter = buffer.indexOf(0);
  const candidate = firstDelimiter === -1 ? buffer : buffer.subarray(0, firstDelimiter);
  return hasApplicationFrameStart(decodeApplicationText(candidate));
}

function decodeLengthPrefixedBody(payload: Buffer): string {
  return payload.toString("utf8").replace(/\0+/g, " ").trim();
}

function drainLegacyFrames(
  stream: BufferedTcpStream,
  latestPacket: ParsedPayload,
  completed: CompletedPayload[],
): void {
  let delimiterOffset = stream.frameBuffer.indexOf(0);

  while (delimiterOffset !== -1) {
    const frame = stream.frameBuffer.subarray(0, delimiterOffset);
    stream.frameBuffer = stream.frameBuffer.subarray(delimiterOffset + 1);
    const text = decodeApplicationText(frame);
    if (isSplitQueryCommand(text)) {
      stream.pendingCommandFrame = completedPayload(stream.framePacket, frame, text.trim());
    } else if (stream.pendingCommandFrame && isSplitQueryBody(text)) {
      const command = stream.pendingCommandFrame;
      const queryText = text.trimStart();
      const combinedText = `${command.text} ${queryText}`;
      const combinedPayload = Buffer.concat([command.packet.payload, Buffer.from(" "), frame]);
      if (hasApplicationFrameStart(combinedText)) completed.push(completedPayload(command.packet, combinedPayload, combinedText));
      stream.pendingCommandFrame = null;
    } else {
      if (text.trim()) stream.pendingCommandFrame = null;
      if (hasApplicationFrameStart(text)) completed.push(completedPayload(stream.framePacket, frame, text));
    }
    stream.frameStartSequence = addSequence(stream.frameStartSequence, delimiterOffset + 1);
    stream.framePacket = packetAtSequence(stream.framePacket, stream.frameStartSequence);
    stream.allowInitialPrepend = false;
    delimiterOffset = stream.frameBuffer.indexOf(0);
  }

  if ((latestPacket.flags & TCP_FLAG_PSH) !== 0) {
    const text = decodeApplicationText(stream.frameBuffer);
    if (isCompleteStandaloneJson(text)) {
      completed.push(completedPayload(stream.framePacket, stream.frameBuffer, text));
      stream.frameStartSequence = addSequence(stream.frameStartSequence, stream.frameBuffer.length);
      stream.framePacket = packetAtSequence(stream.framePacket, stream.frameStartSequence);
      stream.frameBuffer = Buffer.alloc(0);
      stream.allowInitialPrepend = false;
    }
  }

}

function completedPayload(packet: ParsedPayload, payload: Buffer, text: string): CompletedPayload {
  return {
    packet: {
      ...packet,
      payloadLength: payload.length,
      payload: Buffer.from(payload),
      text,
    },
    text,
  };
}

function packetAtSequence(packet: ParsedPayload, sequence: number): ParsedPayload {
  return { ...packet, seq: sequence };
}

function decodeApplicationText(payload: Buffer): string {
  return payload.toString("utf8").replace(/\0/g, "");
}

function isSplitQueryCommand(text: string): boolean {
  const command = text.trim();
  return (
    /^(?:[a-z][a-z0-9_]*)(?:\/[a-z0-9_]+)+$/i.test(command) ||
    /^(?:save|currencies_set|satanic_zone_get)$/i.test(command)
  );
}

function isSplitQueryBody(text: string): boolean {
  const queryStart = text.search(/[a-zA-Z][a-zA-Z0-9_]*=/);
  return queryStart >= 0 && queryStart <= 8 && text.includes("&");
}

function hasApplicationFrameStart(text: string): boolean {
  if (!text) return false;
  const signal = text.match(/(?:[a-z][a-z0-9_]*(?:\/[a-z0-9_]+)+(?:\s+[A-Z])?\s+[a-z0-9_]+=|\bsatanic_zone_get[A-Z]?|\bsave\b|\[INV\])/i);
  if (signal && (signal.index ?? Number.POSITIVE_INFINITY) <= 96) return true;
  if (looksLikeSpecialProtocol(text)) return true;

  const jsonStart = firstJsonStart(text);
  if (jsonStart === -1 || jsonStart > 64) return false;
  const prefix = text.slice(0, jsonStart);
  return hasJsonFramePrefix(prefix) && balancedJsonEnd(text, jsonStart) !== -1;
}

function isCompleteStandaloneJson(text: string): boolean {
  const start = firstJsonStart(text);
  if (start === -1 || start > 64 || !hasJsonFramePrefix(text.slice(0, start))) return false;
  const end = balancedJsonEnd(text, start);
  return end !== -1 && /^[\s\u0000-\u001f]*$/.test(text.slice(end + 1));
}

function hasJsonFramePrefix(prefix: string): boolean {
  if (!/[a-z0-9_"'}\]]/i.test(prefix)) return true;
  return /^[\u0000-\u0020]*R[\u0000-\u0020]*$/.test(prefix);
}

function firstJsonStart(text: string): number {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
}

function balancedJsonEnd(text: string, start: number): number {
  const stack = [text[start]];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      const expected = stack[stack.length - 1] === "{" ? "}" : "]";
      if (char !== expected) return -1;
      stack.pop();
      if (stack.length === 0) return index;
    }
  }

  return -1;
}

function directionalFlowKey(packet: ParsedPayload): string {
  return `${packet.src}:${packet.srcPort}->${packet.dst}:${packet.dstPort}`;
}

function payloadSequence(packet: ParsedPayload): number {
  return addSequence(packet.seq, (packet.flags & TCP_FLAG_SYN) !== 0 ? 1 : 0);
}

function addSequence(sequence: number, amount: number): number {
  return (sequence + amount) >>> 0;
}

function sequenceDelta(sequence: number, reference: number): number {
  return (sequence - reference) << 0;
}

export function getPayload(buffer: Buffer, nbytes: number, linkType: string): ParsedPayload | null {
  if (!Number.isFinite(nbytes) || nbytes <= 0) return null;
  const capturedLength = Math.min(Math.trunc(nbytes), buffer.length);
  const ipOffset = ipv4OffsetForLinkType(buffer, capturedLength, linkType);
  if (ipOffset === null || ipOffset + 20 > capturedLength) return null;

  const ipHeaderLength = (buffer[ipOffset] & 0x0f) * 4;
  if (ipHeaderLength < 20 || ipOffset + ipHeaderLength > capturedLength) return null;
  if (buffer[ipOffset + 9] !== IPV4_PROTOCOL_TCP) return null;
  if ((buffer.readUInt16BE(ipOffset + 6) & 0x3fff) !== 0) return null;

  const ipTotalLength = buffer.readUInt16BE(ipOffset + 2);
  if (ipTotalLength < ipHeaderLength + 20) return null;
  const packetEnd = ipOffset + ipTotalLength;
  if (packetEnd > capturedLength) return null;

  const tcpOffset = ipOffset + ipHeaderLength;
  if (tcpOffset + 20 > packetEnd) return null;

  const tcpHeaderLength = ((buffer[tcpOffset + 12] >> 4) & 0x0f) * 4;
  if (tcpHeaderLength < 20) return null;
  const payloadOffset = tcpOffset + tcpHeaderLength;
  if (payloadOffset >= packetEnd) return null;

  const payload = Buffer.from(buffer.subarray(payloadOffset, packetEnd));
  if (payload.length === 0) return null;

  return {
    src: ipv4Address(buffer, ipOffset + 12),
    dst: ipv4Address(buffer, ipOffset + 16),
    srcPort: buffer.readUInt16BE(tcpOffset),
    dstPort: buffer.readUInt16BE(tcpOffset + 2),
    seq: buffer.readUInt32BE(tcpOffset + 4),
    ack: buffer.readUInt32BE(tcpOffset + 8),
    flags: buffer[tcpOffset + 13],
    payloadLength: payload.length,
    payload,
    text: payload.toString("utf8"),
  };
}

export function ipv4OffsetForLinkType(buffer: Buffer, nbytes: number, linkType: string): number | null {
  if (linkType === "ETHERNET") {
    const ethernetHeaderLength = 14;
    if (nbytes <= ethernetHeaderLength || buffer.readUInt16BE(12) !== ETHERNET_IPV4_ETHER_TYPE) return null;
    return ethernetHeaderLength;
  }

  if (linkType === "RAW") return isIpv4At(buffer, nbytes, 0) ? 0 : null;
  if (linkType === "NULL") return isIpv4At(buffer, nbytes, 4) ? 4 : null;

  if (linkType === "LINKTYPE_LINUX_SLL") {
    const linuxSllHeaderLength = 16;
    const protocolOffset = 14;
    if (nbytes <= linuxSllHeaderLength || buffer.readUInt16BE(protocolOffset) !== ETHERNET_IPV4_ETHER_TYPE) return null;
    return linuxSllHeaderLength;
  }

  return null;
}

export function isLikelyParseablePayload(text: string): boolean {
  if (text.length === 0) return false;
  if (hasGameTextSignal(text)) return true;
  if (printableRatio(text) < 0.6) return false;
  return /(?:[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+|[a-zA-Z0-9_]+=|\{["\w]|\[[{\w"])/.test(text) || looksLikeSpecialProtocol(text);
}

export function looksLikeSpecialProtocol(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("x") || trimmed.includes("[INV]");
}

export function printableRatio(text: string): number {
  const sample = text.slice(0, 2048);
  if (!sample) return 0;
  let printable = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) printable += 1;
  }
  return printable / sample.length;
}

function hasGameTextSignal(text: string): boolean {
  return /\b(?:mailbox|satanic_zone|save|inventory|addedItem|currency|gold|rarity)\b/i.test(text);
}

function isIpv4At(buffer: Buffer, nbytes: number, offset: number): boolean {
  return nbytes > offset && buffer[offset] >> 4 === 4;
}

function ipv4Address(buffer: Buffer, offset: number): string {
  return `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
}
