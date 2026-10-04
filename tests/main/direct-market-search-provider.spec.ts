import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CompleteCapturedSessionContext } from "../../src/main/captured-session-context";
import { DirectMarketSearchProvider, type DirectMarketContextSource } from "../../src/main/direct-market-search-provider";
import { MarketResultCache } from "../../src/main/market-result-cache";

const mock = vi.hoisted(() => ({
  workers: [] as Array<EventEmitter & { terminate: ReturnType<typeof vi.fn>; options: unknown }>,
}));
vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  const { EventEmitter } = await import("node:events");
  const replacement = { ...actual, Worker: class extends EventEmitter {
    terminate = vi.fn(async () => { this.emit("exit", 0); return 0; });
    options: unknown;
    constructor(_filename: string, options: unknown) { super(); this.options = options; mock.workers.push(this); }
  } };
  return { ...replacement, default: replacement };
});

afterEach(() => {
  mock.workers.length = 0;
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

function setup(options: {
  prepare?: (signal: AbortSignal) => Promise<void>;
  now?: () => number;
  context?: CompleteCapturedSessionContext | null;
} = {}) {
  let context = options.context === undefined ? completeContext : options.context;
  let listener = () => undefined;
  const source: DirectMarketContextSource = {
    marketContext: () => context,
    subscribe: (next) => { listener = next; return () => { listener = () => undefined; }; },
  };
  const log = vi.fn();
  const now = options.now ?? (() => Date.now());
  const provider = new DirectMarketSearchProvider(source, log, options.prepare, new MarketResultCache(now), now);
  return {
    provider,
    log,
    setContext(next: CompleteCapturedSessionContext | null) { context = next; listener(); },
  };
}

describe("direct-market provider worker boundary", () => {
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
});
