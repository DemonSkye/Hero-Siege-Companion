import { sanitizeMarketSearchResult, type MarketSearchRequest, type MarketSearchResult } from "../shared/market-search";

export const MARKET_RESULT_CACHE_TTL_MS = 30_000;
export const MARKET_RESULT_CACHE_MAX_ENTRIES = 64;

interface CacheEntry {
  result: MarketSearchResult;
  observedAt: number;
  expiresAt: number;
}

/** Session-local sanitized result cache. It never stores request credentials or seller data. */
export class MarketResultCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = MARKET_RESULT_CACHE_TTL_MS,
    private readonly maxEntries = MARKET_RESULT_CACHE_MAX_ENTRIES,
  ) {}

  key(scopeKey: string, request: MarketSearchRequest): string {
    return JSON.stringify([
      scopeKey,
      request.itemMask,
      request.minSockets ?? null,
      request.statFilters.map((filter) => [filter.statId, filter.minimum]),
    ]);
  }

  get(key: string): { result: MarketSearchResult; observedAt: number } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { result: sanitizeMarketSearchResult(entry.result), observedAt: entry.observedAt };
  }

  set(key: string, result: MarketSearchResult, observedAt = this.now()): void {
    this.entries.delete(key);
    this.entries.set(key, {
      result: sanitizeMarketSearchResult(result),
      observedAt,
      expiresAt: observedAt + this.ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
