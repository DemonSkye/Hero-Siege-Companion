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
