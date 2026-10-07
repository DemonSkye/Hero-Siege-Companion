import { describe, expect, test } from "vitest";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";

const flow = { direction: "outbound" as const, remoteAddress: "203.0.113.10", remotePort: 6668,
  localAddress: "192.0.2.10", localPort: 5000 };
const complete = "account_id=424242&unique_account_id=CANARY-uid&crossregion_identifier=CANARY-session&season=11&hardcore=0&beta=0";
function setup() {
  const store = new CapturedSessionContextStore(undefined, () => 1000);
  store.observeGameProcessIds([42]); store.applyRegionDirectory(new MarketRegionDirectory([
    { address: flow.remoteAddress, port: 6668, beta: "0", region: "7" },
    { address: "203.0.113.20", port: 6668, beta: "0", region: "9" },
  ]));
  store.observe({ ...flow, text: complete }); return store;
}
describe("Market evidence coherence with substituted authentication", () => {
  test.each([
    { remoteAddress: flow.remoteAddress, localPort: 6000 },
    { remoteAddress: "203.0.113.20", localPort: 6000 },
  ])("stable account/mode and transient identity acquired on separate connections remain Ready: $remoteAddress", connection => {
    const store = new CapturedSessionContextStore(undefined, () => 1000); store.observeGameProcessIds([42]);
    store.observe({ ...flow, text: "account_id=7-424242&season=11&hardcore=0&beta=0" });
    store.observe({ ...flow, ...connection, text: "unique_account_id=CANARY-uid&crossregion_identifier=CANARY-session&beta=0" });
    expect(store.marketReadiness()).toMatchObject({ phase: "ready", canSearch: true });
    expect(store.marketContext()?.fields).toMatchObject({ account_id: "7-424242", season: "11", hardcore: "0" });
    expect(store.marketProvenance().sameFlow).toBe(false);
  });
  test("stable raw account refreshed on another connection retains its observed qualification", () => {
    const store = new CapturedSessionContextStore(undefined, () => 1000); store.observeGameProcessIds([42]);
    store.observe({ ...flow, text: complete.replace("account_id=424242", "account_id=7-424242") });
    const original = store.marketContext();
    store.observe({ ...flow, localPort: 6000, text: "account_id=424242" });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketContext()?.fields.account_id).toBe("7-424242");
    expect(store.marketContext()?.revision).toBe(original?.revision);
    expect(store.marketProvenance()).toMatchObject({ sameFlow: false, accountQualification: "observed-prefix" });
  });
  test("late directory can qualify stable raw account from a prior same-account connection", () => {
    const store = new CapturedSessionContextStore(undefined, () => 1000); store.observeGameProcessIds([42]);
    store.observe({ ...flow, text: complete });
    store.observe({ ...flow, remoteAddress: "203.0.113.30", localPort: 6000, text: "account_id=424242" });
    store.applyRegionDirectory(new MarketRegionDirectory([{ address: flow.remoteAddress, port: flow.remotePort, beta: "0", region: "7" }]));
    expect(store.marketContext()?.fields.account_id).toBe("7-424242");
    expect(store.marketReadiness()).toMatchObject({ phase: "ready", canSearch: true });
  });
  test("stable provenance changes do not invalidate a working provider revision", () => {
    const store = setup(), original = store.marketContext();
    store.observe({ ...flow, localPort: 6000, text: "unique_account_id=CANARY-uid&season=11&hardcore=0&beta=0" });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketContext()?.revision).toBe(original?.revision);
    expect(store.marketProvenance().sameFlow).toBe(false);
  });
  test.each(["account_id=999999", "unique_account_id=CANARY-new-identity"])("actual identity value change still clears old context: %s", text => {
    const store = setup();
    store.observe({ ...flow, localPort: 6000, text });
    expect(store.marketContext()).toBeNull();
    expect(store.marketReadiness()).toMatchObject({ canSearch: false, reason: "missing_fields" });
  });
  test("actual mode change requires newly observed mode fields, not old values", () => {
    const store = setup();
    store.observe({ ...flow, localPort: 6000, text: "unique_account_id=CANARY-uid&hardcore=1" });
    expect(store.marketContext()).toBeNull();
    expect(store.marketReadiness().missingFields).toEqual(["season", "beta"]);
    store.observe({ ...flow, localPort: 6000, text: "unique_account_id=CANARY-uid&season=11&beta=0" });
    expect(store.marketContext()?.fields).toMatchObject({ season: "11", hardcore: "1", beta: "0" });
    expect(store.marketReadiness().canSearch).toBe(true);
  });
  test("UID and crossregion must retain established endpoint coherence before transient context is usable", () => {
    const store = setup();
    store.observe({ ...flow, remoteAddress: "203.0.113.20", text: "unique_account_id=CANARY-uid&beta=0" });
    expect(store.marketReadiness()).toMatchObject({ canSearch: false, reason: "endpoint_mismatch" });
    expect(store.marketContext()).toBeNull(); expect(store.satanicZoneContext()).toBeNull();
    store.observe({ ...flow, remoteAddress: "203.0.113.20", text: "unique_account_id=CANARY-uid&crossregion_identifier=CANARY-next&beta=0" });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketProvenance().sameEndpoint).toBe(false);
  });
  test.each(["", "&season=11"])("API hardcore before first account/save remains comparable after narrow same-flow binding: %s", season => {
    const store = new CapturedSessionContextStore(undefined, () => 1000); store.observeGameProcessIds([42]);
    store.observe({ ...flow, text: `unique_account_id=CANARY-uid&crossregion_identifier=CANARY-session&hardcore=0&beta=0${season}` });
    store.observe({ ...flow, text: `save ${new URLSearchParams({ account_id: "7-424242", slot: "2", beta: "0", slot_data: '{"season":11,"hardcore":1}' })}` });
    expect(store.marketProvenance().hardcoreSourcesAgree).toBe(false);
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketContext()?.fields.hardcore).toBe("1");
  });
  test("stable account and mode can outlive a transient endpoint change while provenance records disagreement", () => {
    const store = setup(); expect(store.marketReadiness().canSearch).toBe(true);
    store.observe({ ...flow, remoteAddress: "203.0.113.20", localPort: 6000,
      text: "unique_account_id=CANARY-uid&crossregion_identifier=CANARY-next&beta=0" });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketContext()?.fields.account_id).toBe("7-424242");
    expect(store.marketProvenance()).toMatchObject({ sameEndpoint: false, sameFlow: false, accountPrefixCoherent: false });
    store.observe({ ...flow, remoteAddress: "203.0.113.20", localPort: 6000, text: complete });
    expect(store.marketContext()?.fields.account_id).toBe("9-424242");
    expect(store.marketReadiness().canSearch).toBe(true);
  });
  test("API/save hardcore disagreement is diagnostic without inventing selected-slot truth", () => {
    const store = setup();
    const params = new URLSearchParams({ account_id: "424242", slot: "2", beta: "0",
      slot_data: JSON.stringify({ season: 11, hardcore: 1 }) });
    store.observe({ ...flow, text: `save ${params}` });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketContext()?.fields.hardcore).toBe("1");
    expect(store.marketProvenance().hardcoreSourcesAgree).toBe(false);
    store.observe({ ...flow, text: complete.replace("hardcore=0", "hardcore=1") });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketProvenance().hardcoreSourcesAgree).toBe(true);
  });
  test("conflicts in the reverse order and scope changes clear old comparisons", () => {
    const store = setup();
    store.observe({ ...flow, text: `save ${new URLSearchParams({ account_id: "424242", slot: "2", beta: "0", slot_data: '{"season":11,"hardcore":1}' })}` });
    store.observe({ ...flow, text: complete });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketProvenance().hardcoreSourcesAgree).toBe(false);
    store.observe({ ...flow, text: complete.replace("season=11", "season=12") });
    expect(store.marketReadiness().canSearch).toBe(true); expect(store.marketProvenance().hardcoreSaveObserved).toBe(false);
    store.observeGameProcessIds([43]); expect(store.marketProvenance().hardcoreApiObserved).toBe(false);
  });
  test("known local-flow changes retain stable context while recording different sources", () => {
    const store = setup(); store.observe({ ...flow, localPort: 6000, text: "unique_account_id=CANARY-uid&crossregion_identifier=CANARY-next&beta=0" });
    expect(store.marketProvenance().sameFlow).toBe(false); expect(store.marketReadiness().canSearch).toBe(true);
    store.observe({ ...flow, localPort: 6000, text: complete });
    expect(store.marketReadiness().canSearch).toBe(true);
  });
  test("unknown local tuples remain indeterminate rather than inventing a match", () => {
    const store = setup(); store.observe({ direction: "outbound", remoteAddress: flow.remoteAddress, remotePort: flow.remotePort, text: complete });
    expect(store.marketReadiness().canSearch).toBe(true); expect(store.marketProvenance().sameFlow).toBeNull();
  });
  test("native observed fallback prefix0 is accepted without a directory contradiction", () => {
    const store = setup(); store.observe({ ...flow, text: complete.replace("account_id=424242", "account_id=0-424242") });
    expect(store.marketReadiness().canSearch).toBe(true);
    expect(store.marketProvenance()).toMatchObject({ accountQualification: "observed-prefix", accountPrefixCoherent: null });
  });
  test("provenance stores explicit metadata and never retains raw payload text", () => {
    const store = setup(), marker = "DO_NOT_RETAIN_RAW_IGNORED_FIELD";
    store.observe({ ...flow, text: complete + `&ignored_secret=${marker}` });
    store.observe({ ...flow, text: `save ${new URLSearchParams({ account_id: "424242", slot: "2", beta: "0", slot_data: '{"season":11,"hardcore":0}', ignored_secret: marker })}` });
    expect(JSON.stringify(store)).not.toContain(marker);
    expect(JSON.stringify(store.marketProvenance())).not.toMatch(/CANARY|424242|203\.0\.113|192\.0\.2/);
  });
});
