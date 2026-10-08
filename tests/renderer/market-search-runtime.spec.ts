import { describe, expect, test, vi } from "vitest";
import { ref } from "vue";
import {
  MARKET_SEARCH_MAX_STAT_FILTERS,
  MARKET_STAT_OPTIONS,
  resolveMarketItemMask,
  type MarketSearchResponse,
} from "../../src/shared/market-search";
import {
  MARKET_STAT_SUGGESTION_LIMIT,
  marketStatSuggestions,
  canSearchMarketForTimelineItem,
  useMarketSearchRuntime as createMarketSearchRuntime,
  type MarketSearchRuntimeOptions,
} from "../../src/renderer/src/lib/market-search-runtime";
import { companionState, itemTimelineEntry } from "./fixtures";
import { EXPECTED_RUNEWORD_REPOSITORY_IDS } from "../fixtures/runeword-market-permutation";

function useMarketSearchRuntime(options: Omit<MarketSearchRuntimeOptions, "readiness">) {
  return createMarketSearchRuntime({ ...options, readiness: ref(companionState().marketReadiness) });
}


describe("market search runtime", () => {
  test("all 100 native Timeline IDs use the same catalog targets without interpreting them as legacy cases",()=>{
    const searchMarket=vi.fn(),runtime=useMarketSearchRuntime({searchMarket,now:ref(1000)});
    for (const id of EXPECTED_RUNEWORD_REPOSITORY_IDS) {
      const item=itemTimelineEntry({repository:"runeword",id,type:3,weaponType:0,label:"Name is not the lookup key"});
      expect(canSearchMarketForTimelineItem(item)).toBe(true);
      expect(runtime.openMarketSearch(item)).toBe(true);
      expect(runtime.draftRequest.value).toEqual({runewordId:id,statFilters:[]});
    }
    expect(searchMarket).not.toHaveBeenCalled();
  });

  test("Timeline target changes discard stale replies while retaining the pending guard and cooldown",async()=>{
    let settle!: (response:MarketSearchResponse)=>void;
    const searchMarket=vi.fn().mockImplementationOnce(()=>new Promise<MarketSearchResponse>(resolve=>{settle=resolve;}))
      .mockResolvedValue({ok:true,result:{listings:[{price:123}]}});
    const now=ref(1000),runtime=useMarketSearchRuntime({searchMarket,now});
    runtime.openMarketSearch(itemTimelineEntry({repository:"runeword",type:3,id:81,weaponType:0}));
    const pending=runtime.searchMarket();
    expect(searchMarket).toHaveBeenCalledExactlyOnceWith({runewordId:81,statFilters:[]});
    runtime.openMarketSearch(itemTimelineEntry({repository:"normal",type:0,id:0,weaponType:0,label:"Cap"}));
    await runtime.searchMarket();expect(searchMarket).toHaveBeenCalledOnce();
    settle({ok:true,result:{listings:[{price:999}]},nextAllowedSearchAt:16000});await pending;
    expect(runtime.phase.value).toBe("idle");expect(runtime.listings.value).toEqual([]);
    now.value=15000;await runtime.searchMarket();expect(searchMarket).toHaveBeenCalledOnce();
    now.value=16000;await runtime.searchMarket();
    expect(searchMarket.mock.calls[1]).toEqual([{itemMask:0,statFilters:[]}]);
    runtime.openMarketSearch(itemTimelineEntry({repository:"runeword",type:11,id:86,weaponType:0}));
    expect(runtime.listings.value).toEqual([]);
    await runtime.searchMarket();expect(searchMarket.mock.calls[2]).toEqual([{runewordId:86,statFilters:[]}]);
  });

  test.each([0,-1,101,1.5])("unsupported native Timeline runeword ID %s has no shortcut or fallback mask",id=>{
    const runtime=useMarketSearchRuntime({searchMarket:vi.fn(),now:ref(1000)});
    runtime.openMarketSearch(itemTimelineEntry());runtime.updateMinSockets(4);
    const draft=runtime.draftRequest.value;
    const invalid=itemTimelineEntry({repository:"runeword",type:3,id,weaponType:0,label:"Grief"});
    expect(canSearchMarketForTimelineItem(invalid)).toBe(false);
    expect(runtime.openMarketSearch(invalid)).toBe(false);
    expect(runtime.draftRequest.value).toEqual(draft);
  });

  test.each([
    ["Grief",81,3,0],
    ["Codex of the Card Collector",86,11,0],
  ] as const)("Timeline native runeword %s opens an explicit selector draft", async(label,id,type,weaponType)=>{
    // Reconstructed Timeline identity. ID is the native repository ID, not an
    // internal constructor case or a value inferred from the display label.
    const item=itemTimelineEntry({repository:"runeword",id,type,weaponType,label:"Legacy display label"});
    const searchMarket=vi.fn().mockResolvedValue({ok:true,result:{listings:[]}});
    const runtime=useMarketSearchRuntime({searchMarket,now:ref(1000)});
    expect(canSearchMarketForTimelineItem(item)).toBe(true);
    expect(runtime.openMarketSearch(item)).toBe(true);
    expect(runtime.draftRequest.value).toEqual({runewordId:id,statFilters:[]});
    expect(runtime.selectedItem.value?.label).toBe(label);
    expect(searchMarket).not.toHaveBeenCalled();
    await runtime.searchMarket();
    expect(searchMarket).toHaveBeenCalledExactlyOnceWith({runewordId:id,statFilters:[]});
  });

  test("builds a comparable-item request and keeps returned prices sorted", async () => {
    const item = itemTimelineEntry();
    const mask = resolveMarketItemMask({
      repository: item.repository,
      type: item.type,
      id: item.id,
      weaponType: item.weaponType,
    });
    if (!mask.ok) throw new Error(mask.reason);

    const searchMarket = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        listings: [{ price: 300_000 }, { price: 100_000 }, { price: 200_000 }],
        totalMatches: 3,
      },
    });
    const runtime = useMarketSearchRuntime({ searchMarket, now: ref(Date.now()) });

    expect(runtime.openMarketSearch(item)).toBe(true);
    runtime.updateMinSockets(4);
    runtime.addStatFilter(64);
    const filter = runtime.statFilters.value[0];
    runtime.updateStatFilter(filter.key, { minimum: 8 });

    await runtime.searchMarket();

    expect(searchMarket).toHaveBeenCalledWith({
      itemMask: mask.itemMask,
      minSockets: 4,
      statFilters: [{ statId: 64, minimum: 8 }],
    });
    expect(runtime.phase.value).toBe("success");
    expect(runtime.listings.value.map((listing) => listing.price)).toEqual([100_000, 200_000, 300_000]);
    expect(runtime.totalMatches.value).toBe(3);
  });

  test("keeps one request in flight across draft edits, close, and reopen", async () => {
    const item = itemTimelineEntry();
    let settleFirstRequest!: (result: MarketSearchResponse) => void;
    const firstRequestResult = new Promise<MarketSearchResponse>((resolve) => {
      settleFirstRequest = resolve;
    });
    const searchMarket = vi.fn()
      .mockImplementationOnce(() => firstRequestResult)
      .mockResolvedValue({ ok: true, result: { listings: [] } });
    const now = ref(Date.now());
    const runtime = useMarketSearchRuntime({ searchMarket, now });

    runtime.openMarketSearch(item);
    const firstSearch = runtime.searchMarket();
    expect(runtime.searchInFlight.value).toBe(true);

    runtime.updateMinSockets(4);
    await runtime.searchMarket();
    runtime.closeMarketSearch();
    runtime.openMarketSearch(item);
    await runtime.searchMarket();

    expect(searchMarket).toHaveBeenCalledTimes(1);
    expect(runtime.canSearch.value).toBe(false);
    expect(runtime.cooldownRemainingSeconds.value).toBe(0);

    settleFirstRequest({ ok: true, result: { listings: [{ price: 1 }] }, nextAllowedSearchAt: now.value + 15_000 });
    await firstSearch;
    expect(runtime.searchInFlight.value).toBe(false);
    expect(runtime.phase.value).toBe("idle");
    expect(runtime.listings.value).toEqual([]);

    now.value += 14_000;
    expect(runtime.cooldownRemainingSeconds.value).toBe(1);
    await runtime.searchMarket();
    expect(searchMarket).toHaveBeenCalledTimes(1);

    now.value += 1_000;
    expect(runtime.cooldownRemainingSeconds.value).toBe(0);
    await runtime.searchMarket();
    expect(searchMarket).toHaveBeenCalledTimes(2);
  });

  test("keeps the total listing count unknown when the sender omits it", async () => {
    const runtime = useMarketSearchRuntime({
      searchMarket: vi.fn().mockResolvedValue({
        ok: true,
        result: { listings: [{ price: 123 }] },
      }),
      now: ref(Date.now()),
    });

    runtime.openMarketSearch(itemTimelineEntry());
    await runtime.searchMarket();

    expect(runtime.listings.value).toEqual([{ price: 123 }]);
    expect(runtime.totalMatches.value).toBeNull();
  });

  test("caps comparable stat rows at the shared request limit", () => {
    const runtime = useMarketSearchRuntime({
      searchMarket: vi.fn().mockResolvedValue({ ok: true, result: { listings: [] } }),
      now: ref(Date.now()),
    });

    const statIds = MARKET_STAT_OPTIONS.slice(0, MARKET_SEARCH_MAX_STAT_FILTERS + 1).map((option) => option.statId);
    statIds.forEach((statId) => runtime.addStatFilter(statId));
    runtime.addStatFilter(statIds[0]);
    runtime.addStatFilter(999_999);

    expect(runtime.statFilters.value).toHaveLength(MARKET_SEARCH_MAX_STAT_FILTERS);
  });

  test("searches alphabetized displayed stat names with item-filter picker bounds", () => {
    expect(marketStatSuggestions("ma", [])).toEqual([]);

    const manaSuggestions = marketStatSuggestions("MANA", [60]);
    const manaNames = manaSuggestions.map((option) => option.name);
    expect(manaNames).not.toContain("Mana");
    expect(manaNames).toContain("Mana stolen per Hit");
    expect(manaNames).toEqual([...manaNames].sort((left, right) => left.localeCompare(right)));

    expect(marketStatSuggestions("damage", [])).toHaveLength(MARKET_STAT_SUGGESTION_LIMIT);
  });

  test("stat ID lookup survives exact labels and qualified role captions", () => {
    expect(marketStatSuggestions("Stat 291").map(option => option.statId)).toEqual([291]);
    expect(marketStatSuggestions("390").map(option => option.statId)).toEqual([390]);
    expect(marketStatSuggestions("Stat 21").map(option => option.statId)).toEqual([21]);
    expect(marketStatSuggestions("Stat 291", [291])).toEqual([]);
    expect(marketStatSuggestions("Stat 999999")).toEqual([]);
  });

  test.each([
    [
      "template_unavailable",
      "Market context is not ready. Keep Npcap capture running while the game connects so Companion can observe the current account, mode, and session fields.",
    ],
    [
      "helper_unavailable",
      "Companion could not prepare the direct market request. Restart Companion and try again.",
    ],
    [
      "market_unreachable",
      "The market request could not reach the server. Check your connection and try again.",
    ],
    [
      "cached_request_rejected",
      "The market rejected the current request or returned an unreadable response. Keep capture running and refresh your in-game account/market context, then retry. Direct-search details are in the support logs.",
    ],
    [
      "checksum_rejected",
      "The market rejected this request's checksum. Check whether the in-game Auction House works. Keep capture running for fresh account details before retrying; report persistent failures with the support logs.",
    ],
    [
      "search_pending",
      "A market search is already pending. Wait briefly and try again.",
    ],
    [
      "request_rejected",
      "The market rejected these filters. Adjust them and try again.",
    ],
    [
      "timed_out",
      "The market did not respond before the search timed out. Try again.",
    ],
  ] as const)("maps %s to an actionable safe message", async (errorCode, message) => {
    const runtime = useMarketSearchRuntime({
      searchMarket: vi.fn().mockResolvedValue({ ok: false, errorCode }),
      now: ref(Date.now()),
    });
    runtime.openMarketSearch(itemTimelineEntry());

    await runtime.searchMarket();

    expect(runtime.phase.value).toBe("error");
    expect(runtime.listings.value).toEqual([]);
    expect(runtime.totalMatches.value).toBeNull();
    expect(runtime.errorMessage.value).toBe(message);
  });

  test("never displays a thrown helper error", async () => {
    const runtime = useMarketSearchRuntime({
      searchMarket: vi.fn().mockRejectedValue(new Error("multipass=secret seller=account")),
      now: ref(Date.now()),
    });
    runtime.openMarketSearch(itemTimelineEntry());

    await runtime.searchMarket();

    expect(runtime.phase.value).toBe("error");
    expect(runtime.errorMessage.value).toBe(
      "Companion could not prepare the direct market request. Restart Companion and try again.",
    );
    expect(runtime.errorMessage.value).not.toContain("secret");
    expect(runtime.errorMessage.value).not.toContain("seller");
  });
});
