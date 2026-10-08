import { describe, expect, test } from "vitest";
import { CapturedSessionContextStore, type CompleteCapturedSessionContext } from "../../src/main/captured-session-context";
import { extractSessionContextMessages } from "../../src/main/session-context-fields";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";
import { buildDirectMarketRequestBody } from "../../src/main/market-direct-search-worker";
import { buildMarketRequestDiagnostics } from "../../src/main/market-request-diagnostics";

const route = "market/market_player_get_items_on_sale";
const fields = { account_id: "424242", unique_account_id: "NATIVE_SALES_CANARY_UID", crossregion_identifier: "NATIVE_SALES_CANARY_CROSS", season: "11", hardcore: "0", beta: "0" };
const digest = "a".repeat(64);
const text = (method = route, patch = {}) => `${method} ${new URLSearchParams({ ...fields, checksum: digest, ...patch })}`;
function fixture() {
  const store = new CapturedSessionContextStore(() => {}, () => 1000);
  store.observeGameProcessIds([42]);
  store.applyRegionDirectory(new MarketRegionDirectory([{ address: "192.0.2.1", port: 6668, beta: "0", region: "7" }]));
  const observe = (message: string) => store.observe({ text: message, direction: "outbound", observedAt: 1000, remoteAddress: "192.0.2.1", remotePort: 6668 });
  const freeze = () => ({ ...store.marketContext()!, diagnosticRecords: store.marketRecordSnapshot() }) as CompleteCapturedSessionContext;
  return { store, observe, freeze };
}

describe("native TCP player-sales digest diagnostic", () => {
  test("the exact decoded outbound method and only a valid unambiguous digest survive extraction", () => {
    const message = extractSessionContextMessages(text())[0];
    expect(message).toMatchObject({ source: "market", nativeMarket: { method: route, checksum: digest } });
    for (const method of ["market/market_fetch_items", `${route}_other`, `other/${route}`])
      expect(extractSessionContextMessages(text(method))[0]).not.toHaveProperty("nativeMarket");
    for (const suffix of ["&checksum=" + "b".repeat(64), "&checksum=REDACTED"]) {
      const value = extractSessionContextMessages(text() + suffix)[0];
      expect(value).not.toHaveProperty("nativeMarket.checksum");
    }
  });
  test("ordinary context observation freezes bounded private evidence and exports an explicit route without its digest", () => {
    const f = fixture(); f.observe(text());
    const frozen = f.freeze();
    expect(frozen.diagnosticRecords?.api[0]).toHaveProperty("nativeMarket.checksum", digest);
    const body = buildDirectMarketRequestBody(frozen, { itemMask: 1, statFilters: [] });
    const projection = buildMarketRequestDiagnostics(frozen, body).recordComparison!;
    expect(projection.api[0]).toHaveProperty("nativeDigest.route", route);
    expect(projection.nativeMarketDigestObserved).toBe(true);
    expect(JSON.stringify(projection)).not.toContain(digest);
    expect(JSON.stringify(projection)).not.toMatch(/424242|NATIVE_SALES_CANARY|192\.0\.2/);
    f.observe(text(route, { checksum: "b".repeat(64), season: "12" }));
    expect(buildMarketRequestDiagnostics(frozen, body).recordComparison).toEqual(projection);
    f.store.observeCaptureUpdate({ observationGap: true });
    expect(f.store.marketRecordSnapshot().api).toEqual([]);
    expect(frozen.diagnosticRecords?.api[0]).toHaveProperty("nativeMarket.checksum", digest);
    f.store.dispose();
  });
});
