export interface ParsedPayload {
  src: string;
  dst: string;
  srcPort: number;
  dstPort: number;
  ack: number | undefined;
  payloadLength: number;
  text: string;
}

const IPV4_PROTOCOL_TCP = 6;
const ETHERNET_IPV4_ETHER_TYPE = 0x0800;

export class PacketBuffers {
  private lastAckBySource = new Map<string, string>();
  private chunksByAck = new Map<string, string[]>();

  push(packet: ParsedPayload): string[] {
    const sourceKey = `${packet.src}:${packet.srcPort}->${packet.dst}:${packet.dstPort}`;
    const ackKey = `${sourceKey}:${packet.ack ?? "noack"}`;
    const previousAck = this.lastAckBySource.get(sourceKey);
    const completed: string[] = [];

    if (!this.chunksByAck.has(ackKey)) this.chunksByAck.set(ackKey, []);
    this.chunksByAck.get(ackKey)?.push(packet.text);

    if (previousAck && previousAck !== ackKey) {
      const chunks = this.chunksByAck.get(previousAck);
      if (chunks?.length) {
        completed.push(chunks.join(""));
        this.chunksByAck.delete(previousAck);
      }
    }

    this.lastAckBySource.set(sourceKey, ackKey);

    if (packet.text.includes("{") || packet.text.includes("[") || packet.text.includes("&") || looksLikeSpecialProtocol(packet.text)) {
      completed.push(packet.text);
    }

    if (this.chunksByAck.size > 300) this.clear();
    return completed;
  }

  clear(): void {
    this.lastAckBySource.clear();
    this.chunksByAck.clear();
  }

  stats(): { sources: number; ackBuffers: number; bufferedChunks: number } {
    let bufferedChunks = 0;
    for (const chunks of this.chunksByAck.values()) bufferedChunks += chunks.length;
    return {
      sources: this.lastAckBySource.size,
      ackBuffers: this.chunksByAck.size,
      bufferedChunks,
    };
  }
}

export function getPayload(buffer: Buffer, nbytes: number, linkType: string): ParsedPayload | null {
  const ipOffset = ipv4OffsetForLinkType(buffer, nbytes, linkType);
  if (ipOffset === null || ipOffset + 20 > nbytes) return null;

  const ipHeaderLength = (buffer[ipOffset] & 0x0f) * 4;
  if (ipHeaderLength < 20 || ipOffset + ipHeaderLength > nbytes) return null;
  if (buffer[ipOffset + 9] !== IPV4_PROTOCOL_TCP) return null;

  const tcpOffset = ipOffset + ipHeaderLength;
  if (tcpOffset + 20 > nbytes) return null;

  const tcpHeaderLength = ((buffer[tcpOffset + 12] >> 4) & 0x0f) * 4;
  if (tcpHeaderLength < 20) return null;
  const payloadOffset = tcpOffset + tcpHeaderLength;
  if (payloadOffset >= nbytes) return null;

  const payload = buffer.subarray(payloadOffset, nbytes);
  if (payload.length === 0) return null;

  return {
    src: ipv4Address(buffer, ipOffset + 12),
    dst: ipv4Address(buffer, ipOffset + 16),
    srcPort: buffer.readUInt16BE(tcpOffset),
    dstPort: buffer.readUInt16BE(tcpOffset + 2),
    ack: buffer.readUInt32BE(tcpOffset + 8),
    payloadLength: payload.length,
    text: payload.toString("utf8").replace(/\0/g, ""),
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
