import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CompleteCapturedSessionContext } from "../../src/main/captured-session-context";
import { DirectMarketSearchProvider, type DirectMarketContextSource } from "../../src/main/direct-market-search-provider";
import { MarketResultCache } from "../../src/main/market-result-cache";
import { MarketRecordEvidenceStore } from "../../src/main/market-record-evidence";
import { buildMarketRequestDiagnostics } from "../../src/main/market-request-diagnostics";

const mock = vi.hoisted(() => ({
  workers: [] as Array<EventEmitter & { terminate: ReturnType<typeof vi.fn>; options: unknown }>,
  constructionFails: false,
}));
vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  const { EventEmitter } = await import("node:events");
  const replacement = { ...actual, Worker: class extends EventEmitter {
    terminate = vi.fn(async () => { this.emit("exit", 0); return 0; });
    options: unknown;
    constructor(_filename: string, options: unknown) {
      super();
      if (mock.constructionFails) throw new Error("SYNTHETIC worker startup detail");
      this.options = options; mock.workers.push(this);
    }
  } };
  return { ...replacement, default: replacement };
});

afterEach(() => {
  mock.workers.length = 0;
  mock.constructionFails = false;
  vi.useRealTimers();
});

const request = { itemMask: 1_073_746_020, statFilters: [] };
const completeContext: CompleteCapturedSessionContext = {
  generation: 2,
  revision: 3,
  updatedAt: 1,
  endpoint: { address: "203.0.113.10", port: 6668 },
  scopeKey: "scope-a",
  fields: {
    account_id: "na-42",
    unique_account_id: "hero-7",
    crossregion_identifier: "session",
    season: "11",
    hardcore: "0",
    beta: "0",
  },
};

// Deliberately differs from the parent's input mode: only worker-confirmed final-form evidence may be used.
const workerRequestContext = {
  generation: 2, season: "12", hardcore: "1", beta: "1",
  fieldSources: { season: "character-save", hardcore: "character-save", beta: "game-api" },
  accountQualification: "observed-prefix", accountPrefixCoherent: null,
  sameEndpoint: true, sameFlow: true, hardcoreSourcesAgree: null,
  hardcoreApiObserved: false, hardcoreSaveObserved: true,
};
function progress(dispatchStatus: "unconfirmed" | "submitted") {
  return { type: "request-context", diagnostics: {
    contextRevision: 3, contextAgeMs: 29, requestContext: workerRequestContext, dispatchStatus,
  } };
}

function setup(options: {
  prepare?: (signal: AbortSignal) => Promise<void>;
  now?: () => number;
  context?: CompleteCapturedSessionContext | null;
  records?: () => CompleteCapturedSessionContext["diagnosticRecords"];
  privateDiagnostic?: { take: () => string | undefined; finish: (completeResponse: boolean, writeSucceeded?: boolean) => void };
} = {}) {
  let context = options.context === undefined ? completeContext : options.context;
  let listener = () => undefined;
  const source: DirectMarketContextSource = {
    marketContext: () => context,
    ...(options.records ? { marketRecordSnapshot: options.records } : {}),
    subscribe: (next) => { listener = next; return () => { listener = () => undefined; }; },
  };
  const log = vi.fn();
  const now = options.now ?? (() => Date.now());
  const provider = new DirectMarketSearchProvider(source, log, options.prepare, new MarketResultCache(now), now, undefined, options.privateDiagnostic);
  return {
    provider,
    log,
    setContext(next: CompleteCapturedSessionContext | null) { context = next; listener(); },
  };
}

