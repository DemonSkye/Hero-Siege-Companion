import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CompleteCapturedSessionContext } from "../../src/main/captured-session-context";
import type { DirectMarketWorkerResult } from "../../src/main/market-direct-response";
import type { MarketSearchRequest } from "../../src/shared/market-search";
import evidence from "../fixtures/market-native-evidence.json";

const bridge = vi.hoisted(() => ({ data: undefined as unknown, post: vi.fn(), request: vi.fn() }));
vi.mock("node:worker_threads", () => ({
  default: { get workerData() { return bridge.data; }, parentPort: { postMessage: bridge.post } },
  get workerData() { return bridge.data; },
  parentPort: { postMessage: bridge.post },
}));
vi.mock("node:https", () => ({ default: { request: bridge.request } }));

const NOW = 1_000_000;
type ChecksumVector = typeof evidence.checksumVectors[number];
const publicFields = evidence.publicRequestProjection.fields;
const filters = evidence.publicFilterProjection;
const sourceProjection = {
  account_id: "region-directory", unique_account_id: "game-api", crossregion_identifier: "game-api",
  season: "character-save", hardcore: "character-save", beta: "game-api",
} as const;
const provenance = {
  fieldSources: sourceProjection,
  accountQualification: "region-directory" as const,
  accountPrefixCoherent: true,
  sameEndpoint: true,
  sameFlow: true,
  hardcoreSourcesAgree: true,
  hardcoreApiObserved: true,
  hardcoreSaveObserved: true,
};

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => { vi.restoreAllMocks(); bridge.request.mockReset(); bridge.post.mockReset(); });

function context(vector = evidence.checksumVectors[0]) {
  return {
    generation: 4, revision: 17, updatedAt: NOW - 3_500,
    endpoint: { address: "203.0.113.71", port: 6668 }, scopeKey: "synthetic-private-worker-scope",
    fields: {
      account_id: vector.postedAccount, unique_account_id: "SYNTHETIC-WORKER-UID",
      crossregion_identifier: "SYNTHETIC-WORKER-CROSSREGION",
      season: vector.season, hardcore: vector.hardcore, beta: vector.beta,
    },
    provenance,
  };
}

function expectedRequestContext(vector: ChecksumVector) {
  return {
    generation: 4, season: vector.season, hardcore: vector.hardcore, beta: vector.beta,
    ...provenance,
  };
}

const droppedItemRequest: MarketSearchRequest = {
  itemMask: JSON.parse(filters.filter_masks)[0], minSockets: Number(filters.filter_sockets_min),
  statFilters: filters.decodedStatFilter.map(clause => ({ statId: clause.statId, minimum: clause.statValue })),
};

class FakeRequest extends EventEmitter {
  body = "";
  end = vi.fn((body: string) => { this.body = body; });
  destroy = vi.fn(() => this);
}
class FakeResponse extends EventEmitter { statusCode = 200; }

const terminalResults = () => bridge.post.mock.calls.map(([message]) => message)
  .filter(message => !("type" in message)) as DirectMarketWorkerResult[];
const progressMessages = () => bridge.post.mock.calls.map(([message]) => message)
  .filter(message => message.type === "request-context");

/** Executes the actual module entry/run/build/reducer; only worker IPC and HTTPS I/O are replaced. */
async function entry(snapshot: CompleteCapturedSessionContext = context(), request = droppedItemRequest) {
  vi.resetModules(); bridge.post.mockClear(); bridge.request.mockReset();
  const outgoing = new FakeRequest();
  let options!: RequestOptions;
  let acceptResponse!: (response: FakeResponse) => void;
  bridge.request.mockImplementation((input: RequestOptions, received: (response: FakeResponse) => void) => {
    options = input; acceptResponse = received; return outgoing;
  });
  bridge.data = { context: snapshot, request };
  await import("../../src/main/market-direct-search-worker");
  expect(bridge.request).toHaveBeenCalledTimes(1);
  expect(outgoing.end).toHaveBeenCalledTimes(1);
  expect(progressMessages().map(message => message.diagnostics.dispatchStatus)).toEqual(["unconfirmed", "submitted"]);
  expect(terminalResults()).toHaveLength(0);
  const response = new FakeResponse(); acceptResponse(response);
  return {
    outgoing, response, options, form: new URLSearchParams(outgoing.body),
    async result() {
      await vi.waitFor(() => expect(terminalResults()).toHaveLength(1));
      return terminalResults()[0];
    },
  };
}

