import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { SatanicZoneRequestContext } from "../../src/main/captured-session-context";
import {
  buildDirectApiPingFrame,
  buildDirectSatanicZoneFrame,
  DirectApiPingResponseDecoder,
  DirectSatanicZoneResponseDecoder,
} from "../../src/main/direct-satanic-zone-protocol";

const context: SatanicZoneRequestContext = {
  generation: 1, revision: 2, updatedAt: 1,
  uniqueAccountId: "hero-7", crossregionIdentifier: "xrid/one", beta: "0",
  endpoint: { address: "127.0.0.1", port: 6669 }, scopeKey: "scope",
};

function responseFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(8);
  Buffer.from([0x81, 0x92, 0xa3, 0xb4]).copy(header);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

// Independent oracle transcribed from 00e8477, resources/satanic-zone-relay:
// addon.py:_canonical_satanic_zone_body (3164), sz_frame.py:build_frame (53),
// and sz_frame.py:_computed_token (534). Expected bytes never use the current
// constructor, URLSearchParams, or its returned body/header as an input.
// The historical domain is numeric IDs (20/32 digits maximum) and beta=0.
// These invented sentinels prove byte parity only, not server acceptance,
// broader identifier escaping, initialization, or game-flow injection safety.
function historicalRelaySzFrame(uniqueAccountId: string, crossregionIdentifier: string, counter: number): Buffer {
  if (!/^[0-9]{1,20}$/.test(uniqueAccountId) || !/^[0-9]{1,32}$/.test(crossregionIdentifier)) {
    throw new Error("outside historical relay numeric domain");
  }
  const body = Buffer.from(
    "\x03\x00\x01\x00satanic_zone_get\x00R\x00"
      + `unique_account_id=${uniqueAccountId}&crossregion_identifier=${crossregionIdentifier}&beta=0\x00`,
    "ascii",
  );
  const hashInput = Buffer.alloc(body.length + 1);
  body.copy(hashInput);
  hashInput.writeUInt8(counter, body.length);
  const token = createHash("md5").update(hashInput).digest("hex").substring(0, 12);
  const frame = Buffer.alloc(16 + body.length);
  frame.write(token, 0, 12, "ascii");
  frame.writeUInt32LE(body.length, 12);
  body.copy(frame, 16);
  return frame;
}

describe("historical relay SZ frame parity (offline, numeric IDs, beta=0)", () => {
  const sentinels = [
    { uniqueAccountId: "7", crossregionIdentifier: "9" },
    { uniqueAccountId: "0007", crossregionIdentifier: "0000009" },
    { uniqueAccountId: "12345678901234567890", crossregionIdentifier: "12345678901234567890123456789012" },
  ];

  // Fixed vectors produced by executing the historical Python body/token/frame
  // functions with invented IDs 7/9. This is constructed data, not a capture;
  // it independently anchors both the test oracle and the current constructor.
  const goldenLengthAndBody = Buffer.from(
    "4b00000003000100736174616e69635f7a6f6e655f676574005200756e697175655f6163636f756e745f69643d37"
      + "2663726f7373726567696f6e5f6964656e7469666965723d3926626574613d3000",
    "hex",
  );
  test.each([
    { counter: 0, token: "b6dfdb19acaa" },
    { counter: 1, token: "a69d434de2f1" },
    { counter: 254, token: "c73229c30de9" },
    { counter: 255, token: "2664ffc05a40" },
  ])("matches fixed historical Python full-frame bytes at counter $counter", ({ counter, token }) => {
    const expected = Buffer.concat([Buffer.from(token, "ascii"), goldenLengthAndBody]);
    expect(historicalRelaySzFrame("7", "9", counter)).toEqual(expected);
    expect(buildDirectSatanicZoneFrame({ ...context, ...sentinels[0], beta: "0" }, counter)).toEqual(expected);
  });

  test.each(sentinels)("matches the complete historical frame for $uniqueAccountId / $crossregionIdentifier", (ids) => {
    for (const counter of [0, 1, 254, 255]) {
      const actual = buildDirectSatanicZoneFrame({ ...context, ...ids, beta: "0" }, counter);
      const expected = historicalRelaySzFrame(ids.uniqueAccountId, ids.crossregionIdentifier, counter);
      expect(actual).toEqual(expected);
      expect(actual.subarray(16)).toEqual(expected.subarray(16));
      expect(actual.readUInt32LE(12)).toBe(expected.length - 16);
      expect(actual.subarray(0, 12).toString("ascii")).toMatch(/^[0-9a-f]{12}$/);
      expect(actual.subarray(0, 12)).toEqual(expected.subarray(0, 12));
    }
  });

  // addon.py:2173 and counter_translation.py:140-150 establish modulo-256
  // application-counter arithmetic. This tests frames at those explicit
  // counters; the fresh-socket provider still uses only ping=0 and SZ=1.
  test.each([
    { clientCounter: 0, offset: 0, injectedCounter: 1, nextNativeCounter: 1, translatedCounter: 2 },
    { clientCounter: 254, offset: 0, injectedCounter: 255, nextNativeCounter: 255, translatedCounter: 0 },
    { clientCounter: 255, offset: 0, injectedCounter: 0, nextNativeCounter: 0, translatedCounter: 1 },
    { clientCounter: 254, offset: 1, injectedCounter: 0, nextNativeCounter: 255, translatedCounter: 1 },
    { clientCounter: 255, offset: 255, injectedCounter: 255, nextNativeCounter: 0, translatedCounter: 0 },
  ])("matches inserted/next API frames across client=$clientCounter and offset=$offset", (counters) => {
    const injectedCounter = (counters.clientCounter + counters.offset + 1) % 256;
    const nextNativeCounter = (counters.clientCounter + 1) % 256;
    const offsetAfterDispatch = (counters.offset + 1) % 256;
    const translatedCounter = (nextNativeCounter + offsetAfterDispatch) % 256;
    expect([injectedCounter, nextNativeCounter, translatedCounter]).toEqual([
      counters.injectedCounter, counters.nextNativeCounter, counters.translatedCounter,
    ]);
    const numericContext = { ...context, ...sentinels[0], beta: "0" };
    const inserted = buildDirectSatanicZoneFrame(numericContext, injectedCounter);
    const following = buildDirectSatanicZoneFrame(numericContext, translatedCounter);
    expect(inserted).toEqual(historicalRelaySzFrame("7", "9", counters.injectedCounter));
    expect(following).toEqual(historicalRelaySzFrame("7", "9", counters.translatedCounter));
    expect(following.subarray(12)).toEqual(inserted.subarray(12));
    expect(following.subarray(0, 12)).not.toEqual(inserted.subarray(0, 12));
  });
});

