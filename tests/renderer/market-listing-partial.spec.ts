import fs from "node:fs";
import { EventEmitter } from "node:events";
import { deflateSync } from "node:zlib";
import { mount } from "@vue/test-utils";
import { expect, test, vi } from "vitest";
import MarketListingDetails from "../../src/renderer/src/components/MarketListingDetails.vue";
import { sanitizeMarketListingItem } from "../../src/shared/market-listing-item";
import { sanitizeMarketSearchResult } from "../../src/shared/market-search";
import type { CompleteCapturedSessionContext } from "../../src/main/captured-session-context";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ default: { request: transport.request } }));
import { runDirectMarketWorker } from "../../src/main/market-direct-search-worker";

test("UI distinguishes reconstructed numeric siblings from explicit unknown fields", async () => {
  const item = sanitizeMarketListingItem({ itemKey: "unique:3:17:0", identified: true,
    stats: [{ statId: 22, value: 1 }, { statId: 23, value: 1.5 }], fingerprint: "CANARY", seed: "CANARY" })!;
  const wrapper = mount(MarketListingDetails, { props: { item } });
  try {
    expect(wrapper.text()).toContain("Reconstructed listing stats (experimental)");
    expect(wrapper.get(".market-listing-unavailable summary").text()).toBe("1 field unavailable");
    await wrapper.get(".market-listing-unavailable summary").trigger("click");
    expect(wrapper.text()).toContain("Invalid listing value");
    expect(wrapper.text()).not.toMatch(/CANARY|1\.5|fingerprint|seed/);
    expect(wrapper.findAll(".market-listing-stats")[0].findAll("li")).toHaveLength(1);
  } finally { wrapper.unmount(); }
});

async function workerToUi(body: Buffer) {
  transport.request.mockImplementation((_options, accept) => {
    const request = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      accept(response);
      response.emit("data", body.subarray(0, 7)); response.emit("data", body.subarray(7)); response.emit("end");
    });
    return request;
  });
  const context: CompleteCapturedSessionContext = {
    generation: 4, revision: 17, updatedAt: Date.now(), scopeKey: "synthetic-listing-scope", endpoint: { address: "203.0.113.71", port: 6668 },
    fields: { account_id: "7-424242", unique_account_id: "CANARY-UID", crossregion_identifier: "CANARY-SESSION", season: "11", hardcore: "0", beta: "0" },
    provenance: { fieldSources: { account_id: "region-directory", unique_account_id: "game-api", crossregion_identifier: "game-api", season: "character-save", hardcore: "character-save", beta: "game-api" },
      accountQualification: "region-directory", accountPrefixCoherent: true, sameEndpoint: true, sameFlow: true, hardcoreSourcesAgree: true, hardcoreApiObserved: true, hardcoreSaveObserved: true },
  };
  const terminal = await runDirectMarketWorker({ context, request: { itemMask: 1073762308, statFilters: [] } }, () => {});
  if (!terminal.response.ok) throw new Error(terminal.response.errorCode);
  const result = sanitizeMarketSearchResult(terminal.response.result);
  expect(JSON.stringify(result)).not.toMatch(/CANARY|fingerprint|item_data|"a":|"sh":|seller/);
  return result;
}

test("compressed response uses real worker, sanitization and renderer for glove rolls and guarded modifiers", async () => {
  const rows = [
    { price: 1, fingerprint: "SYNTHETIC-0-0-3", item_data: { a: 1000, b: 0, c: 1, j: 17, d: 1, e: 11, w: 1 } },
    { price: 2, fingerprint: "SYNTHETIC-0-0-4", item_data: { a: 1000, b: 62, c: 1, d: 24, e: 11, w: 1, sh: "CANARY" }, seller_name: "CANARY" },
    { price: 3, fingerprint: "SYNTHETIC-0-0-4", item_data: { a: 1000, b: 62, c: 1, d: 24, e: 11, w: 1, p: 1 }, seller_name: "CANARY" },
  ];
  const body = Buffer.from(JSON.stringify({ status: 1, itemCount: 3, items: deflateSync(Buffer.from(JSON.stringify(rows))).toString("base64") }));
  const result = await workerToUi(body);
  expect(result.returnedCount).toBe(3);
  expect(result.listings[0].item?.stats).toContainEqual({ statId: 23, value: 1.25 });
  expect(result.listings[1].item?.stats).toContainEqual({ statId: 31, value: 0.5 });
  expect(result.listings[2].item?.unknownStats).toHaveLength(9);
  for (const listing of result.listings) {
    const wrapper = mount(MarketListingDetails, { props: { item: listing.item } });
    try {
      if (listing.price === 1) expect(wrapper.text()).toContain("1.25");
      else if (listing.price === 2) {
        expect(wrapper.text()).toContain("Reconstructed listing stats (experimental)");
        expect(wrapper.text()).toContain("Enhanced Damage per level0.5%");
        expect(wrapper.findAll(".market-listing-stats li")).toHaveLength(9);
        expect(wrapper.find(".market-listing-unavailable").exists()).toBe(false);
      } else {
        expect(wrapper.text()).toContain("9 fields unavailable");
        expect(wrapper.text()).toContain("Modifier effects unavailable");
        expect(wrapper.text()).not.toContain("0.5");
      }
    } finally { wrapper.unmount(); }
  }
});

test.skipIf(!process.env.HSC_PRIVATE_MARKET_REPLAY)("original 101-record page crosses real worker, sanitized projection and real UI without exporting private rows", async () => {
  const events = fs.readFileSync(process.env.HSC_PRIVATE_MARKET_REPLAY!, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  const end = events.find(event => event.event === "end");
  expect(end.completeResponse === true && end.truncated === false).toBe(true);
  let offset = 0;
  const chunks = events.filter(event => event.event === "response-chunk").sort((a, b) => a.offset - b.offset).map(event => {
    const chunk = Buffer.from(event.base64, "base64");
    expect(event.offset === offset && event.bytes === chunk.length).toBe(true);
    offset += chunk.length;
    return chunk;
  });
  const body = Buffer.concat(chunks);
  expect(body.length).toBe(8305);
  const result = await workerToUi(body);
  expect(result.returnedCount).toBe(101);
  expect(result.listings).toHaveLength(20);
  let known = 0;
  for (const listing of result.listings) {
    const wrapper = mount(MarketListingDetails, { props: { item: listing.item } });
    try {
      expect(listing.item?.itemKey === "unique:4:0:62").toBe(true);
      if (listing.item?.stats?.length) {
        known++;
        expect(listing.item.stats.length === 9 && listing.item.stats.some(stat => stat.statId === 31 && stat.value === 0.5)).toBe(true);
        expect(wrapper.text().includes("Reconstructed listing stats (experimental)") && wrapper.text().includes("Enhanced Damage per level0.5%")).toBe(true);
        expect(!wrapper.text().includes("Tier effects unavailable")).toBe(true);
      } else expect(wrapper.text().includes("Modifier effects unavailable") || wrapper.text().includes("Unidentified")).toBe(true);
      // Use booleans so a failure cannot print an original compact record.
      expect(!/fingerprint|item_data|"a":|"sh":|seller/.test(wrapper.html())).toBe(true);
    } finally { wrapper.unmount(); }
  }
  // Independently counted retained page with unchanged price ordering/cap:
  // 14 eligible, one modified and five unidentified among the 20 shown rows.
  expect(known).toBe(14);
  expect(result.listings.filter(listing => listing.item?.statsReason === "unsupported-variant")).toHaveLength(1);
  expect(result.listings.filter(listing => listing.item?.statsReason === "unidentified")).toHaveLength(5);
});
