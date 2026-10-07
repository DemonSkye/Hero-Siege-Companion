import { afterEach, expect, test, vi } from "vitest";
import { handleMarketSearchRequest } from "../../src/main/market-search-handler";
import type { HeroSiegeCompanionApi } from "../../src/shared/ipc";
import { IpcChannel } from "../../src/shared/ipc";
import { marketSearchFixture } from "../fixtures/market";

afterEach(() => { vi.doUnmock("electron"); vi.resetModules(); });

test("actual preload invoke reaches the production Market handler and returns 20 safe sorted prices", async () => {
  let api!: HeroSiegeCompanionApi;
  const search = vi.fn(async () => ({ ok: true as const, result: {
    listings: [null, { price: "1" }, ...Array.from({ length: 25 }, (_, index) => ({ price: 25 - index, seller_uid: "CANARY_SELLER", item_data: "CANARY_ITEM", fingerprint: "CANARY_FINGERPRINT" }))],
    returnedCount: 101, totalMatches: 1_000, raw: "CANARY_RESPONSE",
  }, observedAt: 1_000, cached: false, nextAllowedSearchAt: 16_000, account_id: "CANARY_IDENTITY" }));
  const invoke = vi.fn((channel: string, request: unknown) => {
    expect(channel).toBe(IpcChannel.marketSearch);
    return handleMarketSearchRequest(request, { search: search as never });
  });
  vi.doMock("electron", () => {
    const electron = { contextBridge: { exposeInMainWorld: (_name: string, value: HeroSiegeCompanionApi) => { api = value; } }, ipcRenderer: { invoke } };
    return { ...electron, default: electron };
  });
  await import("../../src/main/preload");
  const response = await api.searchMarket(marketSearchFixture);
  expect(invoke).toHaveBeenCalledOnce();
  expect(search).toHaveBeenCalledExactlyOnceWith({ itemMask: 1_073_746_020, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] });
  expect(response).toEqual({ ok: true, result: {
    listings: Array.from({ length: 20 }, (_, index) => ({ price: index + 1 })), returnedCount: 101, totalMatches: 1_000,
  }, observedAt: 1_000, cached: false, nextAllowedSearchAt: 16_000 });
  expect(JSON.stringify(response)).not.toMatch(/CANARY|seller|fingerprint|item_data|account_id|raw/);
});

test("production handler rejects invalid input without dispatch and keeps empty/error responses distinct", async () => {
  const search = vi.fn(async () => ({ ok: true as const, result: { listings: [], returnedCount: 0 } }));
  await expect(handleMarketSearchRequest({ ...marketSearchFixture, minSockets: 7 }, { search })).resolves.toEqual({ ok: false, errorCode: "request_rejected" });
  expect(search).not.toHaveBeenCalled();
  await expect(handleMarketSearchRequest(marketSearchFixture, { search })).resolves.toEqual({ ok: true, result: { listings: [], returnedCount: 0 } });
  await expect(handleMarketSearchRequest(marketSearchFixture, null)).resolves.toEqual({ ok: false, errorCode: "helper_unavailable" });
  await expect(handleMarketSearchRequest(marketSearchFixture, { search: async () => ({ ok: false, errorCode: "checksum_rejected", nextAllowedSearchAt: 16_000 }) })).resolves.toEqual({ ok: false, errorCode: "checksum_rejected", nextAllowedSearchAt: 16_000 });
  await expect(handleMarketSearchRequest(marketSearchFixture, { search: async () => ({ ok: false, errorCode: "CANARY_SECRET" } as never) })).resolves.toEqual({ ok: false, errorCode: "helper_unavailable" });
});
