import { computed, ref, type Ref } from "vue";
import {
  MARKET_SEARCH_MAX_STAT_FILTERS,
  MARKET_STAT_OPTIONS,
  marketStatOption,
  normalizeMarketSearchRequest,
  resolveMarketItemMask,
  sanitizeMarketSearchResult,
  type MarketListing,
  type MarketSearchErrorCode,
  type MarketSearchRequest,
  type MarketSearchResponse,
} from "../../../shared/market-search";
import type { ItemTimelineEntry } from "../../../shared/stats";
import type { MarketReadiness } from "../../../shared/market-readiness";
import { normalizeLookupText } from "./text";
import { MARKET_REGION_UNCONFIRMED_DETAIL } from "./market-readiness-display";

export type MarketSearchPhase = "idle" | "searching" | "success" | "error";
export const MARKET_STAT_SUGGESTION_LIMIT = 12;

export interface MarketStatFilterDraft {
  key: string;
  statId: number | null;
  minimum: number | null;
}

export interface MarketSearchRuntimeOptions {
  searchMarket: (request: MarketSearchRequest) => Promise<MarketSearchResponse>;
  now: Readonly<Ref<number>>;
  readiness: Readonly<Ref<MarketReadiness>>;
}

const MARKET_SEARCH_FAILURE_MESSAGES: Record<MarketSearchErrorCode, string> = {
  template_unavailable: "Market context is not ready. Keep Npcap capture running while the game connects so Companion can observe the current account, mode, and session fields.",
  helper_unavailable: "Companion could not prepare the direct market request. Restart Companion and try again.",
  market_unreachable: "The market request could not reach the server. Check your connection and try again.",
  cached_request_rejected: "The market rejected the current request or returned an unreadable response. Keep capture running and refresh your in-game account/market context, then retry. Direct-search details are in the support logs.",
  checksum_rejected: "The market rejected this request's checksum. Check whether the in-game Auction House works. Keep capture running for fresh account details before retrying; report persistent failures with the support logs.",
  search_pending: "A market search is already pending. Wait briefly and try again.",
  request_rejected: "The market rejected these filters. Adjust them and try again.",
  timed_out: "The market did not respond before the search timed out. Try again.",
};

