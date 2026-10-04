import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import { MarketReadinessController } from "../../src/main/market-readiness-controller";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";
import { DirectMarketSearchProvider } from "../../src/main/direct-market-search-provider";
import type { MarketReadiness } from "../../src/shared/market-readiness";

const endpoint = { remoteAddress: "203.0.113.10", remotePort: 6668 };
const controllers: MarketReadinessController[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.useRealTimers(); });

function setup(now: () => number = Date.now) {
  const store = new CapturedSessionContextStore();
  const updates: MarketReadiness[] = [];
  const controller = new MarketReadinessController(store, (value) => updates.push(value), now);
  controllers.push(controller);
  const directory = new MarketRegionDirectory([{ address: endpoint.remoteAddress, port: endpoint.remotePort, beta: "0", region: "10" }]);
  const observe = (text = "save account_id=42&unique_account_id=sensitive-user&crossregion_identifier=sensitive-session&beta=0&slot=1&slot_data=" + encodeURIComponent(JSON.stringify({ season: 11, hardcore: 0 })), remote = endpoint) =>
    store.observe({ text, direction: "outbound", ...remote });
  const collect = () => { controller.setCaptureRunning(true); store.observeGameProcessIds([123]); observe(); };
  return { store, controller, updates, directory, observe, collect, latest: () => updates.at(-1)! };
}

