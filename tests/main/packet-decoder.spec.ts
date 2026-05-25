import { describe, expect, test } from "vitest";
import { getPayload, isLikelyParseablePayload, PacketBuffers } from "../../src/main/packet-decoder";

function tcpPacket(payloadText: string, linkType: "RAW" | "ETHERNET" | "NULL" | "LINKTYPE_LINUX_SLL" = "RAW"): Buffer {
  const payload = Buffer.from(payloadText, "utf8");
  const prefix = linkPrefix(linkType);
  const ipOffset = prefix.length;
  const tcpOffset = ipOffset + 20;
  const totalLength = 20 + 20 + payload.length;
  const packet = Buffer.concat([prefix, Buffer.alloc(totalLength)]);

  packet[ipOffset] = 0x45;
  packet.writeUInt16BE(totalLength, ipOffset + 2);
  packet[ipOffset + 8] = 64;
  packet[ipOffset + 9] = 6;
  packet.set([10, 0, 0, 1], ipOffset + 12);
  packet.set([10, 0, 0, 2], ipOffset + 16);

  packet.writeUInt16BE(1234, tcpOffset);
  packet.writeUInt16BE(26921, tcpOffset + 2);
  packet.writeUInt32BE(99, tcpOffset + 8);
  packet[tcpOffset + 12] = 0x50;
  payload.copy(packet, tcpOffset + 20);
  return packet;
}

function linkPrefix(linkType: string): Buffer {
  if (linkType === "ETHERNET") {
    const header = Buffer.alloc(14);
    header.writeUInt16BE(0x0800, 12);
    return header;
  }
  if (linkType === "NULL") return Buffer.alloc(4);
  if (linkType === "LINKTYPE_LINUX_SLL") {
    const header = Buffer.alloc(16);
    header.writeUInt16BE(0x0800, 14);
    return header;
  }
  return Buffer.alloc(0);
}

describe("packet decoder", () => {
  test("decodes TCP payloads for supported link types", () => {
    for (const linkType of ["RAW", "ETHERNET", "NULL", "LINKTYPE_LINUX_SLL"] as const) {
      const packet = tcpPacket('{"gold":100}', linkType);
      const decoded = getPayload(packet, packet.length, linkType);

      expect(decoded).toMatchObject({
        src: "10.0.0.1",
        dst: "10.0.0.2",
        srcPort: 1234,
        dstPort: 26921,
        ack: 99,
        payloadLength: Buffer.byteLength('{"gold":100}'),
        text: '{"gold":100}',
      });
    }
  });

  test("rejects unsupported or non-payload packets", () => {
    const packet = tcpPacket("{}", "RAW");
    expect(getPayload(packet, packet.length, "UNSUPPORTED")).toBeNull();
    expect(getPayload(packet.subarray(0, 40), 40, "RAW")).toBeNull();
  });

  test("buffers split payloads and flushes when ack changes", () => {
    const buffers = new PacketBuffers();
    const first = getPayload(tcpPacket("prefix ", "RAW"), tcpPacket("prefix ", "RAW").length, "RAW")!;
    const second = getPayload(tcpPacket('{"gold":100}', "RAW"), tcpPacket('{"gold":100}', "RAW").length, "RAW")!;

    first.ack = 1;
    second.ack = 2;

    expect(buffers.push(first)).toEqual([]);
    expect(buffers.push(second)).toEqual(["prefix ", '{"gold":100}']);
    expect(buffers.stats()).toEqual({ sources: 1, ackBuffers: 1, bufferedChunks: 1 });
  });

  test("screens likely parseable payload text", () => {
    expect(isLikelyParseablePayload("inventory/item_stack_handler/v1?gold=100")).toBe(true);
    expect(isLikelyParseablePayload("xx0eyJhZGRlZEl0ZW1PYmplY3QiOnt9fQ==")).toBe(true);
    expect(isLikelyParseablePayload("\u0000\u0001\u0002\u0003")).toBe(false);
  });
});