export function useMarketSearchRuntime(options: MarketSearchRuntimeOptions) {
  const selectedItem = ref<ItemTimelineEntry | null>(null);
  const selectedItemMask = ref<number | null>(null);
  const minSockets = ref<number | null>(null);
  const statFilters = ref<MarketStatFilterDraft[]>([]);
  const phase = ref<MarketSearchPhase>("idle");
  const listings = ref<MarketListing[]>([]);
  const totalMatches = ref<number | null>(null);
  const errorMessage = ref("");
  const resultObservedAt = ref<number | null>(null);
  const resultCached = ref(false);
  const searchInFlight = ref(false);
  const nextAllowedSearchAt = ref(0);
  let nextStatFilterKey = 1;
  let requestGeneration = 0;

  const draftValid = computed(() => {
    if (!selectedItem.value || selectedItemMask.value === null) return false;
    if (
      minSockets.value !== null
      && (!Number.isInteger(minSockets.value) || minSockets.value < 1 || minSockets.value > 6)
    ) return false;

    const selectedStatIds = new Set<number>();
    for (const filter of statFilters.value) {
      if (
        filter.statId === null
        || filter.minimum === null
        || !Number.isFinite(filter.minimum)
        || !marketStatOption(filter.statId)
        || selectedStatIds.has(filter.statId)
      ) return false;
      selectedStatIds.add(filter.statId);
    }
    return true;
  });

  const cooldownRemainingSeconds = computed(() => Math.max(
    0,
    Math.ceil((nextAllowedSearchAt.value - options.now.value) / 1_000),
  ));
  const canSearch = computed(() => (
    draftValid.value
    && options.readiness.value.canSearch
    && !searchInFlight.value
    && cooldownRemainingSeconds.value === 0
  ));

  function openMarketSearch(item: ItemTimelineEntry): boolean {
    const resolution = marketItemMaskForTimelineItem(item);
    if (!resolution.ok) return false;

    requestGeneration += 1;
    selectedItem.value = item;
    selectedItemMask.value = resolution.itemMask;
    minSockets.value = null;
    statFilters.value = [];
    resetResult();
    return true;
  }

  function closeMarketSearch(): void {
    requestGeneration += 1;
    selectedItem.value = null;
    selectedItemMask.value = null;
    minSockets.value = null;
    statFilters.value = [];
    resetResult();
  }

  function updateMinSockets(value: number | null): void {
    minSockets.value = value;
    markDraftChanged();
  }

  function addStatFilter(statId: number): void {
    if (statFilters.value.length >= MARKET_SEARCH_MAX_STAT_FILTERS) return;
    if (!marketStatOption(statId) || statFilters.value.some((filter) => filter.statId === statId)) return;
    statFilters.value = [
      ...statFilters.value,
      { key: `market-stat-${nextStatFilterKey++}`, statId, minimum: null },
    ];
    markDraftChanged();
  }

  function updateStatFilter(key: string, patch: Partial<Pick<MarketStatFilterDraft, "statId" | "minimum">>): void {
    statFilters.value = statFilters.value.map((filter) => filter.key === key ? { ...filter, ...patch } : filter);
    markDraftChanged();
  }

  function removeStatFilter(key: string): void {
    statFilters.value = statFilters.value.filter((filter) => filter.key !== key);
    markDraftChanged();
  }

  async function searchMarket(): Promise<void> {
    if (!canSearch.value || selectedItemMask.value === null) return;

    const normalized = normalizeMarketSearchRequest({
      itemMask: selectedItemMask.value,
      ...(minSockets.value === null ? {} : { minSockets: minSockets.value }),
      statFilters: statFilters.value.map((filter) => ({
        statId: filter.statId as number,
        minimum: filter.minimum as number,
      })),
    });
    if (!normalized.ok) {
      phase.value = "error";
      errorMessage.value = "Choose valid market filters before searching.";
      return;
    }

    const currentRequestGeneration = ++requestGeneration;
    searchInFlight.value = true;
    phase.value = "searching";
    listings.value = [];
    totalMatches.value = null;
    errorMessage.value = "";

    try {
      const response = await options.searchMarket(normalized.request);
      if (response.nextAllowedSearchAt !== undefined) {
        nextAllowedSearchAt.value = Math.max(nextAllowedSearchAt.value, response.nextAllowedSearchAt);
      }
      if (currentRequestGeneration !== requestGeneration) return;
      if (!response.ok) {
        showSearchFailure(response.errorCode);
        return;
      }
      const result = sanitizeMarketSearchResult(response.result);
      listings.value = result.listings;
      totalMatches.value = result.totalMatches ?? null;
      resultObservedAt.value = response.observedAt ?? options.now.value;
      resultCached.value = response.cached === true;
      phase.value = "success";
    } catch {
      if (currentRequestGeneration !== requestGeneration) return;
      showSearchFailure("helper_unavailable");
    } finally {
      searchInFlight.value = false;
    }
  }

  function showSearchFailure(errorCode: MarketSearchErrorCode): void {
    listings.value = [];
    totalMatches.value = null;
    resultObservedAt.value = null;
    resultCached.value = false;
    const readiness = options.readiness.value;
    // Lookup replies can precede the throttled readiness broadcast. Coherent
    // captured fields already distinguish region preparation from collection.
    errorMessage.value = errorCode === "template_unavailable" && readiness.missingFields.length === 0
      && readiness.sessionCurrent && !readiness.regionQualified
      ? MARKET_REGION_UNCONFIRMED_DETAIL
      : MARKET_SEARCH_FAILURE_MESSAGES[errorCode];
    phase.value = "error";
  }

  function resetResult(): void {
    phase.value = "idle";
    listings.value = [];
    totalMatches.value = null;
    resultObservedAt.value = null;
    resultCached.value = false;
    errorMessage.value = "";
  }

  function markDraftChanged(): void {
    requestGeneration += 1;
    resetResult();
  }

  return {
    selectedItem,
    minSockets,
    statFilters,
    phase,
    listings,
    totalMatches,
    errorMessage,
    resultObservedAt,
    resultCached,
    searchInFlight,
    cooldownRemainingSeconds,
    canSearch,
    openMarketSearch,
    closeMarketSearch,
    updateMinSockets,
    addStatFilter,
    updateStatFilter,
    removeStatFilter,
    searchMarket,
  };
}

export function marketStatSuggestions(query: string, excludedStatIds: readonly number[] = []) {
  const normalizedQuery = normalizeLookupText(query);
  if (normalizedQuery.length < 3) return [];

  const excluded = new Set(excludedStatIds);
  return MARKET_STAT_OPTIONS
    .filter((option) => !excluded.has(option.statId) && normalizeLookupText(option.name).includes(normalizedQuery))
    .slice(0, MARKET_STAT_SUGGESTION_LIMIT);
}

export function canSearchMarketForTimelineItem(item: ItemTimelineEntry): boolean {
  return marketItemMaskForTimelineItem(item).ok;
}

function marketItemMaskForTimelineItem(item: ItemTimelineEntry) {
  return resolveMarketItemMask({
    repository: item.repository,
    type: item.type,
    id: item.id,
    weaponType: item.weaponType,
  });
}