describe("sanitized Market readiness", () => {
  test("distinguishes capture, game, missing fields, region preparation and authoritative readiness", async () => {
    const state = setup();
    expect(state.latest()).toMatchObject({ phase: "waiting", reason: "capture_inactive", canSearch: false });
    state.controller.setCaptureRunning(true);
    expect(state.latest().reason).toBe("game_unavailable");
    state.store.observeGameProcessIds([123]);
    state.observe("api account_id=42&beta=0");
    expect(state.latest()).toMatchObject({ phase: "collecting", missingFields: ["unique_account_id", "crossregion_identifier", "season", "hardcore"] });
    state.observe();
    expect(state.latest()).toMatchObject({ phase: "region-required", missingFields: [], canSearch: true, regionQualified: false });
    expect(state.store.marketContext()).toBeNull();
    let finish!: () => void;
    const operation = state.controller.prepareRegion(() => new Promise<void>((resolve) => { finish = resolve; }));
    expect(state.latest()).toMatchObject({ phase: "preparing", canSearch: false });
    state.store.applyRegionDirectory(state.directory);
    finish();
    await operation;
    expect(state.latest()).toMatchObject({ phase: "ready", sessionCurrent: true, regionQualified: true, canSearch: true });
    expect(state.store.marketContext()).not.toBeNull();
    expect(Object.keys(state.latest()).sort()).toEqual(["canSearch", "expiresAt", "missingFields", "phase", "reason", "regionQualified", "sessionCurrent"]);
    expect(JSON.stringify(state.updates)).not.toMatch(/sensitive-user|sensitive-session|203\.0\.113|10-42|123/);
  });

  test("expires without new packets and renews identical evidence without invalidating lookups or their cache", async () => {
    const state = setup();
    state.collect();
    state.store.applyRegionDirectory(state.directory);
    const invalidated = vi.fn();
    state.store.subscribe(invalidated);
    const worker = vi.fn(async () => ({ response: { ok: true as const, result: { listings: [{ price: 123 }] } }, diagnostics: {} }));
    const provider = new DirectMarketSearchProvider(state.store, undefined, undefined, undefined, Date.now, worker);
    try {
      await expect(provider.search({ itemMask: 1_073_746_020, statFilters: [] })).resolves.toMatchObject({ cached: false });
      await vi.advanceTimersByTimeAsync(5_000);
      state.observe();
      expect(invalidated).not.toHaveBeenCalled();
      await expect(provider.search({ itemMask: 1_073_746_020, statFilters: [] })).resolves.toMatchObject({ cached: true, observedAt: 1_000 });
      expect(worker).toHaveBeenCalledTimes(1);
      expect(state.latest().expiresAt).toBe(606_000);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(state.latest().phase).toBe("ready");
      await vi.advanceTimersByTimeAsync(1);
      expect(state.latest()).toMatchObject({ phase: "expired", sessionCurrent: false, canSearch: false });
      expect(state.store.marketContext()).toBeNull();
      state.observe();
      expect(state.latest().phase).toBe("ready");
      expect(invalidated).not.toHaveBeenCalled();
    } finally { provider.dispose(); }
  });

  test("rechecks a valid snapshot when the clock crosses expiry before its timer is scheduled", async () => {
    let crossDeadline = false;
    const state = setup(() => {
      if (crossDeadline) { crossDeadline = false; vi.setSystemTime(601_001); }
      return Date.now();
    });
    state.collect();
    state.store.applyRegionDirectory(state.directory);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(state.latest().phase).toBe("ready");
    crossDeadline = true;
    state.controller.setCaptureRunning(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.latest()).toMatchObject({ phase: "expired", canSearch: false, sessionCurrent: false });
    expect(state.store.marketContext()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("blocks mixed endpoints and incomplete replacement accounts, then clears on capture stop and game replacement", () => {
    const state = setup();
    state.collect();
    state.store.applyRegionDirectory(state.directory);
    state.observe("api unique_account_id=sensitive-user&beta=0", { remoteAddress: "203.0.113.11", remotePort: 6669 });
    expect(state.latest()).toMatchObject({ phase: "collecting", reason: "endpoint_mismatch", sessionCurrent: false, canSearch: false });
    state.observe("api account_id=99&beta=0");
    expect(state.latest()).toMatchObject({ phase: "collecting", canSearch: false });
    expect(state.latest().missingFields).toContain("unique_account_id");
    state.controller.setCaptureRunning(false);
    expect(state.latest()).toMatchObject({ phase: "waiting", reason: "capture_inactive", canSearch: false });
    state.store.observeGameProcessIds([456]);
    state.controller.setCaptureRunning(true);
    expect(state.latest().missingFields).toHaveLength(6);
    state.store.observeGameProcessIds([]);
    expect(state.latest().reason).toBe("game_unavailable");
  });

  test("reports a sanitized region failure without losing captured context and permits another explicit preparation", async () => {
    const state = setup();
    state.collect();
    await expect(state.controller.prepareRegion(async () => { throw new Error("sensitive-session"); })).rejects.toThrow();
    expect(state.latest()).toMatchObject({ phase: "region-error", missingFields: [], canSearch: true });
    expect(JSON.stringify(state.updates)).not.toContain("sensitive-session");
    await state.controller.prepareRegion(async () => { state.store.applyRegionDirectory(state.directory); });
    expect(state.latest().phase).toBe("ready");
  });


  test("collects replacement character mode rather than reusing old mode fields", () => {
    const state = setup();
    state.collect();
    state.store.applyRegionDirectory(state.directory);
    state.observe("api account_id=42&season=12");
    expect(state.latest()).toMatchObject({ phase: "collecting", missingFields: ["hardcore", "beta"], canSearch: false });
    expect(state.store.marketContext()).toBeNull();
  });

  test("does not publish or arm expiry after disposal while public preparation settles", async () => {
    const state = setup();
    state.collect();
    let finish!: () => void;
    const pending = state.controller.prepareRegion(() => new Promise<void>((resolve) => { finish = resolve; }));
    state.controller.dispose();
    const count = state.updates.length;
    finish();
    await pending;
    await vi.advanceTimersByTimeAsync(600_001);
    expect(state.updates).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("cannot claim ready after public preparation leaves the captured region unresolved", async () => {
    const state = setup();
    state.collect();
    await state.controller.prepareRegion(async () => { state.store.applyRegionDirectory(new MarketRegionDirectory([])); });
    expect(state.latest()).toMatchObject({ phase: "region-error", regionQualified: false });
    expect(state.store.marketContext()).toBeNull();
  });
});
