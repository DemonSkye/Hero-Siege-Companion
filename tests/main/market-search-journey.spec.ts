import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import accepted from "../fixtures/market-accepted-transformed.json";
import { ref } from "vue";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import { MarketReadinessController } from "../../src/main/market-readiness-controller";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";
import { DirectMarketSearchProvider } from "../../src/main/direct-market-search-provider";
import { handleMarketSearchRequest } from "../../src/main/market-search-handler";
import { MarketResultCache } from "../../src/main/market-result-cache";
import { useMarketSearchRuntime } from "../../src/renderer/src/lib/market-search-runtime";
import { useSavedMarketItems } from "../../src/renderer/src/lib/saved-market-items";
import { migrateShoppingList } from "../../src/renderer/src/lib/market-items";
import { createInitialMarketReadiness } from "../../src/shared/market-readiness";
import type { DirectMarketWorkerResult } from "../../src/main/market-direct-response";

afterEach(() => { vi.resetModules(); vi.doUnmock("node:https"); vi.doUnmock("node:worker_threads"); });

// Real stores, readiness, provider, worker entry, reducer and renderer runtime.
// Only HTTPS/worker-thread execution is substituted; all identity is invented.
test("saved filters compose through region preparation, real worker dispatch, cooldown, rejection and context races", async () => {
  let clock = 1_000;
  const now = ref(clock);
  const readiness = ref(createInitialMarketReadiness());
  const store = new CapturedSessionContextStore(undefined, () => clock);
  const controller = new MarketReadinessController(store, (value) => { readiness.value = value; }, () => clock);
  const endpoint = { remoteAddress: "203.0.113.10", remotePort: 6668 };
  const directory = new MarketRegionDirectory([{ address: endpoint.remoteAddress, port: endpoint.remotePort, beta: "0", region: "10" }]);
  const observe = (account = "42", season = "11", hardcore = "0", beta = "0") => store.observe({
    text: `api account_id=${account}&unique_account_id=CANARY_IDENTITY&crossregion_identifier=CANARY_SESSION&season=${season}&hardcore=${hardcore}&beta=${beta}`,
    direction: "outbound", ...endpoint,
  });
  let outcome = "success";
  let completeHttp: (() => void) | null = null;
  const bodies: URLSearchParams[] = [];
  const provider = new DirectMarketSearchProvider(store, undefined,
    async () => controller.prepareRegion(async () => store.applyRegionDirectory(directory)),
    new MarketResultCache(() => clock), () => clock, async (context, request) => {
      vi.resetModules();
      let finish!: (result: DirectMarketWorkerResult) => void;
      const posted = new Promise<DirectMarketWorkerResult>((resolve) => { finish = resolve; });
      vi.doMock("node:worker_threads", () => {
        const thread = { parentPort: { postMessage: (value: DirectMarketWorkerResult | { type: string }) => {
          if (!("type" in value)) finish(value);
        } }, workerData: { context, request } };
        return { ...thread, default: thread };
      });
      vi.doMock("node:https", () => ({ default: { request: (_options: unknown, callback: (response: EventEmitter) => void) => {
        const http = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: (body: string) => {
          bodies.push(new URLSearchParams(body));
          completeHttp = () => {
            const response = Object.assign(new EventEmitter(), { statusCode: 200 });
            callback(response);
            // Accepted price projection; identity, selected filters and chunks are synthetic.
            // This mock does not prove that the original page matched this edited search.
            const bytes = outcome === "checksum"
              ? Buffer.from(JSON.stringify({ status: -3, message: "Invalid checksum CANARY_SESSION" }))
              : Buffer.from(accepted.response.bodyBase64, "base64");
            response.emit("data", bytes.subarray(0, 9)); response.emit("data", bytes.subarray(9)); response.emit("end");
          };
        } });
        return http;
      } } }));
      await import("../../src/main/market-direct-search-worker");
      return await posted;
    });
  const search = useMarketSearchRuntime({ searchMarket: (request) => handleMarketSearchRequest(request, provider), now, readiness });
  const entries = ref(migrateShoppingList(["Sharpshooter's Cloak"]));
  const saved = useSavedMarketItems(entries, search);
  const waitForDispatch = async (count: number) => { await vi.waitFor(() => expect(bodies).toHaveLength(count)); };
  const advance = (milliseconds: number) => { clock += milliseconds; now.value = clock; };
  try {
    controller.setCaptureRunning(true); store.observeGameProcessIds([123]); observe();
    expect(readiness.value.phase).toBe("region-required");
    const beforePreparationVersion = readiness.value.contextVersion;
    saved.loadSaved("legacy-0"); search.updateMinSockets(4); search.addStatFilter(64);
    search.updateStatFilter(search.statFilters.value[0].key, { minimum: 8 }); saved.saveDraft();
    expect(bodies).toHaveLength(0);
    const first = search.searchMarket(); await waitForDispatch(1);
    expect(readiness.value.phase).toBe("ready");
    expect(readiness.value.contextVersion).toBe(beforePreparationVersion);
    expect(bodies[0].get("filter_masks")).toBe("[1073746020]");
    expect(bodies[0].get("filter_sockets_min")).toBe("4");
    expect(bodies[0].get("checksum")).toBe("9bd66f31a01793b0c6dee8610d46b72e604467449b86ef9ca8dec0058a4354d8");
    completeHttp!(); await first;
    expect(search.listings.value).toEqual(accepted.expectedResponse.result.listings);
    expect(search.returnedCount.value).toBe(101);
    expect(search.totalMatches.value).toBe(101);
    expect(search.phase.value).toBe("success");
    expect(search.cooldownRemainingSeconds.value).toBe(15);
    await search.searchMarket(); expect(bodies).toHaveLength(1);
    advance(15_000); await search.searchMarket();
    expect(search.resultCached.value).toBe(true); expect(bodies).toHaveLength(1);

    // A completed result must disappear on ready-to-ready mode changes.
    observe("42", "12", "1");
    expect(readiness.value.canSearch).toBe(true);
    expect(search.phase.value).toBe("idle"); expect(search.listings.value).toEqual([]);
    expect(search.minSockets.value).toBe(4);
    outcome = "checksum";
    const rejected = search.searchMarket(); await waitForDispatch(2); completeHttp!(); await rejected;
    expect(search.phase.value).toBe("error");
    expect(search.errorMessage.value).toContain("market rejected this request's checksum");
    expect(search.draftRequest.value!.statFilters).toEqual([{ statId: 64, minimum: 8 }]);
    expect(JSON.stringify({ readiness: readiness.value, result: search.listings.value, message: search.errorMessage.value, saved: entries.value })).not.toMatch(/CANARY|203\.0\.113|account_id/);

    advance(15_000); outcome = "success";
    const interrupted = search.searchMarket(); await waitForDispatch(3);
    search.updateMinSockets(3);
    await search.searchMarket(); expect(bodies).toHaveLength(3);
    completeHttp!(); await interrupted;
    expect(search.phase.value).toBe("idle"); expect(search.listings.value).toEqual([]);
    expect(search.minSockets.value).toBe(3);

    advance(15_000);
    const changedAccount = search.searchMarket(); await waitForDispatch(4);
    observe("99", "12", "1");
    completeHttp!(); await changedAccount;
    expect(search.phase.value).toBe("idle"); expect(search.listings.value).toEqual([]);
    expect(search.minSockets.value).toBe(3);
    expect(search.searchInFlight.value).toBe(false);
    expect(search.cooldownRemainingSeconds.value).toBe(15);
    controller.setCaptureRunning(false);
    expect(search.canSearch.value).toBe(false);
    expect(saved.saveDraft()).toBe(true);
  } finally { provider.dispose(); controller.dispose(); store.dispose(); }
});