describe("direct Satanic Zone protocol", () => {
  test("builds the proven ping at counter zero and SZ request at counter one", () => {
    const ping = buildDirectApiPingFrame();
    expect(ping.subarray(0, 12).toString("ascii")).toBe("30a771fb83c2");
    expect(ping.readUInt32LE(12)).toBe(2);
    expect(ping.subarray(16)).toEqual(Buffer.from([1, 0]));

    const frame = buildDirectSatanicZoneFrame(context);
    const bodyLength = frame.readUInt32LE(12);
    const body = frame.subarray(16);
    expect(body).toHaveLength(bodyLength);
    expect(body.subarray(0, 4)).toEqual(Buffer.from([3, 0, 1, 0]));
    expect(body.toString("utf8")).toContain("satanic_zone_get\0R\0");
    expect(body.toString("utf8")).toContain("unique_account_id=hero-7&crossregion_identifier=xrid%2Fone&beta=0");
    expect(frame.subarray(0, 12).toString("ascii")).toBe(
      createHash("md5").update(body).update(Buffer.from([1])).digest("hex").slice(0, 12),
    );
  });

  test("validates a fragmented generic pong and returns coalesced remainder bytes", () => {
    const decoder = new DirectApiPingResponseDecoder();
    const header = Buffer.alloc(8);
    Buffer.from([0x81, 0x92, 0xa3, 0xb4]).copy(header);
    header.writeUInt32LE(2, 4);
    const pong = Buffer.concat([header, Buffer.from([1, 0])]);
    expect(decoder.push(pong.subarray(0, 7))).toBeNull();
    expect(decoder.push(Buffer.concat([pong.subarray(7), Buffer.from("next")]))).toEqual(Buffer.from("next"));
  });

  test("decodes split and coalesced opaque response frames to a sanitized observation", () => {
    const decoder = new DirectSatanicZoneResponseDecoder();
    const unrelated = responseFrame({ status: 1, message: "ok" });
    const expected = responseFrame({ payload: { satanicZoneName: "Act_08_03", buffs: "21|22|5", debuffs: [25, 18] } });
    const bytes = Buffer.concat([unrelated, expected]);
    expect(decoder.push(bytes.subarray(0, 5), 10_000)).toBeNull();
    expect(decoder.push(bytes.subarray(5), 10_000)).toMatchObject({
      rawZone: "Act_08_03", updatedAt: 10_000,
    });
  });

  test("accepts a fragmented zone response after framing-agnostic connection/status bytes", () => {
    const decoder = new DirectSatanicZoneResponseDecoder();
    const status = Buffer.from([0x01, 0, 0, 0, 0xff, 0x7f, 0, 0, 0, 0]);
    const response = Buffer.from(JSON.stringify({
      result: { satanic_zone_name: "Act_03_02", zone_buffs: [4, 9], zone_debuffs: "25|18" },
    }));
    expect(decoder.push(Buffer.concat([status, response.subarray(0, 17)]), 20_000)).toBeNull();
    expect(decoder.push(response.subarray(17), 20_000)).toMatchObject({
      rawZone: "Act_03_02",
      buffs: [{ id: 4 }, { id: 9 }],
      cons: [{ id: 25 }, { id: 18 }],
      updatedAt: 20_000,
    });
  });

  test("keeps arbitrary non-zone bytes bounded", () => {
    const decoder = new DirectSatanicZoneResponseDecoder();
    expect(decoder.push(Buffer.alloc(1_048_576), 1)).toBeNull();
    expect(() => decoder.push(Buffer.from([0]), 1)).toThrow("response too large");
  });
});
