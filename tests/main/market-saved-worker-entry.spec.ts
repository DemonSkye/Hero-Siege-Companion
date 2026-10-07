import { EventEmitter } from "node:events";
import { deflateSync } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import { marketContextFixture, marketSearchFixture } from "../fixtures/market";
import type { DirectMarketWorkerResult } from "../../src/main/market-direct-response";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:https");
  vi.doUnmock("node:worker_threads");
});

async function runWorker(mode: string) {
  let posted!: (value: DirectMarketWorkerResult) => void;
  const completion = new Promise<DirectMarketWorkerResult>((resolve) => { posted = resolve; });
  const postMessage = vi.fn((value: DirectMarketWorkerResult | { type: string }) => {
    if (!("type" in value)) posted(value);
  });
  let postedBody = "";
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
  const httpsRequest = vi.fn((_options, callback) => {
    request.end.mockImplementation((body: string) => {
      postedBody = body;
      if (mode === "timeout") { request.emit("timeout"); request.emit("error", { code: "ECONNRESET" }); return; }
      const response = Object.assign(new EventEmitter(), { statusCode: mode === "http" ? 503 : 200 });
      callback(response);
      if (mode === "aborted" || mode === "error") {
        response.emit(mode, new Error("CANARY_PRIVATE_ERROR")); response.emit("end"); return;
      }
      if (mode === "oversized") { response.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1)); response.emit("end"); return; }
      const rows = mode === "empty" ? [] : mode === "cap" ? [null, { price: -1 },
        ...Array.from({ length: 25 }, (_, index) => ({ price: 25 - index, unit_price: "0.5", seller_uid: "CANARY_SELLER" })),
      ] : [
        { price: 500_000, seller_uid: "CANARY_SELLER", item_data: "CANARY_ITEM", fingerprint: "CANARY_FINGERPRINT" },
        { price: 200_000, unit_price: "100000" }, { price: 900_000 },
      ];
      const items = deflateSync(Buffer.from(JSON.stringify(rows))).toString("base64");
      const responseBody = mode === "invalid" ? "not-json" : mode === "checksum"
        ? JSON.stringify({ status: -3, message: "Invalid checksum CANARY_IDENTITY" })
        : JSON.stringify({ status: 1, items, itemCount: mode === "empty" ? 0 : mode === "cap" ? 101 : 3 });
      const bytes = Buffer.from(responseBody);
      response.emit("data", bytes.subarray(0, 7));
      response.emit("data", bytes.subarray(7));
      response.emit("end");
      request.emit("error", { code: "ECONNRESET" });
    });
    return request;
  });
  vi.doMock("node:worker_threads", () => {
    const thread = { parentPort: { postMessage }, workerData: { context: marketContextFixture, request: marketSearchFixture } };
    return { ...thread, default: thread };
  });
  vi.doMock("node:https", () => ({ default: { request: httpsRequest } }));
  await import("../../src/main/market-direct-search-worker");
  const result = await completion;
  expect(postMessage.mock.calls.filter(([value]) => !("type" in value))).toHaveLength(1);
  expect(httpsRequest).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toMatch(/CANARY|seller|fingerprint|item_data|account_id|crossregion/);
  return { result, form: new URLSearchParams(postedBody), request, httpsRequest };
}

test("production worker dispatch constructs observed filters and posts a bounded safe result", async () => {
  const { result, form, httpsRequest } = await runWorker("success");
  expect(httpsRequest.mock.calls[0][0]).toMatchObject({ method: "POST", timeout: 15_000, headers: { "content-type": "application/x-www-form-urlencoded" } });
  expect(Object.fromEntries(form.entries())).toMatchObject({
    api_script: "market/market_fetch_items", filter_masks: "[1073746020]", filter_sockets_min: "4",
    item_sort: "2", scroll_page: "0", page_id: "99999999", get_highest_id: "1",
    checksum: "9bd66f31a01793b0c6dee8610d46b72e604467449b86ef9ca8dec0058a4354d8",
  });
  expect(JSON.parse(Buffer.from(form.get("stat_filter")!, "base64").toString("utf8"))).toEqual([{ statId: 64, filter: 2, statValue: 8 }]);
  expect(result.response).toEqual({ ok: true, result: { listings: [{ price: 200_000, unitPrice: 100_000 }, { price: 500_000 }, { price: 900_000 }], totalMatches: 3, returnedCount: 3 } });
});

test.each([
  ["checksum", "checksum_rejected", "server-rejected"],
  ["timeout", "timed_out", "timeout"],
  ["aborted", "market_unreachable", "response-aborted"],
  ["error", "market_unreachable", "response-aborted"],
  ["oversized", "market_unreachable", "response-too-large"],
  ["invalid", "cached_request_rejected", "invalid-json"],
  ["http", "market_unreachable", "http-status"],
])("production worker settles %s once without leaking private error content", async (mode, errorCode, reason) => {
  const { result } = await runWorker(mode);
  expect(result).toMatchObject({ response: { ok: false, errorCode }, diagnostics: { reason } });
});

test("production worker distinguishes a successful empty page from a failed request", async () => {
  const { result } = await runWorker("empty");
  expect(result.response).toEqual({ ok: true, result: { listings: [], totalMatches: 0, returnedCount: 0 } });
});

test("production worker projects 20 listings from one larger page with no additional request", async () => {
  const { result } = await runWorker("cap");
  expect(result.response).toEqual({ ok: true, result: {
    listings: Array.from({ length: 20 }, (_, index) => ({ price: index + 1, unitPrice: 0.5 })),
    returnedCount: 27, totalMatches: 101,
  } });
});
