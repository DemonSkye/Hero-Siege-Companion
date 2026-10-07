import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  MARKET_SEARCH_COOLDOWN_MS,
  normalizeMarketSearchRequest,
  type MarketSearchRequest,
  type MarketSearchResponse,
} from "../shared/market-search";
import type { CompleteCapturedSessionContext } from "./captured-session-context";
import { directMarketFailure, type DirectMarketDiagnostics, type DirectMarketWorkerMessage,
  type DirectMarketWorkerResult } from "./market-direct-response";
import { MarketResultCache } from "./market-result-cache";
import type { MarketSearchOptions, MarketSearchProvider } from "./market-search-provider";

const WORKER_TIMEOUT_MS = 20_000;

export interface DirectMarketContextSource {
  marketContext(): CompleteCapturedSessionContext | null;
  subscribe(listener: () => void): () => void;
  marketProvenance?(): CompleteCapturedSessionContext["provenance"];
}

interface ActiveSearch {
  key: string;
  promise: Promise<MarketSearchResponse>;
}

export type DirectMarketWorkerRunner = (
  context: CompleteCapturedSessionContext,
  request: MarketSearchRequest,
  signal?: AbortSignal,
) => Promise<DirectMarketWorkerResult>;

export class DirectMarketSearchProvider implements MarketSearchProvider {
  private nextAllowedSearchAt = 0;
  private activeWorker: { worker: Worker; cancel: () => void } | null = null;
  private activeSearch: ActiveSearch | null = null;
  private attempt = 0;
  private generation = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly contextSource: DirectMarketContextSource,
    private readonly log: (type: string, data: Record<string, unknown>) => void = () => undefined,
    private readonly prepareContext: (signal: AbortSignal) => Promise<void> = () => Promise.resolve(),
    private readonly cache = new MarketResultCache(),
    private readonly now: () => number = Date.now,
    private readonly workerRunner?: DirectMarketWorkerRunner,
  ) {
    this.unsubscribe = contextSource.subscribe(() => this.invalidateContext());
  }

  async search(request: MarketSearchRequest, options: MarketSearchOptions = {}): Promise<MarketSearchResponse> {
    const normalized = normalizeMarketSearchRequest(request);
    if (!normalized.ok) return { ok: false, errorCode: "request_rejected" };
    if (options.signal?.aborted) return { ok: false, errorCode: "helper_unavailable" };

    const preparationAbort = new AbortController();
    const abortPreparation = () => preparationAbort.abort();
    options.signal?.addEventListener("abort", abortPreparation, { once: true });
    try {
      await this.prepareContext(preparationAbort.signal);
    } catch {
      if (options.signal?.aborted) return { ok: false, errorCode: "helper_unavailable" };
      this.log("market-direct-blocked", { reason: "metadata-unavailable" });
    } finally {
      options.signal?.removeEventListener("abort", abortPreparation);
    }

    const context = this.contextSource.marketContext();
    if (!context) {
      this.log("market-direct-blocked", { reason: "context-unavailable", provenance: this.contextSource.marketProvenance?.() });
      return { ok: false, errorCode: "template_unavailable" };
    }

    const key = this.cache.key(context.scopeKey, normalized.request);
    const cached = this.cache.get(key);
    if (cached) {
      this.log("market-result-cache", { status: "hit", ageMs: Math.max(0, this.now() - cached.observedAt) });
      return { ok: true, result: cached.result, observedAt: cached.observedAt, cached: true };
    }
    if (this.activeSearch) {
      if (this.activeSearch.key === key) return await this.activeSearch.promise;
      return { ok: false, errorCode: "search_pending" };
    }
    if (this.now() < this.nextAllowedSearchAt) {
      return { ok: false, errorCode: "search_pending", nextAllowedSearchAt: this.nextAllowedSearchAt };
    }

    this.nextAllowedSearchAt = this.now() + MARKET_SEARCH_COOLDOWN_MS;
    const promise = this.executeSearch(context, key, normalized.request, options.signal);
    this.activeSearch = { key, promise };
    try {
      return await promise;
    } finally {
      if (this.activeSearch?.promise === promise) this.activeSearch = null;
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.invalidateContext();
  }

  private async executeSearch(
    context: CompleteCapturedSessionContext,
    key: string,
    request: MarketSearchRequest,
    signal?: AbortSignal,
  ): Promise<MarketSearchResponse> {
    const generation = this.generation;
    const attempt = ++this.attempt;
    const startedAt = this.now();
    this.log("market-direct-start", { attempt, contextGeneration: context.generation, contextRevision: context.revision });
    const result = await (this.workerRunner
      ? this.workerRunner(context, request, signal)
      : this.runWorker(context, request, signal));
    const diagnostics: DirectMarketDiagnostics = { dispatchStatus: "unconfirmed", ...result.diagnostics };
    const current = this.contextSource.marketContext();
    if (generation !== this.generation || !current || current.revision !== context.revision
      || current.generation !== context.generation || current.scopeKey !== context.scopeKey) {
      this.log("market-direct-result", { attempt, ...diagnostics, durationMs: this.now() - startedAt, ok: false, reason: "stale-context" });
      return { ok: false, errorCode: "template_unavailable", nextAllowedSearchAt: this.nextAllowedSearchAt };
    }
    this.log("market-direct-result", {
      attempt,
      durationMs: this.now() - startedAt,
      ...diagnostics,
      ok: result.response.ok,
      errorCode: result.response.ok ? undefined : result.response.errorCode,
      listingCount: result.response.ok ? result.response.result.listings.length : undefined,
      totalMatches: result.response.ok ? result.response.result.totalMatches : undefined,
    });
    if (!result.response.ok) return { ...result.response, nextAllowedSearchAt: this.nextAllowedSearchAt };
    const observedAt = this.now();
    this.cache.set(key, result.response.result, observedAt);
    return {
      ...result.response,
      observedAt,
      cached: false,
      nextAllowedSearchAt: this.nextAllowedSearchAt,
    };
  }

  private invalidateContext(): void {
    this.generation += 1;
    this.cache.clear();
    this.activeWorker?.cancel();
  }

  private runWorker(
    context: CompleteCapturedSessionContext,
    request: MarketSearchRequest,
    signal?: AbortSignal,
  ): Promise<DirectMarketWorkerResult> {
    return new Promise((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(path.join(__dirname, "market-direct-search-worker.js"), {
          workerData: { context, request },
        });
      } catch {
        resolve(directMarketFailure("worker", { dispatchStatus: "unconfirmed" }));
        return;
      }
      let settled = false;
      let progress: DirectMarketDiagnostics = { dispatchStatus: "unconfirmed" };
      const finish = (result: DirectMarketWorkerResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        worker.removeListener("message", onMessage);
        if (this.activeWorker?.worker === worker) this.activeWorker = null;
        void worker.terminate();
        resolve({ ...result, diagnostics: { ...progress, ...result.diagnostics } });
      };
      const onMessage = (message: DirectMarketWorkerMessage) => {
        if (settled) return;
        if ("type" in message) {
          if (message.type === "request-context") progress = { ...message.diagnostics };
          return;
        }
        finish(message);
      };
      const onAbort = () => finish(directMarketFailure("cancelled"));
      const timeout = setTimeout(() => finish(directMarketFailure("timeout")), WORKER_TIMEOUT_MS);
      this.activeWorker = { worker, cancel: onAbort };
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.on("message", onMessage);
      worker.once("error", () => finish(directMarketFailure("worker")));
      worker.once("exit", () => finish(directMarketFailure("worker")));
      if (signal?.aborted) onAbort();
    });
  }
}
