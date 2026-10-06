import { deflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { classifyDirectMarketNetworkError, inspectDirectMarketResponse } from "../../src/main/market-direct-response";

describe("safe direct-market response diagnostics", () => {
  const inspect = (value: unknown, status = 200) => inspectDirectMarketResponse(Buffer.from(JSON.stringify(value)), status);

  test("keeps rejection category/status but never server messages or echoed credentials", () => {
    const result = inspect({ status: 0, message: "Invalid checksum for account_id=private-account", request: { multipass: "private-token" } });
    expect(result).toMatchObject({
      response: { ok: false, errorCode: "checksum_rejected" },
      diagnostics: { httpStatus: 200, applicationStatus: 0, reason: "server-rejected", serverReason: "checksum" },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|message|multipass/);
  });

  test("separates HTTP rejection, invalid JSON, missing items and malformed compressed data", () => {
    expect(inspect({}, 403).diagnostics).toMatchObject({ reason: "http-status", httpStatus: 403 });
    expect(inspectDirectMarketResponse(Buffer.from("<html>private</html>"), 200).diagnostics.reason).toBe("invalid-json");
    expect(inspect({ status: 1 }).diagnostics.reason).toBe("missing-items");
    expect(inspect({ status: 1, items: "not-zlib" }).diagnostics.reason).toBe("invalid-items");
  });

  test("limits decompressed bytes as well as the wire response", () => {
    const items = deflateSync(Buffer.alloc(4 * 1024 * 1024 + 1, 32)).toString("base64");
    expect(inspect({ status: 1, items }).diagnostics.reason).toBe("invalid-items");
  });

  test("returns only two numeric prices and no seller data in success or diagnostics", () => {
    const items = deflateSync(Buffer.from(JSON.stringify([
      { price: 3400, seller: "private-seller" }, { price: 3499 }, { price: 5000 }, { price: -1 }, { price: "wrong" },
    ]))).toString("base64");
    const result = inspect({ status: 1, items, itemCount: 47 });
    expect(result.response).toEqual({ ok: true, result: { listings: [{ price: 3400 }, { price: 3499 }], totalMatches: 47 } });
    expect(JSON.stringify(result)).not.toMatch(/seller|private/);
  });

  test("uses safe network categories rather than persisting arbitrary error strings", () => {
    expect(classifyDirectMarketNetworkError("CERT_HAS_EXPIRED")).toBe("tls");
    expect(classifyDirectMarketNetworkError("ENOTFOUND")).toBe("dns");
    expect(classifyDirectMarketNetworkError("ECONNRESET")).toBe("connection");
  });
});
