import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";
import type { DirectMarketWorkerResult } from "../../src/main/market-direct-response";
import evidence from "../fixtures/market-native-evidence.json";

const bridge = vi.hoisted(() => ({ request: vi.fn(), post: vi.fn(), data: undefined as unknown, active: false }));
vi.mock("node:https", () => ({ default: { request: bridge.request } }));
vi.mock("node:worker_threads", () => ({ default: { get parentPort() { return bridge.active ? { postMessage: bridge.post } : null; }, get workerData() { return bridge.data; } },
  get parentPort() { return bridge.active ? { postMessage: bridge.post } : null; }, get workerData() { return bridge.data; } }));
afterEach(() => { vi.restoreAllMocks(); bridge.request.mockReset(); bridge.post.mockReset(); bridge.active = false; });

// Owner f61db55: 2026-10-07 04:27:55.736 and 04:31:26.234 UTC.
// Only safe mode/provenance/status metadata survives. All identities, forms,
// selected slot, endpoint and rejection body below are invented substitutions.
// A synthetic server rejection verifies handling; it cannot explain the real one.
describe("owner Market rejection shapes through actual parser/context/worker/reducer", () => {
  test.each([
    { label: "04:27:55.736: API/save HC observed and agree", apiHardcore: true, expectedAgreement: true },
    { label: "04:31:26.234: save HC observed, no API HC", apiHardcore: false, expectedAgreement: null },
  ])("$label keeps canonical final fields and the observed rejection category", async ({ apiHardcore, expectedAgreement }) => {
    const vector = evidence.checksumVectors[0], now = Date.parse("2026-10-07T04:27:50Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = new CapturedSessionContextStore(undefined, () => now); store.observeGameProcessIds([42]);
    const scope = { direction: "outbound" as const, remoteAddress: "203.0.113.71", remotePort: 6668,
      localAddress: "192.0.2.10", localPort: 5000, observedAt: now };
    const apiFields: Record<string, string> = { unique_account_id: "SYNTHETIC-OWNER-UID",
      crossregion_identifier: "SYNTHETIC-OWNER-CROSSREGION", beta: "0" };
    if (apiHardcore) apiFields.hardcore = "0";
    store.observe({ ...scope, text: `invented_api ${new URLSearchParams(apiFields)}` });
    store.observe({ ...scope, text: `save ${new URLSearchParams({ account_id: vector.accountRaw, slot: "1", beta: "0",
      slot_data: JSON.stringify({ season: 11, hardcore: 0 }) })}` });
    store.applyRegionDirectory(new MarketRegionDirectory([
      { address: scope.remoteAddress, port: scope.remotePort, beta: "0", region: "7" },
    ]));
    const context = store.marketContext(); expect(context).not.toBeNull();
    expect(context!.fields).toEqual({ account_id: vector.postedAccount, unique_account_id: apiFields.unique_account_id,
      crossregion_identifier: apiFields.crossregion_identifier, season: "11", hardcore: "0", beta: "0" });
    const observedProof = { fieldSources: { account_id: "character-save", unique_account_id: "game-api",
      crossregion_identifier: "game-api", season: "character-save", hardcore: "character-save", beta: "character-save" },
      accountQualification: "region-directory", accountPrefixCoherent: true, sameEndpoint: true, sameFlow: true,
      hardcoreApiObserved: apiHardcore, hardcoreSaveObserved: true, hardcoreSourcesAgree: expectedAgreement };
    expect(context!.provenance).toEqual(observedProof);

    vi.resetModules(); bridge.post.mockClear(); bridge.request.mockReset();
    let receive!: (response: EventEmitter & { statusCode: number }) => void;
    const outgoing = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    bridge.request.mockImplementation((_options, onResponse) => { receive = onResponse; return outgoing; });
    bridge.data = { context, request: { itemMask: 1_073_746_020, statFilters: [] } }; bridge.active = true;
    await import("../../src/main/market-direct-search-worker");
    expect(bridge.request).toHaveBeenCalledTimes(1); expect(outgoing.end).toHaveBeenCalledTimes(1);
    const form = new URLSearchParams(outgoing.end.mock.calls[0][0]);
    for (const [key, value] of Object.entries(context!.fields)) expect(form.get(key)).toBe(value);
    expect(form.get("checksum")).toBe(vector.expectedChecksumHex);
    expect(form.get("api_script")).toBe(evidence.publicRequestProjection.fields.api_script);
    const response = Object.assign(new EventEmitter(), { statusCode: 200 }); receive(response);
    const substitutedRejection = Buffer.from(JSON.stringify(evidence.syntheticResponses.rejection));
    response.emit("data", substitutedRejection); response.emit("end");
    await vi.waitFor(() => expect(bridge.post.mock.calls.filter(([message]) => !("type" in message))).toHaveLength(1));
    const result = bridge.post.mock.calls.map(([message]) => message).find(message => !("type" in message)) as DirectMarketWorkerResult;
    expect(result.response).toEqual({ ok: false, errorCode: "checksum_rejected" });
    expect(result.diagnostics).toMatchObject({ httpStatus: 200, applicationStatus: -3, reason: "server-rejected", serverReason: "checksum",
      dispatchStatus: "submitted", requestContext: { season: "11", hardcore: "0", beta: "0", ...observedProof } });
    expect(outgoing.end).toHaveBeenCalledTimes(1); expect(bridge.request).toHaveBeenCalledTimes(1);
    const safe = JSON.stringify(result);
    for (const key of ["account_id", "unique_account_id", "crossregion_identifier", "checksum", "multipass"]) expect(safe).not.toContain(form.get(key)!);
    expect(safe).not.toContain(scope.remoteAddress); expect(safe).not.toContain(scope.localAddress); store.dispose();
  });
  test("different numeric save slots can change the final checksum while endpoint/flow/prefix metadata remains coherent", async () => {
    // Source-shaped characterization, not proof that the owner observed another
    // slot or that slot 1 is native current. The retained native slot operand is
    // unresolved, so these metadata cannot certify selected-slot equivalence.
    bridge.active = false; vi.resetModules();
    const { buildDirectMarketRequestBody } = await import("../../src/main/market-direct-search-worker");
    const store = new CapturedSessionContextStore(undefined, () => 1_000); store.observeGameProcessIds([42]);
    const scope = { direction: "outbound" as const, remoteAddress: "203.0.113.71", remotePort: 6668,
      localAddress: "192.0.2.10", localPort: 5000, observedAt: 1_000 };
    store.observe({ ...scope, text: "invented_api unique_account_id=SYNTHETIC-OWNER-UID&crossregion_identifier=SYNTHETIC-OWNER-CROSSREGION&beta=0&hardcore=0" });
    store.applyRegionDirectory(new MarketRegionDirectory([{ address: scope.remoteAddress, port: scope.remotePort, beta: "0", region: "7" }]));
    for (const [slot, vector] of [["1", evidence.checksumVectors[0]], ["2", evidence.checksumVectors[3]]] as const) {
      store.observe({ ...scope, text: `save ${new URLSearchParams({ account_id: vector.accountRaw, slot,
        slot_data: JSON.stringify({ season: Number(vector.season), hardcore: 0 }) })}` });
      // A mode change clears beta; ordinary identity/beta renewal restores the
      // same mode evidence without identifying which slot native Market uses.
      store.observe({ ...scope, text: "invented_api unique_account_id=SYNTHETIC-OWNER-UID&crossregion_identifier=SYNTHETIC-OWNER-CROSSREGION&beta=0" });
      const current = store.marketContext(); expect(current).not.toBeNull();
      expect(current!.fields).toMatchObject({ season: vector.season, hardcore: "0", beta: "0" });
      expect(current!.provenance).toMatchObject({ sameEndpoint: true, sameFlow: true, accountPrefixCoherent: true });
      const form = new URLSearchParams(buildDirectMarketRequestBody(current!, { itemMask: 1_073_746_020, statFilters: [] }));
      expect(form.get("checksum")).toBe(vector.expectedChecksumHex);
    }
    store.dispose();
  });
});
