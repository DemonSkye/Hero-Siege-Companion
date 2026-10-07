import { describe, expect, test } from "vitest";
import { buildMarketFetchItemsChecksum } from "../../src/main/market-checksum";
import evidence from "../fixtures/market-native-evidence.json";

describe("market checksum", () => {
  // Expectations were independently computed using the retained native operand
  // and .NET SHA256; identities are synthetic and no server accepted these forms.
  test.each(evidence.checksumVectors)("matches independent native-grounded known answer $id", vector => {
    for (const account_id of [vector.accountRaw, vector.postedAccount, vector.alternateRegionPostedAccount]) {
      expect(buildMarketFetchItemsChecksum({ account_id, season: vector.season,
        hardcore: vector.hardcore, beta: vector.beta })).toBe(vector.expectedChecksumHex);
    }
  });
  test("each canonical season/HC/beta change produces its independently pinned checksum", () => {
    const computed = evidence.checksumVectors.map(vector => buildMarketFetchItemsChecksum({
      account_id: vector.postedAccount, season: vector.season, hardcore: vector.hardcore, beta: vector.beta,
    }));
    expect(computed).toEqual(evidence.checksumVectors.map(vector => vector.expectedChecksumHex));
    expect(new Set(computed).size).toBe(5);
  });
});
