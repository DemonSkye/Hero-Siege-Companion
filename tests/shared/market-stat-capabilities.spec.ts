import { expect, test } from "vitest";
import { itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { MARKET_STAT_OPTIONS, marketStatMinimumIssue, normalizeMarketFilterCriteria, normalizeMarketSearchRequest } from "../../src/shared/market-search";
import { unresolvedMarketStatMeaning } from "../../src/shared/market-stat-capabilities";
import { marketBaseStatValue } from "../../src/renderer/src/lib/market-stat-display";
import { EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7 } from "../fixtures/market-stat-meaning-gaps-v7";
import { EXPECTED_NO_GENERIC_MINIMUM_IDS_V8 } from "../fixtures/market-stat-roles-v8";

test("unknown labels and composed labels do not block approved experimental numeric clauses", () => {
  expect(EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7).toHaveLength(84);
  expect(new Set(EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7).size).toBe(84);
  const blocked = new Set<number>(EXPECTED_NO_GENERIC_MINIMUM_IDS_V8);
  expect(MARKET_STAT_OPTIONS.filter(option=>marketStatMinimumIssue(option.statId)).map(option=>option.statId).sort((a,b)=>a-b)).toEqual([...EXPECTED_NO_GENERIC_MINIMUM_IDS_V8]);
  for (const statId of blocked) {
    expect(marketStatMinimumIssue(statId)).not.toBeNull();
    expect(normalizeMarketFilterCriteria({statFilters:[{statId,minimum:1}]}).ok).toBe(true);
    expect(normalizeMarketSearchRequest({runewordId:81,statFilters:[{statId,minimum:1}]})).toEqual({ok:false,reason:"unsupported-stat-minimum"});
  }
  for (const statId of [...EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7,98,100,186,187,299,64,271,351].filter(id=>!blocked.has(id))) {
    expect(normalizeMarketSearchRequest({itemMask:1073746020,statFilters:[{statId,minimum:1}]})).toEqual({ok:true,request:{itemMask:1073746020,statFilters:[{statId,minimum:1}]}});
  }
  expect(MARKET_STAT_OPTIONS.find(option=>option.statId===22)?.name).toBe("Base Attack Damage (experimental)");
  expect(MARKET_STAT_OPTIONS.find(option=>option.statId===203)?.name).toBe("Selected talent modifier (Stat 203) (experimental)");
});

test.each([
  [114,"normal:16:0:6",65542,"unique:8:0:23"],
  [115,"normal:16:0:52",65588,"unique:8:0:23"],
  [117,"normal:16:0:3",65539,"unique:4:0:4"],
  [118,"normal:16:0:34",65570,"unique:4:0:4"],
  [123,"normal:16:0:119",65655,"unique:8:0:50"],
  [126,"normal:16:0:70",65606,"unique:8:0:40"],
  [203,"normal:16:0:1",65537,"unique:4:0:8"],
  [186,"normal:16:0:0",65536,"unique:8:0:15"],
] as const)("stat %i blocks its actual table context while allowing its numeric context",(id,tableKey,tableMask,scalarKey)=>{
  // Literal retained v5 constructor contexts, independent of capability logic.
  expect(itemBaseStatDefinition(tableKey)?.stats.find(stat=>stat.statId===id)?.kind).toBe("series");
  expect(marketStatMinimumIssue(id,tableKey)).toMatch(/table/);
  expect(normalizeMarketSearchRequest({itemMask:tableMask,statFilters:[{statId:id,minimum:1}]})).toEqual({ok:false,reason:"unsupported-stat-minimum"});
  expect(["range","scalar"]).toContain(itemBaseStatDefinition(scalarKey)?.stats.find(stat=>stat.statId===id)?.kind);
  expect(marketStatMinimumIssue(id,scalarKey)).toBeNull();
});

test("runtime composition and encoded contexts retain qualified meaning without fabricated names or scalar bounds", () => {
  expect(unresolvedMarketStatMeaning(203)).toBeNull();
  expect(marketStatMinimumIssue(203)).toBeNull();
  expect(unresolvedMarketStatMeaning(291)).toBeNull();
  expect(marketStatMinimumIssue(292)).toMatch(/effect-presence/);
  // The typed context takes precedence in the presentation; the independently
  // retained numeric projection is still preserved for evidence/reconciliation.
  const encoded = itemBaseStatDefinition("runeword-repository:23")!.stats.find(stat=>stat.statId===292)!;
  expect(encoded).toMatchObject({statId:292,kind:"scalar",minimum:1,maximum:1});
  expect(marketBaseStatValue(encoded,"runeword-repository:23")).toBe("Conditional effect (encoded)");
  expect(marketBaseStatValue(encoded,"runeword:3:0:3")).toBe("Conditional effect (encoded)");
  expect(marketBaseStatValue({statId:271,kind:"range",minimum:6,maximum:12},"unique:1:0:100")).toBe("6–12");
});
