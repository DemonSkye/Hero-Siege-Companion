import { deflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import type { CompleteCapturedSessionContext } from "../../src/main/captured-session-context";
import { buildMarketFetchItemsChecksum } from "../../src/main/market-checksum";
import { buildMarketFetchItemsMultipass } from "../../src/main/market-multipass";
import { buildDirectMarketRequestBody, reduceDirectMarketResponse } from "../../src/main/market-direct-search-worker";

const context: CompleteCapturedSessionContext = {
  generation: 1,
  revision: 3,
  updatedAt: 1,
  endpoint: { address: "203.0.113.10", port: 6668 },
  scopeKey: "scope",
  fields: {
    account_id: "na-42", unique_account_id: "hero-7", crossregion_identifier: "session",
    season: "11", hardcore: "0", beta: "0",
  },
};

describe("direct market search worker", () => {
  test("builds one ordinary market POST from an in-memory captured context", () => {
    const form = new URLSearchParams(buildDirectMarketRequestBody(context, {
      itemMask: 1_073_746_020,
      minSockets: 4,
      statFilters: [{ statId: 64, minimum: 8 }],
    }));
    expect(Object.fromEntries(form.entries())).toMatchObject({
      account_id: "na-42",
      checksum: buildMarketFetchItemsChecksum(context.fields),
      multipass: buildMarketFetchItemsMultipass(),
      api_script: "market/market_fetch_items",
      item_sort: "2",
      scroll_page: "0",
      page_id: "99999999",
      get_highest_id: "1",
      filter_masks: "[1073746020]",
      filter_sockets_min: "4",
    });
    expect(JSON.parse(Buffer.from(form.get("stat_filter")!, "base64").toString("utf8"))).toEqual([
      { statId: 64, filter: 2, statValue: 8 },
    ]);
  });

  test("reduces the compressed response to two safe lowest-price listings", () => {
    const items = deflateSync(Buffer.from(JSON.stringify([
      { id: "private-a", price: 500_000 },
      { id: "private-b", price: 200_000, unit_price: 100_000 },
      { id: "private-c", price: 900_000 },
    ]))).toString("base64");
    expect(reduceDirectMarketResponse(Buffer.from(JSON.stringify({ status: 1, itemCount: 3, items })), 200)).toEqual({
      ok: true,
      result: { listings: [{ price: 200_000, unitPrice: 100_000 }, { price: 500_000 }], totalMatches: 3 },
    });
  });
});
