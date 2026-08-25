import { describe, expect, test } from "vitest";
import { getPayload, isLikelyParseablePayload, PacketBuffers, type ParsedPayload } from "../../src/main/packet-decoder";
import { captureMessages, messageToEvents } from "../../src/shared/parser";

interface TcpPacketOptions {
  seq?: number;
  ack?: number;
  flags?: number;
  trailingBytes?: Buffer;
}

function tcpPacket(
  payloadValue: string | Buffer,
  linkType: "RAW" | "ETHERNET" | "NULL" | "LINKTYPE_LINUX_SLL" = "RAW",
  options: TcpPacketOptions = {},
): Buffer {
  const payload = typeof payloadValue === "string" ? Buffer.from(payloadValue, "utf8") : payloadValue;
  const prefix = linkPrefix(linkType);
  const ipOffset = prefix.length;
  const tcpOffset = ipOffset + 20;
  const totalLength = 20 + 20 + payload.length;
  const trailingBytes = options.trailingBytes ?? Buffer.alloc(0);
  const packet = Buffer.concat([prefix, Buffer.alloc(totalLength), trailingBytes]);

  packet[ipOffset] = 0x45;
  packet.writeUInt16BE(totalLength, ipOffset + 2);
  packet[ipOffset + 8] = 64;
  packet[ipOffset + 9] = 6;
  packet.set([10, 0, 0, 1], ipOffset + 12);
  packet.set([10, 0, 0, 2], ipOffset + 16);

  packet.writeUInt16BE(1234, tcpOffset);
  packet.writeUInt16BE(26921, tcpOffset + 2);
  packet.writeUInt32BE(options.seq ?? 10, tcpOffset + 4);
  packet.writeUInt32BE(options.ack ?? 99, tcpOffset + 8);
  packet[tcpOffset + 12] = 0x50;
  packet[tcpOffset + 13] = options.flags ?? 0x18;
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

function parsedPayload(payloadValue: string | Buffer, overrides: Partial<ParsedPayload> = {}): ParsedPayload {
  const payload = typeof payloadValue === "string" ? Buffer.from(payloadValue, "utf8") : payloadValue;
  return {
    src: "10.0.0.1",
    dst: "10.0.0.2",
    srcPort: 1234,
    dstPort: 26921,
    seq: 100,
    ack: 1,
    flags: 0x18,
    payloadLength: payload.length,
    payload,
    text: payload.toString("utf8"),
    ...overrides,
  };
}

function apiFrame(bodyValue: string | Buffer, token = "9db046d0b41c"): Buffer {
  return lengthPrefixedFrame(bodyValue, token);
}

function genericFrame(bodyValue: string | Buffer, token = "7e96"): Buffer {
  return lengthPrefixedFrame(bodyValue, token);
}

function lengthPrefixedFrame(bodyValue: string | Buffer, token: string): Buffer {
  const body = typeof bodyValue === "string" ? Buffer.from(bodyValue, "utf8") : bodyValue;
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from(token, "ascii"), header, body]);
}

