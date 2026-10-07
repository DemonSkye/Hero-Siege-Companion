import { describe, expect, test } from "vitest";
import { CapturedSessionContextStore, type CapturedSessionPayload, type CompleteCapturedSessionContext } from "../../src/main/captured-session-context";
import { buildDirectMarketRequestBody } from "../../src/main/market-direct-search-worker";
import { buildMarketRequestDiagnostics } from "../../src/main/market-request-diagnostics";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";

const fields = { account_id: "700001", unique_account_id: "SYNTHETIC_UID", crossregion_identifier: "SYNTHETIC_CROSS", season: "11", hardcore: "0", beta: "0" };
function api(patch: Partial<typeof fields> = {}, slot = "4") { return "api " + new URLSearchParams({ ...fields, ...patch, slot }); }
function save(season = "11", slot = "4") {
  return "save " + new URLSearchParams({ account_id: fields.account_id, beta: "0", slot,
    slot_data: JSON.stringify({ season: Number(season), hardcore: 0 }) });
}
function payload(text: string, localPort = 5000): CapturedSessionPayload {
  return { text, direction: "outbound", observedAt: 1000, remoteAddress: "192.0.2.1", remotePort: 6668, localAddress: "192.0.2.2", localPort };
}
function fixture() {
  const store = new CapturedSessionContextStore(() => {}, () => 1000);
  store.observeGameProcessIds([42]); store.applyRegionDirectory(new MarketRegionDirectory([
    { address: "192.0.2.1", port: 6668, beta: "0", region: "2" },
  ]));
  const diagnosticContext = () => {
    const context = store.marketContext()!;
    const snapshot = store.marketRecordSnapshot();
    return { ...context, diagnosticRecords: snapshot } as CompleteCapturedSessionContext;
  };
  return { store, diagnosticContext };
}
function diagnostics(context: CompleteCapturedSessionContext) {
  const body = buildDirectMarketRequestBody(context, { itemMask: 1, statFilters: [] });
  return buildMarketRequestDiagnostics(context, body);
}
describe("Market request compared with independently retained TCP records", () => {
  test("another character save cannot hide behind the merged context's agreement flags", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save("12", "8")));
    f.store.observe(payload(api({ season: "12" })));
    const context = f.diagnosticContext();
    expect(context.fields.season).toBe("12");
    expect(f.store.marketProvenance()).toMatchObject({ sameFlow: true, sameEndpoint: true, accountPrefixCoherent: true, hardcoreSourcesAgree: true });
    const result = diagnostics(context) as ReturnType<typeof diagnostics> & { recordComparison?: unknown };
    expect(result.recordComparison).toMatchObject({
      api: expect.arrayContaining([expect.objectContaining({ equalToRequest: expect.objectContaining({ season: false }) })]),
      saves: [expect.objectContaining({ equalToRequest: expect.objectContaining({ season: true }) })],
      apiSave: expect.arrayContaining([[expect.objectContaining({ observedSlotEqual: false })]]),
      selectedNativeSlotEstablished: false,
    });
    f.store.dispose();
  });
  test("equal operands from different legitimate flows remain usable and report flow separately", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save(), 5001));
    const context = f.diagnosticContext(); expect(context).not.toBeNull();
    const result = diagnostics(context) as ReturnType<typeof diagnostics> & { recordComparison?: unknown };
    expect(result.recordComparison).toMatchObject({
      api: [expect.objectContaining({ equalToRequest: expect.objectContaining({ unique_account_id: true, season: true }) })],
      saves: [expect.objectContaining({ equalToRequest: expect.objectContaining({ account_id: true, season: true }) })],
      apiSave: [[expect.objectContaining({ observedSlotEqual: true, sameFlow: false })]],
    });
    expect(f.store.marketContext()?.fields).toEqual(context.fields); f.store.dispose();
  });
  test.each([
    ["account_id", "2-800002"], ["unique_account_id", "SYNTHETIC_OTHER_UID"],
    ["crossregion_identifier", "SYNTHETIC_OTHER_CROSS"], ["season", "12"], ["hardcore", "1"], ["beta", "1"],
  ] as const)("actual final-form %s disagreement is detected independently of frozen context", (field, value) => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save()));
    const context = f.diagnosticContext(), body = new URLSearchParams(buildDirectMarketRequestBody(context, { itemMask: 1, statFilters: [] }));
    body.set(field, value);
    const result = buildMarketRequestDiagnostics(context, body.toString()).recordComparison!;
    expect(result.contextEqualsForm[field]).toBe(false); expect(result.api[0].equalToRequest[field]).toBe(false);
    f.store.dispose();
  });
  test("split records keep missing fields null and never backfill from merged acquisition", () => {
    const f = fixture(); f.store.observe(payload(api()));
    f.store.observe(payload("api unique_account_id=SYNTHETIC_UID&beta=0"));
    f.store.observe(payload("api crossregion_identifier=SYNTHETIC_CROSS")); f.store.observe(payload(save()));
    const records = diagnostics(f.diagnosticContext()).recordComparison!;
    expect(records.api[1].available.crossregion_identifier).toBe(false);
    expect(records.api[1].equalToRequest.crossregion_identifier).toBeNull();
    expect(records.api[2].available.unique_account_id).toBe(false);
    expect(records.api[2].equalToRequest.unique_account_id).toBeNull();
    expect(records.api[2].equalToRequest.crossregion_identifier).toBe(true); f.store.dispose();
  });
  test("multiple save slots retain their independent comparisons without claiming the native selected character", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save("11", "4")));
    f.store.observe(payload(save("12", "8"))); f.store.observe(payload(api({ season: "12" })));
    const result = diagnostics(f.diagnosticContext()).recordComparison!;
    expect(result.saves.map(record => record.equalToRequest.season)).toEqual([false, true]);
    expect(result.apiSave.map(row => row.map(pair => pair.observedSlotEqual))).toEqual([[true, false], [true, false]]);
    expect(result.selectedNativeSlotEstablished).toBe(false); expect(result.authoritativeLoginBoundaryObserved).toBe(false);
    expect(result.nativeMarketDigestObserved).toBe(false); f.store.dispose();
  });
  test("raw account equality is separate from independently observed prefix; directory qualification supplies no native prefix", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save()));
    expect(diagnostics(f.diagnosticContext()).recordComparison!.api[0].observedPrefixEqual).toBeNull();
    f.store.observe(payload(api({ account_id: "3-700001" })));
    const context = f.diagnosticContext(); context.fields.account_id = "2-700001";
    const result = diagnostics(context).recordComparison!;
    expect(result.api[1].equalToRequest.account_id).toBe(true); expect(result.api[1].observedPrefixEqual).toBe(false);
    f.store.dispose();
  });
  test("wrong or overwritten source operands remain visible after identity replacement", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save()));
    f.store.observe(payload(api({ unique_account_id: "SYNTHETIC_OTHER_UID", crossregion_identifier: "SYNTHETIC_OTHER_CROSS" })));
    const result = diagnostics(f.diagnosticContext()).recordComparison!;
    expect(result.api.map(record => record.equalToRequest.unique_account_id)).toEqual([false, true]);
    expect(result.api.map(record => record.equalToRequest.crossregion_identifier)).toEqual([false, true]);
    f.store.dispose();
  });
  test("generation, capture gaps and disposal clear diagnostic records without changing request readiness policy", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save()));
    const prior = f.store.marketContext(); f.store.clearMarketRecordEvidenceForGap();
    expect(f.store.marketContext()?.fields).toEqual(prior?.fields);
    expect(f.store.marketRecordSnapshot()).toMatchObject({ api: [], saves: [], clearedForObservationGap: true });
    f.store.observe(payload(api())); f.store.observe(payload(save())); f.store.observeGameProcessIds([43]);
    expect(f.store.marketRecordSnapshot()).toMatchObject({ api: [], saves: [] });
    f.store.observe(payload(api())); f.store.dispose(); expect(f.store.marketRecordSnapshot()).toMatchObject({ api: [], saves: [] });
  });
  test("frozen evidence and request do not change when later API/save observations arrive", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save()));
    const context = f.diagnosticContext(), before = diagnostics(context);
    f.store.observe(payload(api({ unique_account_id: "SYNTHETIC_OTHER_UID" }))); f.store.observe(payload(save("12", "8")));
    expect(diagnostics(context)).toEqual(before);
    expect(context.diagnosticRecords?.api).toHaveLength(1); f.store.dispose();
  });
  test("ninth record evicts oldest per category, and raw payload/inventory/checksum text is never retained", () => {
    const f = fixture();
    for (let i = 0; i < 9; i++) {
      f.store.observe(payload(api({}, String(i)) + "&inventory=INVENTORY_CANARY&checksum=CHECKSUM_CANARY&password=PASSWORD_CANARY"));
      f.store.observe(payload(save("11", String(i))));
    }
    const snapshot = f.store.marketRecordSnapshot(); expect(snapshot.api).toHaveLength(8); expect(snapshot.saves).toHaveLength(8);
    expect(snapshot.api[0].slot).toBe("1"); expect(snapshot.evicted).toBe(true);
    const serialized = JSON.stringify(snapshot); expect(serialized).not.toMatch(/INVENTORY_CANARY|CHECKSUM_CANARY|PASSWORD_CANARY|slot_data/);
    const result = diagnostics(f.diagnosticContext()).recordComparison!;
    expect(result.recordsEvicted).toBe(true); expect(result.apiSave.flat()).toHaveLength(64);
    expect(JSON.stringify(result)).not.toMatch(/700001|SYNTHETIC_UID|SYNTHETIC_CROSS|192\.0\.2/); f.store.dispose();
  });
  test("duplicate or invalid final field is indeterminate while independently valid fields remain comparable", () => {
    const f = fixture(); f.store.observe(payload(api())); f.store.observe(payload(save())); const context = f.diagnosticContext();
    const body = buildDirectMarketRequestBody(context, { itemMask: 1, statFilters: [] });
    const duplicate = buildMarketRequestDiagnostics(context, body + "&beta=1").recordComparison!;
    expect(duplicate.formUnambiguous).toBe(false); expect(duplicate.formValid.beta).toBe(false);
    expect(duplicate.api[0].equalToRequest.beta).toBeNull(); expect(duplicate.api[0].equalToRequest.unique_account_id).toBe(true);
    const params = new URLSearchParams(body); params.set("hardcore", "INVALID_CANARY");
    const invalid = buildMarketRequestDiagnostics(context, params.toString()).recordComparison!;
    expect(invalid.formValid.hardcore).toBe(false); expect(invalid.api[0].equalToRequest.hardcore).toBeNull();
    expect(invalid.api[0].equalToRequest.season).toBe(true); expect(JSON.stringify(invalid)).not.toContain("INVALID_CANARY"); f.store.dispose();
  });
  test("slot provenance ignores duplicate form slots, invalid values and nested slots without selecting a native character", () => {
    const f = fixture(); f.store.observe(payload(api()));
    f.store.observe(payload(api() + "&slot=8"));
    f.store.observe(payload(api({}, "INVALID_CANARY")));
    f.store.observe(payload(JSON.stringify({ ...fields, inventory: { slot: 8 } })));
    const records = diagnostics(f.diagnosticContext()).recordComparison!;
    expect(records.api.map(record => record.slotObserved)).toEqual([true, false, false, false]);
    expect(records.selectedNativeSlotEstablished).toBe(false); f.store.dispose();
  });
});