function successBody() {
  const { decodedItems, ...envelope } = evidence.syntheticResponses.success;
  return Buffer.from(JSON.stringify({ ...envelope, items: deflateSync(Buffer.from(JSON.stringify(decodedItems))).toString("base64") }));
}
function receive(response: FakeResponse, body: Buffer) {
  response.emit("data", body.subarray(0, 7)); response.emit("data", body.subarray(7)); response.emit("end");
}
function expectNoSecrets(result: DirectMarketWorkerResult, form: URLSearchParams) {
  const serialized = JSON.stringify(result);
  for (const key of ["account_id", "unique_account_id", "crossregion_identifier", "checksum", "multipass"] as const) {
    expect(serialized).not.toContain(form.get(key)!);
  }
  expect(serialized).not.toMatch(/203\.0\.113\.71|synthetic-private-worker-scope|synthetic-seller|synthetic-a|message|seller|endpoint|scopeKey/);
}

async function blockedEntry(snapshot: CompleteCapturedSessionContext) {
  vi.resetModules(); bridge.post.mockClear(); bridge.request.mockReset();
  bridge.data = { context: snapshot, request: droppedItemRequest };
  await import("../../src/main/market-direct-search-worker");
  await vi.waitFor(() => expect(terminalResults()).toHaveLength(1));
  expect(bridge.request).not.toHaveBeenCalled();
  expect(progressMessages().map(message => message.diagnostics.dispatchStatus)).toEqual(["unconfirmed"]);
  return terminalResults()[0];
}