describe("packet decoder", () => {
  test("decodes bounded TCP payloads and transport metadata for supported link types", () => {
    for (const linkType of ["RAW", "ETHERNET", "NULL", "LINKTYPE_LINUX_SLL"] as const) {
      const packet = tcpPacket('{"gold":100}', linkType, { seq: 41, ack: 99, trailingBytes: Buffer.from("ignored") });
      const decoded = getPayload(packet, packet.length, linkType);

      expect(decoded).toMatchObject({
        src: "10.0.0.1",
        dst: "10.0.0.2",
        srcPort: 1234,
        dstPort: 26921,
        seq: 41,
        ack: 99,
        flags: 0x18,
        payloadLength: Buffer.byteLength('{"gold":100}'),
        text: '{"gold":100}',
      });
      expect(decoded?.payload).toEqual(Buffer.from('{"gold":100}'));
    }
  });

  test("rejects unsupported, fragmented, or non-payload packets", () => {
    const packet = tcpPacket("{}", "RAW");
    expect(getPayload(packet, packet.length, "UNSUPPORTED")).toBeNull();
    expect(getPayload(packet.subarray(0, 40), 40, "RAW")).toBeNull();
    expect(getPayload(packet, packet.length - 1, "RAW")).toBeNull();
    packet.writeUInt16BE(0x2000, 6);
    expect(getPayload(packet, packet.length, "RAW")).toBeNull();
  });

  test("reassembles a split JSON frame by TCP sequence instead of ACK", () => {
    const buffers = new PacketBuffers();
    const first = parsedPayload('{"gold":', { seq: 100, ack: 1, flags: 0x10 });
    const second = parsedPayload(Buffer.from("100}\0"), { seq: 108, ack: 2 });

    expect(buffers.push(first)).toEqual([]);
    expect(buffers.push(second).map((payload) => payload.text)).toEqual(['{"gold":100}']);
    expect(buffers.stats()).toEqual({ streams: 1, pendingSegments: 0, bufferedBytes: 0 });
  });

  test("orders gapped segments and ignores retransmitted bytes", () => {
    const buffers = new PacketBuffers();
    const first = parsedPayload('{"message":', { seq: 100, flags: 0x10 });
    const middle = parsedPayload('"ok","gold":', { seq: 111, flags: 0x10 });
    const last = parsedPayload(Buffer.from("100}\0"), { seq: 123 });

    expect(buffers.push(first)).toEqual([]);
    expect(buffers.push(last)).toEqual([]);
    expect(buffers.push(first)).toEqual([]);
    expect(buffers.push(middle).map((payload) => payload.text)).toEqual(['{"message":"ok","gold":100}']);
  });

  test("prepends an earlier segment when capture first observes the middle of a frame", () => {
    const buffers = new PacketBuffers();
    const first = parsedPayload('{"message":', { seq: 100, flags: 0x10 });
    const middle = parsedPayload('"ok","gold":', { seq: 111, flags: 0x10 });
    const last = parsedPayload(Buffer.from("100}\0"), { seq: 123 });

    expect(buffers.push(middle)).toEqual([]);
    expect(buffers.push(first)).toEqual([]);
    expect(buffers.push(last).map((payload) => payload.text)).toEqual(['{"message":"ok","gold":100}']);
  });

  test("resets stale sequence state when a directional flow is reused after an idle period", () => {
    const buffers = new PacketBuffers();

    expect(buffers.push(parsedPayload('{"gold":', { seq: 100, flags: 0x10 }), 1000)).toEqual([]);
    expect(buffers.push(parsedPayload(Buffer.from('{"gold":200}\0'), { seq: 50_000 }), 31_001).map((payload) => payload.text)).toEqual([
      '{"gold":200}',
    ]);
  });

  test("drops a stream when queued gap bytes exceed the total buffer bound", () => {
    const buffers = new PacketBuffers();
    const largeSegment = Buffer.alloc(600_000, 0x61);

    expect(buffers.push(parsedPayload("{", { seq: 100, flags: 0x10 }))).toEqual([]);
    expect(buffers.push(parsedPayload(largeSegment, { seq: 1000, flags: 0x10 }))).toEqual([]);
    expect(buffers.push(parsedPayload(largeSegment, { seq: 700_000, flags: 0x10 }))).toEqual([]);
    expect(buffers.stats()).toEqual({ streams: 0, pendingSegments: 0, bufferedBytes: 0 });
  });

  test("keeps separate application frames even when their ACK is unchanged", () => {
    const buffers = new PacketBuffers();
    const request = Buffer.from("inventory/item_generate/v1 account_id=1&item_data=test\0");
    const response = Buffer.from('{"message":"ok","itemGenHash":"abc","itemData":{"id":1}}\0');

    expect(buffers.push(parsedPayload(request, { seq: 100, ack: 77 })).map((payload) => payload.text)).toEqual([
      "inventory/item_generate/v1 account_id=1&item_data=test",
    ]);
    expect(buffers.push(parsedPayload(response, { seq: 100 + request.length, ack: 77 })).map((payload) => payload.text)).toEqual([
      '{"message":"ok","itemGenHash":"abc","itemData":{"id":1}}',
    ]);
  });

  test("keeps the starting sequence metadata for coalesced application frames", () => {
    const buffers = new PacketBuffers();
    const first = '{"gold":1}';
    const second = '{"gold":2}';
    const completed = buffers.push(parsedPayload(Buffer.from(`${first}\0${second}\0`), { seq: 500 }));

    expect(completed.map((payload) => payload.packet.seq)).toEqual([500, 500 + Buffer.byteLength(first) + 1]);
  });

  test("does not emit split query or save frames until their terminator arrives", () => {
    const buffers = new PacketBuffers();
    const queryStart = "inventory/item_generate/v1 account_id=1&item_data={";
    const queryEnd = Buffer.from('"id":1}\0');
    expect(buffers.push(parsedPayload(queryStart, { seq: 100 }))).toEqual([]);
    expect(buffers.push(parsedPayload(queryEnd, { seq: 100 + Buffer.byteLength(queryStart) })).map((payload) => payload.text)).toEqual([
      'inventory/item_generate/v1 account_id=1&item_data={"id":1}',
    ]);

    const saveBuffers = new PacketBuffers();
    const save = 'save account_id=1&snapshot={"experience":5000,"inventory":{"a":1}}\0';
    const firstLength = 22;
    const secondLength = 47;
    expect(saveBuffers.push(parsedPayload(save.slice(0, firstLength), { seq: 1000, flags: 0x10 }))).toEqual([]);
    expect(saveBuffers.push(parsedPayload(save.slice(secondLength), { seq: 1000 + secondLength }))).toEqual([]);
    expect(
      saveBuffers.push(parsedPayload(save.slice(firstLength, secondLength), { seq: 1000 + firstLength, flags: 0x10 })).map((payload) => payload.text),
    ).toEqual([save.slice(0, -1)]);
  });

  test("rejoins command and query frames separated by a protocol NUL", () => {
    const buffers = new PacketBuffers();
    const command = Buffer.from("inventory/item_generate/v1\0");
    const query = Buffer.from("account_id=1&item_data=test&season=10\0");

    expect(buffers.push(parsedPayload(command, { seq: 100 }))).toEqual([]);
    expect(buffers.push(parsedPayload(query, { seq: 100 + command.length })).map((payload) => payload.text)).toEqual([
      "inventory/item_generate/v1 account_id=1&item_data=test&season=10",
    ]);
  });

  test("reassembles a multi-packet save body after its command frame", () => {
    const buffers = new PacketBuffers();
    const command = Buffer.from("save\0");
    const firstBody = 'account_id=1&slot_data={"name":"Dante","experience":100,';
    const secondBody = Buffer.from('"statisticTotalMonsterKills":25,"season":10,"hardcore":0}&beta=0\0');

    expect(buffers.push(parsedPayload(command, { seq: 1000 }))).toEqual([]);
    expect(buffers.push(parsedPayload(firstBody, { seq: 1000 + command.length, flags: 0x10 }))).toEqual([]);
    expect(
      buffers
        .push(parsedPayload(secondBody, { seq: 1000 + command.length + Buffer.byteLength(firstBody) }))
        .map((payload) => payload.text),
    ).toEqual([
      'save account_id=1&slot_data={"name":"Dante","experience":100,"statisticTotalMonsterKills":25,"season":10,"hardcore":0}&beta=0',
    ]);
  });

  test("reassembles the current length-prefixed save frame without treating header NULs as delimiters", () => {
    const buffers = new PacketBuffers();
    const slotData = JSON.stringify({
      name: "Dante",
      experience: 424534,
      statisticTotalMonsterKills: 72532,
      season: 11,
      hardcore: 0,
      inventorySnapshot: "x".repeat(4_400),
    });
    const body = Buffer.from(
      `\0\0save\0R\0account_id=1&slot_data=${slotData}&beta=0\0`,
    );
    const frame = apiFrame(body);
    const segmentLengths = [1_380, 1_460, 1_460];
    let offset = 0;
    for (const segmentLength of segmentLengths) {
      expect(buffers.push(parsedPayload(frame.subarray(offset, offset + segmentLength), {
        seq: 4_000 + offset,
        flags: 0x10,
      }))).toEqual([]);
      offset += segmentLength;
    }
    const completed = buffers.push(parsedPayload(frame.subarray(offset), { seq: 4_000 + offset }));
    expect(completed).toHaveLength(1);
    expect(completed[0].text).toBe(`save R account_id=1&slot_data=${slotData}&beta=0`);
    expect(messageToEvents(captureMessages(completed[0].text))).toMatchObject([
      {
        name: "updateAccount",
        value: {
          name: "Dante",
          experience: 424534,
          totalMonsterKills: 72532,
          season: 11,
          hardcore: 0,
          seasonMode: "GSS",
        },
      },
    ]);
    expect(buffers.stats()).toEqual({ streams: 1, pendingSegments: 0, bufferedBytes: 0 });
  });

  test("decodes coalesced API and generic length-prefixed frames on one stream", () => {
    const buffers = new PacketBuffers();
    const request = apiFrame("\0\0satanic_zone_get\0R\0unique_account_id=1234567&crossregion_identifier=12345678901\0");
    const response = genericFrame('\0\0{"currencyData":{"GSS":10166}}\0');
    const completed = buffers.push(parsedPayload(Buffer.concat([request, response]), { seq: 8_000 }));

    expect(completed.map((payload) => payload.text)).toEqual([
      "satanic_zone_get R unique_account_id=1234567&crossregion_identifier=12345678901",
      '{"currencyData":{"GSS":10166}}',
    ]);
    expect(completed.map((payload) => payload.packet.seq)).toEqual([8_000, 8_000 + request.length]);
    expect(messageToEvents(captureMessages(completed[0].text))).toEqual([]);
    expect(messageToEvents(captureMessages(completed[1].text))).toHaveLength(1);
  });

  test("keeps ordinary current API routes that include the protocol marker", () => {
    const buffers = new PacketBuffers();
    const request = apiFrame(
      "\0\0mailbox/mailbox_check_new\0R\0account_id=1&unique_account_id=2&crossregion_identifier=3&season=11\0",
    );

    expect(buffers.push(parsedPayload(request, { seq: 9_000 })).map((payload) => payload.text)).toEqual([
      "mailbox/mailbox_check_new R account_id=1&unique_account_id=2&crossregion_identifier=3&season=11",
    ]);
  });

  test("emits complete standalone JSON on PSH when no delimiter is present", () => {
    const buffers = new PacketBuffers();
    expect(buffers.push(parsedPayload('{"gold":100}', { seq: 1, flags: 0x18 })).map((payload) => payload.text)).toEqual(['{"gold":100}']);
  });

  test("screens likely parseable payload text", () => {
    expect(isLikelyParseablePayload("inventory/item_stack_handler/v1?gold=100")).toBe(true);
    expect(isLikelyParseablePayload("xx0eyJhZGRlZEl0ZW1PYmplY3QiOnt9fQ==")).toBe(true);
    expect(isLikelyParseablePayload("\u0000\u0001\u0002\u0003")).toBe(false);
  });
});
