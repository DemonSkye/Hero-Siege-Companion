import { describe, expect, test } from "vitest";
import { getPayload, isLikelyParseablePayload, PacketBuffers, type ParsedPayload } from "../../src/main/packet-decoder";
import { captureMessages, messageToEvents } from "../../src/shared/parser";
import { StatsEngine } from "../../src/shared/stats";

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

function opaqueGenericFrame(
  bodyValue: string | Buffer,
  prefix = Buffer.from([0x81, 0x92, 0xa3, 0xb4]),
): Buffer {
  const body = typeof bodyValue === "string" ? Buffer.from(bodyValue, "utf8") : bodyValue;
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([prefix, header, body]);
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

  test("decodes the live inbound response envelope with an opaque four-byte prefix", () => {
    const responseJson = JSON.stringify({
      status: "1",
      message: "success",
      satanicZoneName: "Act_06_02",
      buffs: "6|23",
      debuffs: "13|11",
    });
    const body = Buffer.concat([Buffer.from("R"), Buffer.alloc(2), Buffer.from(responseJson)]);
    const frame = opaqueGenericFrame(body);
    const completed = new PacketBuffers().push(parsedPayload(frame, { seq: 10_000 }));

    expect(frame).toHaveLength(108);
    expect([...frame].filter((byte) => byte === 0)).toHaveLength(5);
    expect(completed.map((payload) => payload.text)).toEqual([`R ${responseJson}`]);
    expect(messageToEvents(captureMessages(completed[0].text))).toMatchObject([
      {
        name: "updateSatanicZone",
        value: {
          rawZone: "Act_06_02",
        },
      },
    ]);
  });

  test("waits for the complete generic header when an opaque prefix is printable", () => {
    const body = Buffer.concat([Buffer.from([0x01, 0, 0]), Buffer.from('{"gold":100}')]);
    const frame = opaqueGenericFrame(body, Buffer.from("wxyz"));

    for (let splitAt = 1; splitAt < 8; splitAt += 1) {
      const buffers = new PacketBuffers();
      expect(buffers.push(parsedPayload(frame.subarray(0, splitAt), {
        seq: 11_000,
        flags: 0x10,
      })), `split at byte ${splitAt}`).toEqual([]);
      expect(buffers.push(parsedPayload(frame.subarray(splitAt), {
        seq: 11_000 + splitAt,
      })).map((payload) => payload.text), `split at byte ${splitAt}`).toEqual([
        '\u0001 {"gold":100}',
      ]);
    }
  });

  test("reassembles a live-shaped Zeus pickup and records it in the item timeline", () => {
    const fingerprint = "10-3909410-659df5d59c0a70003-1";
    const responseJson = JSON.stringify({
      status: 1,
      message: "Success on inventory update ext",
      goldAmount: 0,
      operations: {
        add: {
          [fingerprint]: {
            d: 4,
            b: 15,
            c: 1,
            e: 11,
            price: 603,
            m: 1,
            j: 0,
            stats: {
              154: 136,
              179: 75,
              147: 5,
              rarity: 6,
              180: 8,
              29: 147,
              20: 4,
              tier: 3,
              146: 10,
              145: 17,
            },
            mask: 1073745935,
            a: 560494998,
            sh: "450ee7c568b2",
          },
        },
        log_ids: {
          [fingerprint]: {
            m: "1073745935",
            a: 2,
          },
        },
      },
      newHashes: {},
    });
    const body = Buffer.concat([Buffer.from([0x01, 0, 0]), Buffer.from(responseJson)]);
    const frame = opaqueGenericFrame(body);
    const splitAt = 7;
    const inboundFlow = {
      src: "198.58.103.158",
      srcPort: 6669,
      dst: "192.168.1.154",
      dstPort: 57769,
    };
    const buffers = new PacketBuffers();

    expect(frame).toHaveLength(426);
    expect([...frame].filter((byte) => byte === 0)).toHaveLength(4);
    expect(buffers.push(parsedPayload(frame.subarray(0, splitAt), {
      ...inboundFlow,
      seq: 13_000,
      flags: 0x10,
    }))).toEqual([]);
    const completed = buffers.push(parsedPayload(frame.subarray(splitAt), {
      ...inboundFlow,
      seq: 13_000 + splitAt,
    }));
    const events = messageToEvents(captureMessages(completed[0].text));
    const snapshot = new StatsEngine().applyEvents(events);

    expect(completed).toHaveLength(1);
    expect(events).toMatchObject([
      {
        name: "itemAdded",
        value: {
          source: "inventory",
          repository: "unique",
          fingerprint,
          label: "Zeus' Body Armor",
          id: 15,
          type: 1,
          weaponType: 0,
          rarityName: "Set",
        },
      },
    ]);
    expect(snapshot.itemTimeline).toMatchObject([
      {
        source: "inventory",
        repository: "unique",
        rarity: "Set",
        label: "Zeus' Body Armor",
        id: 15,
        type: 1,
        weaponType: 0,
        fingerprint,
      },
    ]);
    expect(snapshot.items.Set.total).toBe(1);
  });

  test("does not lock onto an incomplete hex suffix while looking for a frame boundary", () => {
    const buffers = new PacketBuffers();
    const prefix = Buffer.from("unframed dead");
    const json = Buffer.from('\0{"gold":100}\0');

    expect(buffers.push(parsedPayload(prefix, { seq: 14_000, flags: 0x10 }))).toEqual([]);
    expect(buffers.push(parsedPayload(json, { seq: 14_000 + prefix.length })).map((payload) => payload.text)).toEqual([
      '{"gold":100}',
    ]);
  });

  test("recovers from legacy-looking noise into a later opaque Zeus response", () => {
    const noise = Buffer.from("legacy-looking bytes without a delimiter");
    const fingerprint = "10-3909410-659df5d59c0a70003-1";
    const responseJson = JSON.stringify({
      operations: {
        add: {
          [fingerprint]: {
            d: 4,
            b: 15,
            c: 1,
            e: 11,
            a: 560494998,
          },
        },
      },
    });
    const body = Buffer.concat([Buffer.from([0x01, 0, 0]), Buffer.from(responseJson)]);
    const frame = opaqueGenericFrame(body, Buffer.from("wxyz"));
    const frameSequence = 15_000 + noise.length;

    for (let splitAt = 1; splitAt < 8; splitAt += 1) {
      const buffers = new PacketBuffers();
      expect(buffers.push(parsedPayload(noise, { seq: 15_000, flags: 0x10 })), `split at byte ${splitAt}`).toEqual([]);
      expect(buffers.push(parsedPayload(frame.subarray(0, splitAt), {
        seq: frameSequence,
        flags: 0x10,
      })), `split at byte ${splitAt}`).toEqual([]);
      expect(buffers.push(parsedPayload(frame.subarray(splitAt, 8), {
        seq: frameSequence + splitAt,
        flags: 0x10,
      })), `split at byte ${splitAt}`).toEqual([]);
      const completed = buffers.push(parsedPayload(frame.subarray(8), {
        seq: frameSequence + 8,
      }));
      const events = messageToEvents(captureMessages(completed[0].text));

      expect(completed, `split at byte ${splitAt}`).toHaveLength(1);
      expect(completed[0].packet.seq, `split at byte ${splitAt}`).toBe(frameSequence);
      expect(events, `split at byte ${splitAt}`).toMatchObject([
        {
          name: "itemAdded",
          value: {
            fingerprint,
            label: "Zeus' Body Armor",
            rarityName: "Set",
          },
        },
      ]);
    }
  });

  test("rechecks the current packet boundary after rejecting an old tentative header", () => {
    const buffers = new PacketBuffers();
    const noise = Buffer.from("legacy noise");
    const shortContinuation = Buffer.from("xy");
    const body = Buffer.concat([Buffer.from([0x01, 0, 0]), Buffer.from('{"gold":100}')]);
    const frame = opaqueGenericFrame(body, Buffer.from("wxyz"));
    const frameSequence = 16_000 + noise.length + shortContinuation.length;

    expect(buffers.push(parsedPayload(noise, { seq: 16_000, flags: 0x10 }))).toEqual([]);
    expect(buffers.push(parsedPayload(shortContinuation, {
      seq: 16_000 + noise.length,
      flags: 0x10,
    }))).toEqual([]);
    const completed = buffers.push(parsedPayload(frame, { seq: frameSequence }));

    expect(completed.map((payload) => payload.text)).toEqual(['\u0001 {"gold":100}']);
    expect(completed[0].packet.seq).toBe(frameSequence);
  });

  test("recovers account and currency frames after capture restarts mid-frame on a plausible opaque length", () => {
    for (const prefix of [Buffer.from("wxyz"), Buffer.from([0x81, 0x92, 0xa3, 0xb4])]) {
      const buffers = new PacketBuffers();
      const falseHeader = Buffer.alloc(8);
      prefix.copy(falseHeader);
      falseHeader.writeUInt32LE(1_000, 4);
      const midFrame = Buffer.concat([falseHeader, Buffer.alloc(900, 0x61)]);
      const accountFrame = opaqueGenericFrame(
        Buffer.concat([
          Buffer.from([0x01, 0, 0]),
          Buffer.from(JSON.stringify({ name: "Dante", experience: 5, season: 11, hardcore: 0 })),
        ]),
        prefix,
      );
      const currencyFrame = opaqueGenericFrame(
        Buffer.concat([Buffer.from([0x01, 0, 0]), Buffer.from(JSON.stringify({ currencyData: { GSS: 100 } }))]),
        prefix,
      );
      const accountSequence = 17_000 + midFrame.length;
      const currencySequence = accountSequence + accountFrame.length;

      expect(buffers.push(parsedPayload(midFrame, { seq: 17_000, flags: 0x10 }))).toEqual([]);
      const accountPayloads = buffers.push(parsedPayload(accountFrame, { seq: accountSequence }));
      const currencyPayloads = buffers.push(parsedPayload(currencyFrame, { seq: currencySequence }));

      expect(accountPayloads, `prefix ${prefix.toString("hex")}`).toHaveLength(1);
      expect(accountPayloads[0].packet.seq, `prefix ${prefix.toString("hex")}`).toBe(accountSequence);
      expect(currencyPayloads, `prefix ${prefix.toString("hex")}`).toHaveLength(1);
      expect(currencyPayloads[0].packet.seq, `prefix ${prefix.toString("hex")}`).toBe(currencySequence);

      const events = [...accountPayloads, ...currencyPayloads].flatMap((payload) => messageToEvents(captureMessages(payload.text)));
      expect(events, `prefix ${prefix.toString("hex")}`).toMatchObject([
        { name: "updateAccount", value: { name: "Dante", seasonMode: "GSS" } },
        { name: "updateGold", value: { GSS: 100 } },
      ]);

      const stats = new StatsEngine();
      const snapshot = stats.applyEvents(events);
      expect(snapshot.accountName, `prefix ${prefix.toString("hex")}`).toBe("Dante");
      expect(snapshot.totalGold, `prefix ${prefix.toString("hex")}`).toBe(100);
      expect(buffers.stats(), `prefix ${prefix.toString("hex")}`).toEqual({
        streams: 1,
        pendingSegments: 0,
        bufferedBytes: 0,
      });
    }
  });

  test("rejects a complete opaque false frame before recovering the next packet boundary", () => {
    const buffers = new PacketBuffers();
    const falseBody = Buffer.alloc(24, 0x7a);
    const falseFrame = opaqueGenericFrame(falseBody, Buffer.from("wxyz"));
    const accountFrame = opaqueGenericFrame(
      Buffer.concat([
        Buffer.from([0x01, 0, 0]),
        Buffer.from(JSON.stringify({ name: "Dante", experience: 5, season: 11, hardcore: 0 })),
      ]),
      Buffer.from("wxyz"),
    );
    const accountSequence = 18_000 + falseFrame.length;

    expect(buffers.push(parsedPayload(falseFrame, { seq: 18_000, flags: 0x10 }))).toEqual([]);
    const completed = buffers.push(parsedPayload(accountFrame, { seq: accountSequence }));

    expect(completed.map((payload) => payload.text)).toEqual([
      `\u0001 ${JSON.stringify({ name: "Dante", experience: 5, season: 11, hardcore: 0 })}`,
    ]);
    expect(completed[0].packet.seq).toBe(accountSequence);
    expect(messageToEvents(captureMessages(completed[0].text))).toMatchObject([
      { name: "updateAccount", value: { name: "Dante", seasonMode: "GSS" } },
    ]);
    expect(buffers.stats().bufferedBytes).toBe(0);
  });

  test("rejects zero and oversized opaque response lengths without losing later legacy JSON", () => {
    for (const bodyLength of [0, 64 * 1024 + 1]) {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(bodyLength);
      const malformed = Buffer.concat([
        Buffer.from([0x81, 0x92, 0xa3, 0xb4]),
        length,
        Buffer.from('\0{"gold":100}\0'),
      ]);

      expect(new PacketBuffers().push(parsedPayload(malformed)).map((payload) => payload.text)).toEqual([
        '{"gold":100}',
      ]);
    }
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
