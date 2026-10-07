import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CapturedSessionContextStore, type CompleteCapturedSessionContext } from "../../src/main/captured-session-context";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";
import { extractSessionContextMessages } from "../../src/main/session-context-fields";
import { buildDirectMarketRequestBody, reduceDirectMarketResponse } from "../../src/main/market-direct-search-worker";
import evidence from "../fixtures/market-native-evidence.json";

const context: CompleteCapturedSessionContext = {
  generation: 1,
  revision: 3,
  updatedAt: 1,
  endpoint: { address: "203.0.113.10", port: 6668 },
  scopeKey: "scope",
  fields: {
    account_id: "7-424242", unique_account_id: "synthetic-uid", crossregion_identifier: "synthetic-session",
    season: "11", hardcore: "0", beta: "0",
  },
};

describe("direct market search worker", () => {
  test("builds the observed public filter/cursor shape with independently pinned synthetic authentication construction", () => {
    const form = new URLSearchParams(buildDirectMarketRequestBody(context, {
      itemMask: 1_073_746_020,
      minSockets: 4,
      statFilters: [{ statId: 64, minimum: 8 }],
    }));
    expect(Object.fromEntries(form.entries())).toMatchObject({
      account_id: "7-424242",
      checksum: evidence.checksumVectors[0].expectedChecksumHex,
      api_script: "market/market_fetch_items",
      item_sort: "2",
      scroll_page: "0",
      page_id: "99999999",
      get_highest_id: "1",
      filter_masks: "[1073746020]",
      filter_sockets_min: "4",
    });
    expect(createHash("sha256").update(form.get("multipass")!, "utf8").digest("hex"))
      .toBe(evidence.routeSignature.expectedSha256OfHex);
    expect(JSON.parse(Buffer.from(form.get("stat_filter")!, "base64").toString("utf8")))
      .toEqual(evidence.publicFilterProjection.decodedStatFilter);
  });

  test.each(evidence.checksumVectors)("canonical parser/context/form pipeline retains independent checksum for $id", vector => {
    const fields = { account_id: vector.accountRaw, unique_account_id: "synthetic-uid",
      crossregion_identifier: "synthetic-session", season: vector.season, hardcore: vector.hardcore, beta: vector.beta };
    const numeric = { ...fields, account_id: Number(vector.accountRaw), season: Number(vector.season),
      hardcore: Number(vector.hardcore), beta: Number(vector.beta) };
    for (const text of [JSON.stringify(numeric), JSON.stringify(fields), `mailbox/get_mail ${new URLSearchParams(fields)}`]) {
      expect(extractSessionContextMessages(text)[0].fields).toEqual(fields);
      const store = new CapturedSessionContextStore(undefined, () => 1_000);
      store.observeGameProcessIds([42]); store.applyRegionDirectory(new MarketRegionDirectory([
        { address: context.endpoint.address, port: context.endpoint.port, beta: vector.beta, region: "7" },
      ]));
      store.observe({ text, direction: "outbound", remoteAddress: context.endpoint.address,
        remotePort: context.endpoint.port, localAddress: "192.0.2.10", localPort: 5000, observedAt: 1_000 });
      const parsedContext = store.marketContext(); expect(parsedContext).not.toBeNull();
      expect(parsedContext!.fields).toEqual({ ...fields, account_id: vector.postedAccount });
      const form = new URLSearchParams(buildDirectMarketRequestBody(parsedContext!, { itemMask: 1_073_746_020, statFilters: [] }));
      for (const [field, expected] of Object.entries(parsedContext!.fields)) expect(form.get(field)).toBe(expected);
      expect(form.get("checksum")).toBe(vector.expectedChecksumHex);
      expect(createHash("sha256").update(form.get("multipass")!, "utf8").digest("hex"))
        .toBe(evidence.routeSignature.expectedSha256OfHex);
      expect(form.get("api_script")).toBe(evidence.publicRequestProjection.fields.api_script);
      expect(form.get("item_sort")).toBe(evidence.publicRequestProjection.productPriceSort);
      expect(form.get("filter_masks")).toBe(evidence.publicRequestProjection.fields.filter_masks);
      store.dispose();
    }
  });
  test.each(evidence.checksumVectors)("split identity, character-save mode and directory produce canonical native-grounded checksum for $id", vector => {
    const store = new CapturedSessionContextStore(undefined, () => 1_000); store.observeGameProcessIds([42]);
    const endpoint = { direction: "outbound" as const, remoteAddress: context.endpoint.address, remotePort: context.endpoint.port,
      localAddress: "192.0.2.10", localPort: 5000, observedAt: 1_000 };
    store.observe({ ...endpoint, text: `mailbox/get_mail ${new URLSearchParams({ unique_account_id: "synthetic-uid",
      crossregion_identifier: "synthetic-session", beta: vector.beta })}` });
    expect(store.marketContext()).toBeNull();
    store.observe({ ...endpoint, text: `save ${new URLSearchParams({ account_id: vector.accountRaw, slot: "1",
      slot_data: JSON.stringify({ season: Number(vector.season), hardcore: Number(vector.hardcore) }) })}` });
    expect(store.marketContext()).toBeNull();
    store.applyRegionDirectory(new MarketRegionDirectory([
      { address: context.endpoint.address, port: context.endpoint.port, beta: vector.beta, region: "7" },
    ]));
    const current = store.marketContext(); expect(current).not.toBeNull();
    expect(current!.fields).toEqual({ account_id: vector.postedAccount, unique_account_id: "synthetic-uid",
      crossregion_identifier: "synthetic-session", season: vector.season, hardcore: vector.hardcore, beta: vector.beta });
    const form = new URLSearchParams(buildDirectMarketRequestBody(current!, { itemMask: 1_073_746_020, statFilters: [] }));
    expect(form.get("checksum")).toBe(vector.expectedChecksumHex); store.dispose();
  });
  test.each(evidence.checksumVectors)("prefix/filter/UID/crossregion changes leave checksum invariant for $id", vector => {
    for (const account_id of [vector.postedAccount, vector.alternateRegionPostedAccount]) {
      for (const request of [{ itemMask: 1_073_746_020, statFilters: [] },
        { itemMask: 123, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] }]) {
        const changed = { ...context, fields: { account_id, unique_account_id: "other-synthetic-uid",
          crossregion_identifier: "other-synthetic-session", season: vector.season, hardcore: vector.hardcore, beta: vector.beta } };
        const form = new URLSearchParams(buildDirectMarketRequestBody(changed, request));
        expect(form.get("account_id")).toBe(account_id); expect(form.get("unique_account_id")).toBe("other-synthetic-uid");
        expect(form.get("crossregion_identifier")).toBe("other-synthetic-session");
        expect(form.get("checksum")).toBe(vector.expectedChecksumHex);
      }
    }
  });
  test("a complete current mode change updates both posted fields and the independently expected checksum", () => {
    const store = new CapturedSessionContextStore(undefined, () => 1_000); store.observeGameProcessIds([42]);
    for (const vector of evidence.checksumVectors) {
      const fields = { account_id: vector.postedAccount, unique_account_id: "synthetic-uid", crossregion_identifier: "synthetic-session",
        season: vector.season, hardcore: vector.hardcore, beta: vector.beta };
      store.observe({ text: JSON.stringify(fields), direction: "outbound", remoteAddress: context.endpoint.address, remotePort: context.endpoint.port });
      const current = store.marketContext(); expect(current).not.toBeNull();
      const form = new URLSearchParams(buildDirectMarketRequestBody(current!, { itemMask: 1_073_746_020, statFilters: [] }));
      expect(form.get("season")).toBe(vector.season); expect(form.get("hardcore")).toBe(vector.hardcore); expect(form.get("beta")).toBe(vector.beta);
      expect(form.get("checksum")).toBe(vector.expectedChecksumHex);
    }
    store.dispose();
  });
  test.each([
    ["hardcore", true], ["hardcore", 2], ["hardcore", "00"], ["hardcore", "false"],
    ["beta", false], ["beta", "00"], ["season", 11.5], ["season", -1],
  ])("invalid %s=%s is not coerced into a complete dispatch context", (field, value) => {
    const fields = { ...context.fields, [field]: value };
    const parsed = extractSessionContextMessages(JSON.stringify(fields))[0].fields;
    expect(parsed[field as keyof typeof parsed]).toBeUndefined();
    const store = new CapturedSessionContextStore(undefined, () => 1_000); store.observeGameProcessIds([42]);
    store.observe({ text: JSON.stringify(fields), direction: "outbound", remoteAddress: context.endpoint.address, remotePort: context.endpoint.port });
    expect(store.marketContext()).toBeNull(); store.dispose();
  });
  test("noncanonical decimal strings are preserved, with no claimed native normalization oracle", () => {
    const parsed = extractSessionContextMessages(JSON.stringify({ ...context.fields, season: "0011" }))[0].fields;
    expect(parsed.season).toBe("0011");
    const noncanonical = { ...context, fields: { ...context.fields, season: "0011" } };
    const form = new URLSearchParams(buildDirectMarketRequestBody(noncanonical, { itemMask: 1_073_746_020, statFilters: [] }));
    expect(form.get("season")).toBe("0011");
    // No expected native checksum is available for this representation.
  });
  test("reduces a substituted compressed response to safe sorted price listings", () => {
    const response = evidence.syntheticResponses.success;
    const items = deflateSync(Buffer.from(JSON.stringify(response.decodedItems))).toString("base64");
    expect(reduceDirectMarketResponse(Buffer.from(JSON.stringify({ status: response.status, itemCount: response.itemCount, items })), 200))
      .toEqual({ ok: true, result: evidence.syntheticResponses.expectedSuccess });
  });
  test("documented decimal string unit_price is safely projected without seller data", () => {
    const response = evidence.syntheticResponses.success;
    expect(response.decodedItems.find(item => item.unit_price !== undefined)?.unit_price).toBe("100000");
    const items = deflateSync(Buffer.from(JSON.stringify(response.decodedItems))).toString("base64");
    const reduced = reduceDirectMarketResponse(Buffer.from(JSON.stringify({ status: response.status, itemCount: response.itemCount, items })), 200);
    expect(reduced).toMatchObject({ ok: true, result: { listings: [{ price: 200_000, unitPrice: 100_000 }, { price: 500_000 }, { price: 900_000 }], returnedCount: 3 } });
    expect(JSON.stringify(reduced)).not.toMatch(/unit_price|synthetic-seller|synthetic-a/);
  });
  test("HTTP 200 with the observed application rejection status fails instead of manufacturing empty success", () => {
    expect(reduceDirectMarketResponse(Buffer.from(JSON.stringify(evidence.syntheticResponses.rejection)), evidence.observedOutcomes.rejectedHttpStatus))
      .toEqual(evidence.syntheticResponses.expectedRejection);
  });
});
