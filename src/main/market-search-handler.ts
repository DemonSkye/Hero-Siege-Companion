import { normalizeMarketSearchRequest, sanitizeMarketSearchResult, type MarketSearchResponse } from "../shared/market-search";
import type { MarketSearchProvider } from "./market-search-provider";

const ERROR_CODES = new Set([
  "template_unavailable", "helper_unavailable", "market_unreachable", "cached_request_rejected",
  "checksum_rejected", "search_pending", "request_rejected", "timed_out",
]);

/** Explicit IPC capability: main-only provider in, allowlisted display result out. */
export async function handleMarketSearchRequest(request: unknown, provider: MarketSearchProvider | null): Promise<MarketSearchResponse> {
  const normalized = normalizeMarketSearchRequest(request);
  if (!normalized.ok) return { ok: false, errorCode: "request_rejected" };
  if (!provider) return { ok: false, errorCode: "helper_unavailable" };
  try {
    const response = await provider.search(normalized.request);
    const timing = typeof response.nextAllowedSearchAt === "number" && Number.isSafeInteger(response.nextAllowedSearchAt) && response.nextAllowedSearchAt >= 0
      ? { nextAllowedSearchAt: response.nextAllowedSearchAt } : {};
    if (!response.ok) return { ok: false, errorCode: ERROR_CODES.has(response.errorCode) ? response.errorCode : "helper_unavailable", ...timing };
    return {
      ok: true, result: sanitizeMarketSearchResult(response.result), ...timing,
      ...(typeof response.observedAt === "number" && Number.isSafeInteger(response.observedAt) && response.observedAt >= 0
        ? { observedAt: response.observedAt } : {}),
      ...(typeof response.cached === "boolean" ? { cached: response.cached } : {}),
    };
  } catch {
    return { ok: false, errorCode: "helper_unavailable" };
  }
}
