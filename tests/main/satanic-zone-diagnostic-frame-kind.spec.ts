import { describe, expect, test } from "vitest";
import { classifySatanicZoneDiagnosticApiBody as classify } from "../../src/main/satanic-zone-diagnostic-frame-kind";
import { connectDiagnosticBody as connect, requestDiagnosticBody as request } from "../fixtures/satanic-zone-diagnostic-frames";

describe("bounded structural diagnostic categories", () => {
  test("connect shape is distinct from a ping and returns no field/digest values", () => {
    const body = connect(); const copy = Buffer.from(body);
    expect(classify(body, true)).toBe("connect-shaped"); expect(body).toEqual(copy);
    expect(classify(Buffer.from([1, 0]), true)).toBe("ping");
    expect(JSON.stringify(classify(body, true))).not.toContain("CANARY");
  });
  test("escaped scalar values and Unicode-escaped allowlisted keys are accepted without becoming names", () => {
    const json = '{"acc\\u006funt":"CANARY_\\\"checksum\\\":\\\\☃","account_uid":42,"checksum":null,"beta":true,"log_verbose":true}';
    expect(classify(connect(json), true)).toBe("connect-shaped");
  });
  test.each([
    ["malformed JSON", '{"account":'],
    ["array root", '["CANARY_PRIVATE"]'],
    ["null root", "null"],
    ["missing checksum", '{"account":"CANARY","account_uid":1}'],
    ["arbitrary extra key", '{"account":"CANARY","account_uid":1,"checksum":"x","auth":"CANARY"}'],
    ["prototype key", '{"account":"CANARY","account_uid":1,"checksum":"x","__proto__":{}}'],
    ["nested value", '{"account":{"auth":"CANARY"},"account_uid":1,"checksum":"x"}'],
    ["array value", '{"account":[],"account_uid":1,"checksum":"x"}'],
    ["non-finite number", '{"account":"CANARY","account_uid":1e999,"checksum":"x"}'],
    ["false optional flag", '{"account":"CANARY","account_uid":1,"checksum":"x","beta":false}'],
    ["string optional flag", '{"account":"CANARY","account_uid":1,"checksum":"x","log_verbose":"true"}'],
    ["duplicate key", '{"account":"CANARY","account":"CANARY2","account_uid":1,"checksum":"x"}'],
    ["escaped duplicate key", '{"account":"CANARY","acc\\u006funt":"CANARY2","account_uid":1,"checksum":"x"}'],
    ["oversized JSON", JSON.stringify({ account: "x".repeat(4096), account_uid: 1, checksum: "x" })],
  ])("%s remains an unclassified API frame", (_name, json) => {
    expect(classify(connect(json), true)).toBe("other-api");
  });
  test.each([
    ["wrong mode", connect(undefined, 2)],
    ["short digest", connect(undefined, 1, "a".repeat(31))],
    ["non-hex digest", connect(undefined, 1, "z".repeat(32))],
    ["missing final terminator", connect().subarray(0, -1)],
    ["trailing data", Buffer.concat([connect(), Buffer.from([1])])],
    ["truncated header", Buffer.from([0, 0])],
    ["invalid UTF-8", Buffer.concat([Buffer.from([0, 0, 1, 255]), connect().subarray(3)])],
  ])("connect %s does not acquire a structural category", (_name, body) => {
    expect(classify(body, true)).toBe("other-api");
  });
  test.each([83, 99, 93, 65535])("mode %s never names an operation", (mode) => {
    expect(classify(request(2, "CANARY_UNKNOWN_COMMAND", mode), true)).toBe("api-request");
    expect(classify(request(3, "CANARY_UNKNOWN_COMMAND", mode), true)).toBe("region-api-request");
  });
  test("complete UTF-8 command/argument strings may be opaque or empty arguments", () => {
    expect(classify(request(2, "CANARY_☃", 93, ""), true)).toBe("api-request");
    expect(classify(request(3, "x".repeat(64), 83, "x".repeat(16384)), true)).toBe("region-api-request");
  });
  test.each([2, 3] as const)("opcode %s requires complete bounded fields without trailing data", (opcode) => {
    const body = request(opcode);
    for (const invalid of [request(opcode, ""), request(opcode, "x".repeat(65)), request(opcode, "cmd", 93, "x".repeat(16385)),
      body.subarray(0, 1), body.subarray(0, opcode === 3 ? 4 : 2), body.subarray(0, -1),
      Buffer.concat([body, Buffer.from([0])]), request(opcode, "cmd", 93, "private\0trailing")]) {
      expect(classify(invalid, true)).toBe("other-api");
    }
    const invalidUtf8 = request(opcode); invalidUtf8[opcode === 3 ? 4 : 2] = 255;
    expect(classify(invalidUtf8, true)).toBe("other-api");
  });
  test("inbound bodies cannot become the new outbound request categories", () => {
    for (const body of [connect(), request(2), request(3)]) expect(classify(body, false)).toBe("other-api");
  });
  test("legacy SZ prefix recognition is unchanged rather than becoming a new dispatch condition", () => {
    expect(classify(Buffer.from("\x03\0\x01\0satanic_zone_get\0R\0", "binary"), true)).toBe("zone-request");
  });
});
