import { expect, test } from "vitest";
import { itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { marketStatMinimumIssue, normalizeMarketFilterCriteria, normalizeMarketSearchRequest } from "../../src/shared/market-search";
import { unresolvedMarketStatMeaning } from "../../src/shared/market-stat-capabilities";
import { marketBaseStatValue } from "../../src/renderer/src/lib/market-stat-display";
import { EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7 } from "../fixtures/market-stat-meaning-gaps-v7";

test("all 84 unresolved meanings remain durable reference fields but cannot become ordinary minimum clauses", () => {
  expect(EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7).toHaveLength(84);
  expect(new Set(EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7).size).toBe(84);
  const blocked = new Set<number>([...EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7,20,98,100,185,186,187,299]);
  expect(blocked.size).toBe(91);
  for (const statId of blocked) {
    expect(marketStatMinimumIssue(statId)).not.toBeNull();
    expect(normalizeMarketFilterCriteria({statFilters:[{statId,minimum:1}]}).ok).toBe(true);
    expect(normalizeMarketSearchRequest({runewordId:81,statFilters:[{statId,minimum:1}]})).toEqual({ok:false,reason:"unsupported-stat-minimum"});
  }
  for (const statId of [64,271,351]) expect(normalizeMarketSearchRequest({runewordId:81,statFilters:[{statId,minimum:1}]}).ok).toBe(true);
});

test("runtime composition and encoded contexts retain qualified meaning without fabricated names or scalar bounds", () => {
  expect(unresolvedMarketStatMeaning(203)).toBe("runtime-composite-localized-value");
  expect(marketStatMinimumIssue(203)).toMatch(/runtime text/);
  expect(unresolvedMarketStatMeaning(291)).toBe("encoded-flag-context");
  expect(marketStatMinimumIssue(292)).toMatch(/encoded contexts/);
  // The typed context takes precedence in the presentation; the independently
  // retained numeric projection is still preserved for evidence/reconciliation.
  const encoded = itemBaseStatDefinition("runeword-repository:23")!.stats.find(stat=>stat.statId===292)!;
  expect(encoded).toMatchObject({statId:292,kind:"scalar",minimum:1,maximum:1});
  expect(marketBaseStatValue(encoded,"runeword-repository:23")).toBe("Encoded field; meaning unverified");
  expect(marketBaseStatValue(encoded,"runeword:3:0:3")).toBe("Encoded field; meaning unverified");
  expect(marketBaseStatValue({statId:271,kind:"range",minimum:6,maximum:12},"unique:1:0:100")).toBe("6–12");
});