describe("direct-market provider worker boundary", () => {
  test("private opt-in is consumed only for a new worker dispatch and its path never enters safe logs", async () => {
    const take = vi.fn(() => "PRIVATE_PATH_CANARY"), finish = vi.fn();
    const blocked = setup({ context: null, privateDiagnostic: { take, finish } });
    expect((await blocked.provider.search(request)).ok).toBe(false); expect(take).not.toHaveBeenCalled(); blocked.provider.dispose();
    const f = setup({ now: () => 10_000, privateDiagnostic: { take, finish } });
    const pending = f.provider.search(request); await Promise.resolve();
    expect(take).toHaveBeenCalledOnce(); expect(mock.workers[0].options.workerData).toHaveProperty("privateTracePath", "PRIVATE_PATH_CANARY");
    const duplicate = f.provider.search(request); await Promise.resolve(); expect(take).toHaveBeenCalledOnce();
    mock.workers[0].emit("message", { type: "private-diagnostic", completeResponse: true, writeSucceeded: true });
    mock.workers[0].emit("message", { response: { ok: true, result: { listings: [], totalMatches: 0 } }, diagnostics: {} });
    await pending; await duplicate; await f.provider.search(request); expect(take).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(true, true); expect(JSON.stringify(f.log.mock.calls)).not.toContain("PRIVATE_PATH_CANARY");
    f.provider.dispose();
  });
  function evidence() {
    const records = new MarketRecordEvidenceStore();
    records.observe({ text: "", direction: "outbound", remoteAddress: completeContext.endpoint.address,
      remotePort: completeContext.endpoint.port, localAddress: "192.0.2.7", localPort: 5000 },
    { fields: { ...completeContext.fields }, source: "game-api", slot: "4" }, completeContext.generation, 9000);
    return records.freeze(completeContext.generation, 10_000);
  }
  test("freezes context and independent evidence only for a new dispatch, preserving cache/coalescing behavior", async () => {
    const context = structuredClone(completeContext), records = evidence(), snapshot = vi.fn(() => records);
    const { provider } = setup({ context, records: snapshot, now: () => 10_000 });
    const pending = provider.search(request), duplicate = provider.search(request);
    await Promise.resolve();
    const data = (mock.workers[0].options as { workerData: { context: CompleteCapturedSessionContext } }).workerData;
    expect(snapshot).toHaveBeenCalledTimes(1); expect(mock.workers).toHaveLength(1);
    context.fields.unique_account_id = "SYNTHETIC-MUTATED-CONTEXT";
    records.api[0].fields.unique_account_id = "SYNTHETIC-MUTATED-RECORD";
    expect(data.context.fields.unique_account_id).toBe("hero-7");
    expect(data.context.diagnosticRecords?.api[0].fields.unique_account_id).toBe("hero-7");
    mock.workers[0].emit("message", { response: { ok: true, result: { listings: [] } }, diagnostics: {} });
    expect((await pending).ok).toBe(true); expect((await duplicate).ok).toBe(true);
    expect(await provider.search(request)).toMatchObject({ ok: true, cached: true });
    expect(snapshot).toHaveBeenCalledTimes(1); expect(mock.workers).toHaveLength(1); provider.dispose();
  });
  test.each(["cancel", "timeout", "error", "exit", "context-change", "dispose"] as const)(
    "%s retains only worker-reported per-record booleans after submission", async outcome => {
      vi.useFakeTimers();
      const { provider, log, setContext } = setup({ records: evidence, now: () => 10_000 });
      const abort = new AbortController(), pending = provider.search(request, { signal: abort.signal });
      await Promise.resolve();
      const worker = mock.workers[0], data = (worker.options as { workerData: { context: CompleteCapturedSessionContext } }).workerData;
      const requestContext = buildMarketRequestDiagnostics(data.context, new URLSearchParams(data.context.fields).toString());
      worker.emit("message", { type: "request-context", diagnostics: { requestContext, dispatchStatus: "submitted" } });
      if (outcome === "cancel") abort.abort();
      else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(20_000);
      else if (outcome === "error") worker.emit("error", new Error("SYNTHETIC private failure"));
      else if (outcome === "exit") worker.emit("exit", 1);
      else if (outcome === "context-change") setContext({ ...completeContext, revision: 4, scopeKey: "scope-b" });
      else provider.dispose();
      expect((await pending).ok).toBe(false);
      const result = log.mock.calls.find(([type]) => type === "market-direct-result")![1];
      expect(result).toMatchObject({ dispatchStatus: "submitted", requestContext: { recordComparison: {
        api: [{ equalToRequest: { unique_account_id: true, crossregion_identifier: true, season: true } }],
      } } });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/hero-7|na-42|203\.0\.113\.10|192\.0\.2\.7|SYNTHETIC|scope-a|scope-b/);
      provider.dispose();
    },
  );
  test("an injected runner gets the same frozen records but cannot invent final-form evidence", async () => {
    const context = structuredClone(completeContext), records = evidence(), log = vi.fn();
    let supplied!: CompleteCapturedSessionContext, finish!: (value: { response: { ok: false; errorCode: "helper_unavailable" }; diagnostics: {} }) => void;
    const provider = new DirectMarketSearchProvider({ marketContext: () => context, marketRecordSnapshot: () => records,
      subscribe: () => () => undefined }, log, undefined, undefined, () => 10_000,
    async snapshot => { supplied = snapshot; return await new Promise(resolve => { finish = resolve; }); });
    const pending = provider.search(request); await Promise.resolve();
    records.api[0].fields.unique_account_id = "SYNTHETIC-REPLACEMENT"; context.fields.unique_account_id = "SYNTHETIC-REPLACEMENT";
    expect(supplied.fields.unique_account_id).toBe("hero-7"); expect(supplied.diagnosticRecords?.api[0].fields.unique_account_id).toBe("hero-7");
    finish({ response: { ok: false, errorCode: "helper_unavailable" }, diagnostics: {} });
    expect((await pending).ok).toBe(false);
    const result = log.mock.calls.find(([type]) => type === "market-direct-result")![1];
    expect(result).not.toHaveProperty("requestContext"); expect(JSON.stringify(log.mock.calls)).not.toMatch(/SYNTHETIC|hero-7|na-42/);
    provider.dispose();
  });
  test("passes only an in-memory context snapshot to the worker and logs safe diagnostics", async () => {
    let now = 10_000;
    const { provider, log } = setup({ now: () => now });
    const pending = provider.search(request);
    await Promise.resolve();
    expect((mock.workers[0].options as { workerData: unknown }).workerData).toEqual({ context: completeContext, request });
    mock.workers[0].emit("message", {
      response: { ok: false, errorCode: "cached_request_rejected" },
      diagnostics: { reason: "server-rejected", httpStatus: 200, applicationStatus: 0, serverReason: "checksum", contextRevision: 3 },
    });
    expect(await pending).toEqual({ ok: false, errorCode: "cached_request_rejected", nextAllowedSearchAt: 25_000 });
    expect(log).toHaveBeenCalledWith("market-direct-result", expect.objectContaining({
      attempt: 1, reason: "server-rejected", contextRevision: 3,
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("hero-7");
  });

  test("does not consume cooldown when context or metadata is unavailable", async () => {
    let now = 1_000;
    const prepare = vi.fn(async () => { throw new Error("offline"); });
    const { provider } = setup({ context: null, prepare, now: () => now });
    await expect(provider.search(request)).resolves.toEqual({ ok: false, errorCode: "template_unavailable" });
    now += 1;
    await expect(provider.search(request)).resolves.toEqual({ ok: false, errorCode: "template_unavailable" });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(mock.workers).toHaveLength(0);
  });

  test("coalesces an identical pending request and blocks a different one", async () => {
    const { provider } = setup();
    const first = provider.search(request);
    const duplicate = provider.search(request);
    await Promise.resolve();
    await expect(provider.search({ ...request, itemMask: request.itemMask + 1 })).resolves.toEqual({
      ok: false, errorCode: "search_pending",
    });
    expect(mock.workers).toHaveLength(1);
    mock.workers[0].emit("message", { response: { ok: true, result: { listings: [{ price: 10 }] } }, diagnostics: {} });
    await expect(first).resolves.toMatchObject({ ok: true, cached: false });
    await expect(duplicate).resolves.toMatchObject({ ok: true, cached: false });
  });

  test("serves a sanitized cache hit without dispatch or a new cooldown", async () => {
    let now = 5_000;
    const { provider } = setup({ now: () => now });
    const first = provider.search(request);
    await Promise.resolve();
    mock.workers[0].emit("message", {
      response: { ok: true, result: { listings: [{ price: 100, seller: "private" }, { price: 50 }] } }, diagnostics: {},
    });
    await expect(first).resolves.toMatchObject({ ok: true, cached: false, observedAt: 5_000, nextAllowedSearchAt: 20_000 });
    now = 5_001;
    await expect(provider.search(request)).resolves.toEqual({
      ok: true,
      result: { listings: [{ price: 50 }, { price: 100 }] },
      observedAt: 5_000,
      cached: true,
    });
    expect(mock.workers).toHaveLength(1);
  });

  test("rejects a worker result after account context changes", async () => {
    const { provider, setContext } = setup();
    const pending = provider.search(request);
    await Promise.resolve();
    setContext({ ...completeContext, revision: 4, scopeKey: "scope-b" });
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: "template_unavailable" });
    expect(mock.workers[0].terminate).toHaveBeenCalled();
  });

  test("bounds the worker wait and never retries", async () => {
    vi.useFakeTimers();
    const { provider, log } = setup();
    const pending = provider.search(request);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: "timed_out" });
    expect(log).toHaveBeenCalledWith("market-direct-result", expect.objectContaining({ reason: "timeout" }));
    expect(mock.workers).toHaveLength(1);
  });

  test.each(["cancel", "timeout", "error", "exit", "context-change", "dispose"] as const)(
    "%s without worker progress reports dispatch unconfirmed without guessing final-form mode", async outcome => {
      vi.useFakeTimers();
      const { provider, log, setContext } = setup({ now: () => 10_000 });
      const abort = new AbortController(), pending = provider.search(request, { signal: abort.signal });
      await Promise.resolve();
      const worker = mock.workers[0];
      if (outcome === "cancel") abort.abort();
      else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(20_000);
      else if (outcome === "error") worker.emit("error", new Error("SYNTHETIC worker private error"));
      else if (outcome === "exit") worker.emit("exit", 1);
      else if (outcome === "context-change") setContext({ ...completeContext, revision: 4, scopeKey: "scope-b" });
      else provider.dispose();
      expect((await pending).ok).toBe(false);
      const result = log.mock.calls.find(([type]) => type === "market-direct-result")![1];
      expect(result).toMatchObject({ dispatchStatus: "unconfirmed" });
      expect(result).not.toHaveProperty("requestContext");
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(log.mock.calls.filter(([type]) => type === "market-direct-result")).toHaveLength(1);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/hero-7|na-42|203\.0\.113\.10|SYNTHETIC|scope-a|scope-b/);
    },
  );

  test.each(["cancel", "timeout", "error", "exit", "context-change", "dispose"] as const)(
    "%s preserves worker-supplied final-form mode after local submission", async outcome => {
      vi.useFakeTimers();
      const { provider, log, setContext } = setup({ now: () => 10_000 });
      const abort = new AbortController(), pending = provider.search(request, { signal: abort.signal });
      await Promise.resolve();
      const worker = mock.workers[0];
      worker.emit("message", progress("submitted"));
      await Promise.resolve();
      expect(log.mock.calls.filter(([type]) => type === "market-direct-result")).toHaveLength(0);
      if (outcome === "cancel") abort.abort();
      else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(20_000);
      else if (outcome === "error") worker.emit("error", new Error("SYNTHETIC worker private error"));
      else if (outcome === "exit") worker.emit("exit", 1);
      else if (outcome === "context-change") setContext({ ...completeContext, revision: 4, scopeKey: "scope-b" });
      else provider.dispose();
      expect((await pending).ok).toBe(false);
      const result = log.mock.calls.find(([type]) => type === "market-direct-result")![1];
      expect(result).toMatchObject({ contextRevision: 3, contextAgeMs: 29,
        dispatchStatus: "submitted", requestContext: workerRequestContext });
      if (outcome === "context-change" || outcome === "dispose") expect(result.reason).toBe("stale-context");
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      worker.emit("message", { response: { ok: true, result: { listings: [] } }, diagnostics: {} });
      await vi.advanceTimersByTimeAsync(25_000);
      expect(log.mock.calls.filter(([type]) => type === "market-direct-result")).toHaveLength(1);
      expect(mock.workers).toHaveLength(1);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/hero-7|na-42|203\.0\.113\.10|SYNTHETIC|scope-a|scope-b/);
    },
  );

  test("prepared final-form progress survives cancellation while dispatch stays unconfirmed", async () => {
    const { provider, log } = setup();
    const abort = new AbortController(), pending = provider.search(request, { signal: abort.signal });
    await Promise.resolve(); mock.workers[0].emit("message", progress("unconfirmed"));
    abort.abort(); expect((await pending).ok).toBe(false);
    expect(log).toHaveBeenCalledWith("market-direct-result", expect.objectContaining({
      dispatchStatus: "unconfirmed", requestContext: workerRequestContext,
    }));
  });

  test("worker construction failure has no final-form evidence and explicitly unconfirmed dispatch", async () => {
    mock.constructionFails = true;
    const { provider, log } = setup();
    await expect(provider.search(request)).resolves.toMatchObject({ ok: false, errorCode: "helper_unavailable" });
    const result = log.mock.calls.find(([type]) => type === "market-direct-result")![1];
    expect(result).toMatchObject({ reason: "worker", dispatchStatus: "unconfirmed" });
    expect(result).not.toHaveProperty("requestContext");
    expect(mock.workers).toHaveLength(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("SYNTHETIC");
  });

  test("progress cannot finish a search and final worker diagnostics take precedence", async () => {
    const { provider, log } = setup(); const pending = provider.search(request);
    await Promise.resolve(); const worker = mock.workers[0];
    worker.emit("message", progress("unconfirmed"));
    expect(worker.terminate).not.toHaveBeenCalled();
    const finalContext = { ...workerRequestContext, season: "0" };
    worker.emit("message", { response: { ok: false, errorCode: "checksum_rejected" }, diagnostics: {
      ...progress("submitted").diagnostics, requestContext: finalContext, reason: "server-rejected", serverReason: "checksum",
    } });
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: "checksum_rejected" });
    expect(log).toHaveBeenCalledWith("market-direct-result", expect.objectContaining({
      dispatchStatus: "submitted", requestContext: finalContext, reason: "server-rejected",
    }));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  test("an unsupported progress marker cannot settle the search or enter final diagnostics", async () => {
    const { provider, log } = setup(); const abort = new AbortController();
    const pending = provider.search(request, { signal: abort.signal }); await Promise.resolve();
    mock.workers[0].emit("message", { type: "unsupported", diagnostics: { body: "SYNTHETIC private body" } });
    expect(mock.workers[0].terminate).not.toHaveBeenCalled();
    abort.abort(); await pending;
    expect(log).toHaveBeenCalledWith("market-direct-result", expect.objectContaining({ dispatchStatus: "unconfirmed" }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SYNTHETIC|body/);
  });
});