describe("actual Market worker entry with retained native structure and independent synthetic expectations", () => {
  test("fixture distinguishes native observations from substituted identities and response bodies", () => {
    expect(evidence.provenance).toMatchObject({
      syntheticIdentifiers: true, nativeServerAcceptanceClaimed: false,
      retainedCompleteAcceptedNativePairs: 0, currentInstalledBuildParityEstablished: false,
    });
    expect(evidence.publicRequestProjection.pairedResponseAvailable).toBe(false);
    expect(evidence.syntheticResponses.evidenceClass).toBe("invented-body-substitutes-using-observed-envelope-and-status-shape");
  });

  test.each(evidence.checksumVectors)("$id uses its independent checksum through the actual worker POST", async vector => {
    const run = await entry(context(vector));
    expect(run.options).toMatchObject({ hostname: "hsmarket.panicartstudios.com", port: 443,
      path: "/market/herosiege_api_bootstrap.php", method: "POST", timeout: 15_000,
      headers: { "content-type": "application/x-www-form-urlencoded", "accept-encoding": "identity",
        "content-length": Buffer.byteLength(run.outgoing.body) } });
    expect(run.form.get("checksum")).toBe(vector.expectedChecksumHex);
    expect(run.form.get("account_id")).toBe(vector.postedAccount);
    expect(run.form.get("season")).toBe(vector.season);
    expect(run.form.get("hardcore")).toBe(vector.hardcore);
    expect(run.form.get("beta")).toBe(vector.beta);
    expect(createHash("sha256").update(run.form.get("multipass")!, "utf8").digest("hex"))
      .toBe(evidence.routeSignature.expectedSha256OfHex);
    expect(run.form.get("api_script")).toBe(publicFields.api_script);
    for (const field of ["filter_masks", "scroll_page", "page_id", "get_highest_id"] as const) {
      expect(run.form.get(field)).toBe(publicFields[field]);
    }
    // The native projection observed default sort 0; this product deliberately asks for ascending prices.
    expect(run.form.get("item_sort")).toBe(evidence.publicRequestProjection.productPriceSort);
    expect(run.form.get("filter_sockets_min")).toBe(filters.filter_sockets_min);
    expect(JSON.parse(Buffer.from(run.form.get("stat_filter")!, "base64").toString("utf8"))).toEqual(filters.decodedStatFilter);
    receive(run.response, successBody());
    const result = await run.result();
    expect(result.response).toEqual({ ok: true, result: evidence.syntheticResponses.expectedSuccess });
    expect(result.diagnostics).toEqual({ httpStatus: 200, applicationStatus: 1, responseBytes: successBody().length,
      contextRevision: 17, contextAgeMs: 3_500, requestContext: expectedRequestContext(vector), dispatchStatus: "submitted" });
    for (const message of progressMessages()) expectNoSecrets(message, run.form);
    expectNoSecrets(result, run.form);
  });

  test("HTTP 200 checksum rejection keeps the same final request mode/provenance and discards echoed secrets", async () => {
    const vector = evidence.checksumVectors[1], run = await entry(context(vector));
    const body = Buffer.from(JSON.stringify({ ...evidence.syntheticResponses.rejection,
      message: `checksum account_id=${run.form.get("account_id")} unique_account_id=${run.form.get("unique_account_id")}`,
      request: Object.fromEntries(run.form) }));
    receive(run.response, body);
    const result = await run.result();
    expect(result.response).toEqual(evidence.syntheticResponses.expectedRejection);
    expect(result.diagnostics).toEqual({ httpStatus: 200, applicationStatus: -3, responseBytes: body.length,
      reason: "server-rejected", serverReason: "checksum", contextRevision: 17, contextAgeMs: 3_500,
      requestContext: expectedRequestContext(vector), dispatchStatus: "submitted" });
    expectNoSecrets(result, run.form);
  });

  test("completion diagnostics keep the dispatched form mode even if the supplied snapshot changes later", async () => {
    const vector = evidence.checksumVectors[0], snapshot = context(vector), run = await entry(snapshot);
    snapshot.fields.season = "0"; snapshot.fields.hardcore = "1"; snapshot.fields.beta = "1";
    receive(run.response, successBody());
    const result = await run.result();
    expect(result.diagnostics).toMatchObject({ requestContext: expectedRequestContext(vector) });
    expect(run.form.get("season")).toBe("11");
    expect(run.form.get("hardcore")).toBe("0");
    expect(run.form.get("beta")).toBe("0");
    expectNoSecrets(result, run.form);
  });

  test("legacy snapshots have honest unknown provenance while final posted mode remains visible", async () => {
    const { provenance: _omitted, ...snapshot } = context(evidence.checksumVectors[4]);
    const run = await entry(snapshot);
    const body = Buffer.from(JSON.stringify(evidence.syntheticResponses.rejection)); receive(run.response, body);
    expect((await run.result()).diagnostics).toEqual({ httpStatus: 200, applicationStatus: -3, responseBytes: body.length,
      reason: "server-rejected", serverReason: "checksum", contextRevision: 17, contextAgeMs: 3_500, dispatchStatus: "submitted",
      requestContext: { generation: 4, season: "0", hardcore: "0", beta: "0", fieldSources: {},
        accountQualification: "unknown", accountPrefixCoherent: null, sameEndpoint: null,
        sameFlow: null, hardcoreSourcesAgree: null, hardcoreApiObserved: false, hardcoreSaveObserved: false } });
  });

  test.each(["sameEndpoint", "sameFlow", "accountPrefixCoherent", "hardcoreSourcesAgree"] as const)(
    "%s disagreement remains diagnostic and does not invent a protocol dispatch requirement", async field => {
      const snapshot = context(); snapshot.provenance = { ...provenance, [field]: false };
      const run = await entry(snapshot); receive(run.response, successBody());
      expect(await run.result()).toEqual({ response: { ok: true, result: evidence.syntheticResponses.expectedSuccess },
        diagnostics: { httpStatus: 200, applicationStatus: 1, responseBytes: successBody().length,
          contextRevision: 17, contextAgeMs: 3_500, dispatchStatus: "submitted",
          requestContext: { ...expectedRequestContext(evidence.checksumVectors[0]), [field]: false } } });
    },
  );

  test("an invalid mode is blocked and represented by null, rather than echoed into safe diagnostics", async () => {
    const snapshot = context(); snapshot.fields.season = "SYNTHETIC-WORKER-UID";
    const result = await blockedEntry(snapshot);
    expect(result).toEqual({ response: { ok: false, errorCode: "template_unavailable" },
      diagnostics: { reason: "context-unavailable", contextRevision: 17, contextAgeMs: 3_500, dispatchStatus: "unconfirmed",
        requestContext: { ...expectedRequestContext(evidence.checksumVectors[0]), season: null } } });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC-WORKER-UID");
  });

  test("wire-size overflow destroys the request and publishes one safe result even if late events arrive", async () => {
    const run = await entry();
    const bytes = 4 * 1024 * 1024 + 1;
    run.response.emit("data", Buffer.alloc(bytes));
    const result = await run.result();
    expect(result.response).toEqual({ ok: false, errorCode: "market_unreachable" });
    expect(result.diagnostics).toEqual({ httpStatus: 200, responseBytes: bytes, reason: "response-too-large",
      contextRevision: 17, contextAgeMs: 3_500, requestContext: expectedRequestContext(evidence.checksumVectors[0]), dispatchStatus: "submitted" });
    expect(run.outgoing.destroy).toHaveBeenCalledTimes(1);
    run.response.emit("end"); run.outgoing.emit("error", Object.assign(new Error("synthetic private detail"), { code: "ECONNRESET" }));
    await Promise.resolve(); expect(terminalResults()).toHaveLength(1);
    expectNoSecrets(result, run.form);
  });

  test("inflated response size is bounded by the actual reducer used in the worker", async () => {
    const run = await entry();
    const items = deflateSync(Buffer.alloc(4 * 1024 * 1024 + 1, 32)).toString("base64");
    const body = Buffer.from(JSON.stringify({ status: 1, items })); receive(run.response, body);
    expect((await run.result()).diagnostics).toEqual({ httpStatus: 200, applicationStatus: 1,
      responseBytes: body.length, reason: "invalid-items", contextRevision: 17, contextAgeMs: 3_500,
      requestContext: expectedRequestContext(evidence.checksumVectors[0]), dispatchStatus: "submitted" });
  });

  test("timeout retains the dispatched mode/provenance and never returns arbitrary network text", async () => {
    const run = await entry(context(evidence.checksumVectors[2]));
    run.outgoing.emit("timeout");
    const result = await run.result();
    expect(result).toEqual({ response: { ok: false, errorCode: "timed_out" }, diagnostics: { reason: "timeout",
      contextRevision: 17, contextAgeMs: 3_500, requestContext: expectedRequestContext(evidence.checksumVectors[2]), dispatchStatus: "submitted" } });
    expect(run.outgoing.destroy).toHaveBeenCalledTimes(1); expectNoSecrets(result, run.form);
  });

  test.each([
    { code: "CERT_HAS_EXPIRED", reason: "tls" },
    { code: "ENOTFOUND", reason: "dns" },
    { code: "ECONNRESET", reason: "connection" },
  ])("$code carries the same safe dispatched context on a network failure", async ({ code, reason }) => {
    const run = await entry();
    run.outgoing.emit("error", Object.assign(new Error("SYNTHETIC-WORKER-UID private connection details"), { code }));
    const result = await run.result();
    expect(result).toEqual({ response: { ok: false, errorCode: "market_unreachable" }, diagnostics: { reason,
      contextRevision: 17, contextAgeMs: 3_500, requestContext: expectedRequestContext(evidence.checksumVectors[0]), dispatchStatus: "submitted" } });
    expectNoSecrets(result, run.form);
  });

  test("synchronous HTTPS setup failure keeps the final safe request context without raw exception text", async () => {
    vi.resetModules(); bridge.post.mockClear(); bridge.request.mockReset();
    bridge.data = { context: context(), request: droppedItemRequest };
    bridge.request.mockImplementation(() => { throw new Error("SYNTHETIC-WORKER-UID private setup detail"); });
    await import("../../src/main/market-direct-search-worker");
    await vi.waitFor(() => expect(terminalResults()).toHaveLength(1));
    expect(progressMessages().map(message => message.diagnostics.dispatchStatus)).toEqual(["unconfirmed"]);
    expect(terminalResults()[0]).toEqual({ response: { ok: false, errorCode: "helper_unavailable" },
      diagnostics: { reason: "worker", contextRevision: 17, contextAgeMs: 3_500,
        requestContext: expectedRequestContext(evidence.checksumVectors[0]), dispatchStatus: "unconfirmed" } });
  });

  test("request.end failure retains built-form evidence but never claims local submission", async () => {
    vi.resetModules(); bridge.post.mockClear(); bridge.request.mockReset();
    bridge.data = { context: context(), request: droppedItemRequest };
    const request = new FakeRequest();
    request.end.mockImplementation(() => { throw new Error("SYNTHETIC-WORKER-UID private end detail"); });
    bridge.request.mockReturnValue(request);
    await import("../../src/main/market-direct-search-worker");
    await vi.waitFor(() => expect(terminalResults()).toHaveLength(1));
    expect(progressMessages().map(message => message.diagnostics.dispatchStatus)).toEqual(["unconfirmed"]);
    expect(terminalResults()[0]).toEqual({ response: { ok: false, errorCode: "helper_unavailable" },
      diagnostics: { reason: "worker", contextRevision: 17, contextAgeMs: 3_500,
        requestContext: expectedRequestContext(evidence.checksumVectors[0]), dispatchStatus: "unconfirmed" } });
    expect(request.destroy).toHaveBeenCalledTimes(1);
  });
});
