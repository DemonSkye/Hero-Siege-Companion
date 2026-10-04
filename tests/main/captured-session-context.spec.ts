import { describe, expect, test, vi } from "vitest";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";

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
