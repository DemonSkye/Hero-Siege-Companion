import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { buildMarketFetchItemsMultipass } from "../../src/main/market-multipass";

describe("market multipass", () => {
  test("matches the retained native market_fetch_items route signature", () => {
    const multipass = buildMarketFetchItemsMultipass();

    expect(multipass).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash("sha256").update(multipass, "utf8").digest("hex"))
      .toBe("4bf9d17b8f92460f781fd3fc65dbd133c8f2e76953b67fc06f550551937b3f1b");
  });
});
