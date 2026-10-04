import type {
  MarketSearchRequest,
  MarketSearchResponse,
} from "../shared/market-search";

export interface MarketSearchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Main-process transport boundary. Responses are safe to return over IPC and
 * deliberately contain no relay correlation, authenticated request, or seller data.
 */
export interface MarketSearchProvider {
  search(
    request: MarketSearchRequest,
    options?: MarketSearchOptions,
  ): Promise<MarketSearchResponse>;
  dispose(): void;
}
