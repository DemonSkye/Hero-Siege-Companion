import { describe, expect, test } from "vitest";
import { buildMarketFetchItemsChecksum } from "../../src/main/market-checksum";

describe("market checksum", () => {
  test("matches the native market formula and strips the posted region prefix", () => {
    const context = { account_id: "na-42", season: "11", hardcore: "0", beta: "0" };

    expect(buildMarketFetchItemsChecksum(context)).toBe(
      "9bd66f31a01793b0c6dee8610d46b72e604467449b86ef9ca8dec0058a4354d8",
    );
    expect(buildMarketFetchItemsChecksum({ ...context, account_id: "42" }))
      .toBe(buildMarketFetchItemsChecksum(context));
  });
});
