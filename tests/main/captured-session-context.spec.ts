import { describe, expect, test, vi } from "vitest";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";
import { SESSION_CONTEXT_FIELDS } from "../../src/main/session-context-fields";

const endpoint = { remoteAddress: "203.0.113.10", remotePort: 6668 };

function savePayload(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    account_id: "42",
    unique_account_id: "hero-7",
    crossregion_identifier: "xrid-one",
    beta: "0",
    slot: "1",
    slot_data: JSON.stringify({ season: 11, hardcore: 0 }),
    ...overrides,
  });
  return `save ${params}`;
}

describe("captured session context", () => {
  test("connection lifecycle and capture loss before any evidence keep the collection guidance", () => {
    const store = new CapturedSessionContextStore(undefined, () => 1_000);
    store.observeGameProcessIds([123]);
    const before = store.marketReadiness();
    store.observeTcpLifecycle({ src: "10.0.0.2", srcPort: 5000, dst: endpoint.remoteAddress, dstPort: endpoint.remotePort, flags: 2 });
    store.observeCaptureUpdate({ observationGap: true, observationBoundary: 3 });
    expect(store.marketReadiness()).toEqual(before);
    expect(before).toMatchObject({ reason: "missing_fields" });
    store.observe({ text: savePayload(), direction: "outbound", ...endpoint, observedAt: 1_000, observationSequence: 3 });
    expect(store.marketReadiness().missingFields).toEqual([...SESSION_CONTEXT_FIELDS]);
  });

  test("promotes structurally observed API fields to coherent Market and SZ snapshots", () => {
    const store = new CapturedSessionContextStore(undefined, () => 1_000);
    store.observeGameProcessIds([123]);
    store.observe({ text: savePayload(), direction: "outbound", ...endpoint, observedAt: 1_000 });
    expect(store.marketContext()).toBeNull();

    store.applyRegionDirectory(new MarketRegionDirectory([
      { address: endpoint.remoteAddress, port: endpoint.remotePort, beta: "0", region: "10" },
    ]));
    expect(store.marketContext()).toMatchObject({
      generation: 1,
      fields: {
        account_id: "10-42", unique_account_id: "hero-7", crossregion_identifier: "xrid-one",
        season: "11", hardcore: "0", beta: "0",
      },
      endpoint: { address: endpoint.remoteAddress, port: endpoint.remotePort },
    });
    expect(store.satanicZoneContext()).toMatchObject({
      uniqueAccountId: "hero-7", crossregionIdentifier: "xrid-one", beta: "0",
    });
  });

  test("invalidates account, process-generation, mode, and endpoint changes", () => {
    const changes = vi.fn();
    const store = new CapturedSessionContextStore(undefined, () => 4_000);
    store.subscribe(changes);
    store.observeGameProcessIds([123]);
    store.applyRegionDirectory(new MarketRegionDirectory([
      { address: endpoint.remoteAddress, port: endpoint.remotePort, beta: "0", region: "10" },
    ]));
    store.observe({ text: savePayload(), direction: "outbound", ...endpoint, observedAt: 1_000 });
    const original = store.marketContext();
    expect(original).not.toBeNull();

    store.observe({ text: savePayload({ slot_data: JSON.stringify({ season: 12, hardcore: 1 }) }), direction: "outbound", ...endpoint, observedAt: 2_000 });
    const changedMode = store.marketContext();
    expect(changedMode?.scopeKey).not.toBe(original?.scopeKey);
    expect(changedMode?.fields).toMatchObject({ season: "12", hardcore: "1" });

    store.observe({ text: savePayload({ unique_account_id: "hero-8", crossregion_identifier: "xrid-two" }), direction: "outbound", ...endpoint, observedAt: 3_000 });
    expect(store.marketContext()?.fields.unique_account_id).toBe("hero-8");
    expect(store.marketContext()?.fields.season).toBe("11");

    store.observe({ text: savePayload({ crossregion_identifier: "xrid-three" }), direction: "outbound", remoteAddress: "203.0.113.11", remotePort: 6669, observedAt: 4_000 });
    expect(store.marketContext()).toBeNull();
    store.observeGameProcessIds([456]);
    expect(store.marketContext()).toBeNull();
    expect(store.satanicZoneContext()).toBeNull();
    expect(changes).toHaveBeenCalled();
  });

  test("notifies direct providers when the game process stops or a new generation starts", () => {
    const changes = vi.fn();
    const store = new CapturedSessionContextStore(undefined, () => 4_000);
    store.subscribe(changes);

    store.observeGameProcessIds([123]);
    store.observe({ text: savePayload(), direction: "outbound", ...endpoint, observedAt: 1_000 });
    changes.mockClear();

    store.observeGameProcessIds([]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(store.marketContext()).toBeNull();

    changes.mockClear();
    store.observeGameProcessIds([456]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(store.satanicZoneContext()).toBeNull();
  });

  test("expires transient crossregion context without persisting or extending it", () => {
    let now = 1_000;
    const store = new CapturedSessionContextStore(undefined, () => now);
    store.observeGameProcessIds([123]);
    store.observe({ text: savePayload(), direction: "outbound", ...endpoint, observedAt: now });
    expect(store.satanicZoneContext()).not.toBeNull();
    now += 10 * 60_000 + 1;
    expect(store.satanicZoneContext()).toBeNull();
  });

  describe("retained account and mode", () => {
    const oldFlow = { ...endpoint, localAddress: "10.0.0.2", localPort: 5000 };
    const newFlow = { ...endpoint, localAddress: "10.0.0.2", localPort: 5001 };
    const transient = (uid = "hero-7", xrid = "xrid-two", extra = "") => `unique_account_id=${uid}&crossregion_identifier=${xrid}&beta=0${extra}`;
    const directory = new MarketRegionDirectory([{ address: endpoint.remoteAddress, port: endpoint.remotePort, beta: "0", region: "10" }]);
    function readyStore(now = () => 1_000) {
      const store = new CapturedSessionContextStore(undefined, now);
      store.observeGameProcessIds([123]);
      store.applyRegionDirectory(directory);
      store.observe({ text: savePayload(), direction: "outbound", ...oldFlow, observedAt: 1_000 });
      expect(store.marketReadiness()).toMatchObject({ phase: "ready", retainedContext: false });
      return store;
    }
    const closeOldFlow = (store: CapturedSessionContextStore) =>
      store.observeTcpLifecycle({ src: oldFlow.localAddress, srcPort: oldFlow.localPort, dst: endpoint.remoteAddress, dstPort: endpoint.remotePort, flags: 1 });

    test("a vote-reset reconnect restores account and mode from fresh matching UID and crossregion", () => {
      const store = readyStore();
      closeOldFlow(store);
      expect(store.marketReadiness()).toMatchObject({ phase: "collecting", reason: "observation_gap", canSearch: false });
      store.observe({ text: transient(), direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(store.marketReadiness()).toMatchObject({ phase: "ready", canSearch: true, retainedContext: true });
      expect(store.marketContext()?.fields).toMatchObject({
        account_id: "10-42", unique_account_id: "hero-7", crossregion_identifier: "xrid-two", season: "11", hardcore: "0", beta: "0",
      });
      store.observe({ text: savePayload({ crossregion_identifier: "xrid-two" }), direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(store.marketReadiness()).toMatchObject({ phase: "ready", retainedContext: false });
    });

    test("survives a game restart but still requires fresh transient evidence", () => {
      const store = readyStore();
      store.observeGameProcessIds([]);
      store.observeGameProcessIds([456]);
      expect(store.marketContext()).toBeNull();
      store.observe({ text: "unique_account_id=hero-7&beta=0", direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(store.marketReadiness().canSearch).toBe(false);
      store.observe({ text: transient(), direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(store.marketReadiness()).toMatchObject({ phase: "ready", retainedContext: true });
    });

    test("is not used for a different UID or contradicting fresh mode", () => {
      const other = readyStore();
      closeOldFlow(other);
      other.observe({ text: transient("hero-8"), direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(other.marketReadiness()).toMatchObject({ canSearch: false, missingFields: ["account_id", "season", "hardcore"] });

      const switched = readyStore();
      closeOldFlow(switched);
      switched.observe({ text: transient("hero-7", "xrid-two").replace("beta=0", "beta=1"), direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(switched.marketReadiness().canSearch).toBe(false);
      switched.observe({ text: transient(), direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(switched.marketReadiness().canSearch).toBe(false);
    });

    test("requalifies the account when the API endpoint changes", () => {
      const store = readyStore();
      store.observeGameProcessIds([456]);
      store.observe({ text: transient(), direction: "outbound", remoteAddress: "203.0.113.11", remotePort: 6669, observedAt: 1_000 });
      expect(store.marketReadiness()).toMatchObject({ phase: "region-required", retainedContext: true });
      expect(store.marketContext()).toBeNull();
    });

    test("a checksum rejection discards restored values until fresh evidence replaces them", () => {
      const store = readyStore();
      closeOldFlow(store);
      store.observe({ text: transient(), direction: "outbound", ...newFlow, observedAt: 1_000 });
      const version = store.marketReadiness().contextVersion;
      store.discardRetainedContext();
      expect(store.marketReadiness()).toMatchObject({ canSearch: false, retainedContext: false, missingFields: ["account_id", "season", "hardcore"] });
      expect(store.marketReadiness().contextVersion).toBeGreaterThan(version!);
      store.observe({ text: transient("hero-7", "xrid-three"), direction: "outbound", ...newFlow, observedAt: 1_000 });
      expect(store.marketReadiness().canSearch).toBe(false);
    });
  });

  test("ignores inbound or unbound observations and never logs credential values", () => {
    const log = vi.fn();
    const store = new CapturedSessionContextStore(log);
    store.observe({ text: savePayload(), direction: "outbound", ...endpoint });
    store.observeGameProcessIds([123]);
    store.observe({ text: savePayload(), direction: "inbound", ...endpoint });
    expect(store.satanicZoneContext()).toBeNull();
    store.observe({ text: savePayload(), direction: "outbound", ...endpoint });
    expect(JSON.stringify(log.mock.calls)).not.toContain("hero-7");
    expect(JSON.stringify(log.mock.calls)).not.toContain("xrid-one");
  });
});
