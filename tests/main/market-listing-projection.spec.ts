import { deflateSync } from "node:zlib";
import { expect, test } from "vitest";
import fixture from "../fixtures/market-listing-items.json";
import { projectMarketListingItem } from "../../src/main/market-listing-projection";
import { inspectDirectMarketResponse } from "../../src/main/market-direct-response";
import { handleMarketSearchRequest } from "../../src/main/market-search-handler";
import { MarketResultCache } from "../../src/main/market-result-cache";
import { sanitizeMarketSearchResult } from "../../src/shared/market-search";
import { itemStatDefinition } from "../../src/shared/item-stat-ranges";

test.each(fixture.specimens)("reconstructs $name against separately observed tooltip values", specimen => {
  const result = projectMarketListingItem(specimen.row.item_data, specimen.row.fingerprint);
  expect(result?.identified).toBe(true);
  expect(Object.fromEntries(result!.stats!.map(stat => [stat.statId, stat.value]))).toEqual(specimen.expectedStats);
  expect(result).not.toHaveProperty("statsReason");
  expect(JSON.stringify(result)).not.toMatch(/fingerprint|SYNTHETIC|seed|"a"|"sh"/);
  const changed = projectMarketListingItem({ ...specimen.row.item_data, a: 12345 }, specimen.row.fingerprint);
  expect(changed?.stats).not.toEqual(result?.stats);
});

test("Tiny Planet expands retained constructor facts with explicit experimental confidence", () => {
  const item = projectMarketListingItem({ c: 1, b: 92, j: 0, d: 1, e: 11, w: 1, a: 618478963 }, "SYNTHETIC-0-0-10");
  expect(item).toEqual({ itemKey: "unique:10:0:92", identified: true, stats: [{ statId: 266, value: 22 }], statsExperimental: true });
  // Sanitization derives experimental confidence rather than trusting a cache flag.
  const result = sanitizeMarketSearchResult({ listings: [{ price: 1,
    item: { itemKey: "unique:10:0:92", identified: true, statsExperimental: false, stats: [{ statId: 266, value: 22 }] } }] });
  expect(result.listings[0].item).toEqual(item);
  expect(itemStatDefinition("unique:10:0:92")?.stats).toEqual([{
    statId: 266, name: "Increased Orbital Projectile Duration", minimum: 15, maximum: 25, kind: "range", unit: "percent",
  }]);
});

test("does not reveal unidentified rolls or guess modified, corrupt or unsupported items", () => {
  const { row } = fixture.specimens[0];
  expect(projectMarketListingItem({ ...row.item_data, w: 0 }, row.fingerprint)).toEqual({
    itemKey: "unique:6:0:38", identified: false, statsReason: "unidentified",
  });
  for (const patch of [{ q: 1 }, { zz: { sockets: 6 } }, { s1: {} }, { p: 1 }, { r: 1 },
    { a: -1 }, { a: NaN }, { a: 2 ** 32 }, { unknownModifier: 0 }]) {
    const projected = projectMarketListingItem({ ...row.item_data, ...patch }, row.fingerprint);
    expect(projected).toMatchObject({ itemKey: "unique:6:0:38", identified: true, statsReason: "unsupported-variant" });
    expect(projected?.stats).toBeUndefined();
    expect(projected?.unknownStats).toHaveLength(9);
  }
  for (const patch of [{ m: 0 }, { d: 5 }, { e: 10 }, { j: 1 }, { p: 0, r: 0 }])
    expect(projectMarketListingItem({ ...row.item_data, ...patch }, row.fingerprint)?.stats).toEqual(projectMarketListingItem(row.item_data, row.fingerprint)?.stats);
  const captured = projectMarketListingItem(fixture.capturedRows[0].item_data, fixture.capturedRows[0].fingerprint);
  expect(captured?.itemKey).toBe("unique:4:0:62");
  expect(captured).not.toHaveProperty("stats");
  expect(projectMarketListingItem("invalid-json", row.fingerprint)).toBeNull();
  expect(projectMarketListingItem(row.item_data, "no-type-proof")).toBeNull();
  expect(projectMarketListingItem({ ...row.item_data, b: 4095 }, row.fingerprint)).toBeNull();
});

test("compressed response, IPC allowlist and cache retain rolls without retaining raw listing data", async () => {
  const rows = [fixture.specimens[1].row, fixture.specimens[0].row].map(row => ({ ...row,
    seller_uid: "CANARY_SELLER", seller_name: "CANARY_NAME", market_id: "CANARY_MARKET",
    item_data: JSON.stringify({ ...row.item_data, sh: "CANARY_HASH" }),
  }));
  const body = Buffer.from(JSON.stringify({ status: 1, itemCount: 2,
    items: deflateSync(Buffer.from(JSON.stringify(rows))).toString("base64") }));
  const inspected = inspectDirectMarketResponse(body, 200).response;
  const response = await handleMarketSearchRequest({ itemMask: 1073766438, statFilters: [] }, {
    search: async () => inspected, readiness: () => null,
  } as never);
  if (!response.ok) throw new Error(response.errorCode);
  expect(response.result.listings.map(listing => listing.price)).toEqual([25000, 35000]);
  expect(response.result.listings[0].item?.stats?.find(stat => stat.statId === 60)?.value).toBe(439);
  expect(response.result.listings[1].item?.stats?.find(stat => stat.statId === 33)?.value).toBe(27);
  const cache = new MarketResultCache(() => 1000);
  cache.set("fixture", response.result);
  expect(cache.get("fixture")?.result).toEqual(response.result);
  expect(JSON.stringify(response)).not.toMatch(/CANARY|seller|fingerprint|item_data|"a":|"sh":/);
  // Mutation of caller-owned arrays cannot change the next sanitized cache read.
  response.result.listings[0].item!.stats![0].value = 999;
  expect(cache.get("fixture")?.result.listings[0].item?.stats?.[0].value).not.toBe(999);
});

test("malformed or partial IPC fields remain explicitly unknown without discarding independent valid fields", () => {
  const { row } = fixture.specimens[0];
  const item = projectMarketListingItem(row.item_data, row.fingerprint)!;
  const malformed = [item.stats!.slice(1), [...item.stats!, item.stats![0]],
    item.stats!.map((stat, index) => index ? stat : { ...stat, value: 999 }),
    item.stats!.map((stat, index) => index ? stat : { ...stat, value: "13" }),
  ];
  for (const stats of malformed) {
    const result = sanitizeMarketSearchResult({ listings: [{ price: 1, item: { ...item, stats, seller: "CANARY" } }] });
    const projected = result.listings[0].item!;
    expect(projected.stats).toHaveLength(8);
    expect(projected.unknownStats).toEqual([{ statId: item.stats![0].statId,
      reason: stats.length === 8 ? "not-reconstructed" : "invalid-projection" }]);
    expect(projected.stats).not.toContainEqual(item.stats![0]);
    expect(JSON.stringify(projected)).not.toContain("CANARY");
  }
});
