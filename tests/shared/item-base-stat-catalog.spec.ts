import { expect, test } from "vitest";
import { activeItemCatalog } from "../../src/shared/item-catalog";
import { ITEM_BASE_STAT_CATALOG, itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { ITEM_STAT_DEFINITIONS } from "../../src/shared/item-stat-ranges";
import { normalizeMarketSearchRequest, normalizeMarketFilterCriteria, marketStatMinimumIssue } from "../../src/shared/market-search";
import { marketBaseStatValue } from "../../src/renderer/src/lib/market-stat-display";
import { EXPECTED_GROUNDED_MARKET_STAT_IDS } from "../fixtures/market-grounded-stat-ids";
import { EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7 } from "../fixtures/market-stat-meaning-gaps-v7";

test("every retained item identity has an explicit versioned static definition", () => {
  const identities = [...activeItemCatalog.artifact.definitions, ...activeItemCatalog.artifact.missing];
  expect(identities).toHaveLength(2035);
  expect(ITEM_BASE_STAT_CATALOG.items).toHaveLength(2035);
  expect(ITEM_BASE_STAT_CATALOG.steamBuild).toBe(24868792);
  for (const id of identities) {
    expect(itemBaseStatDefinition(`${id.repository}:${id.type}:${id.weaponType}:${id.gameId}`)).not.toBeNull();
  }
  expect(ITEM_BASE_STAT_CATALOG.items.filter(item => item.stats.length > 0)).toHaveLength(1636);
  expect(ITEM_BASE_STAT_CATALOG.items.flatMap(item => item.stats)).toHaveLength(9584);
  expect(ITEM_STAT_DEFINITIONS.filter(item => item.verifiedListingRolls)).toHaveLength(2);
});

// Literal expectations transcribed from independently retained typed operands.
// These are constructor values; no instance seed or generated tooltip is used.
test.each([
  ["normal:0:0:0",154,"range",4,8],
  ["normal:1:0:0",154,"range",10,18],
  ["normal:3:1:0",22,"range",5,7],
  ["normal:3:1:0",23,"scalar",1.75,1.75],
  ["normal:7:0:6",196,"range",10,12],
  ["normal:15:0:1",74,"scalar",50,50],
  ["runeword:3:0:0",28,"range",730,880],
  ["unique:1:0:100",271,"range",6,12],
  ["unique:1:0:100",201,"scalar",2,2],
  ["unique:1:0:100",154,"range",210,240],
  ["unique:10:0:92",266,"range",15,25],
] as const)("preserves native constructor values for %s stat %i", (key,id,kind,minimum,maximum) => {
  expect(itemBaseStatDefinition(key)?.stats.find(stat => stat.statId === id)).toMatchObject({ statId:id,kind,minimum,maximum });
});

test("cloak has all fourteen fields while Tiny's constructor has exactly one affix", () => {
  expect(itemBaseStatDefinition("unique:1:0:100")?.stats.map(s => s.statId)).toEqual([154,29,31,201,271,57,64,33,71,74,116,117,118,20]);
  expect(itemBaseStatDefinition("unique:10:0:92")?.stats).toEqual([{statId:266,kind:"range",minimum:15,maximum:25}]);
});

test("relic tables and dynamic tablet fields retain their distinct meaning", () => {
  const series = itemBaseStatDefinition("normal:16:0:0")!.stats.find(s => s.statId === 186)!;
  expect(series).toMatchObject({kind:"series",values:[1,2,3,4,5,6,7,8,9,10]});
  expect(marketBaseStatValue(series)).toBe("Table: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10");
  expect(itemBaseStatDefinition("normal:11:0:18")?.stats).toContainEqual({statId:347,kind:"dynamic",description:"Tablet zones"});
  expect(itemBaseStatDefinition("normal:11:0:18")?.complete).toBe(false);
  expect(itemBaseStatDefinition("normal:11:0:23")?.complete).toBe(false);
});

test.each([
  ["unique:0:0:0",62,"scalar",1.5],
  ["unique:3:1:25",20,"scalar",2],
  ["unique:3:7:1",20,"scalar",3],
] as const)("later unconditional setter wins for %s stat %i", (key,id,kind,value) => {
  expect(itemBaseStatDefinition(key)?.stats.filter(s => s.statId === id)).toEqual([{statId:id,kind,minimum:value,maximum:value}]);
});

test("Witch's Wand's later range replaces its earlier range", () => {
  const stat = itemBaseStatDefinition("unique:3:10:12")!.stats.find(s => s.statId === 303)!;
  expect(stat).toEqual({statId:303,kind:"range",minimum:75,maximum:125});
  expect(marketBaseStatValue(stat)).toBe("75\u2013125");
});

test("every grounded stat is durable, but metadata and unresolved shapes cannot become scalar requests", () => {
  expect(ITEM_BASE_STAT_CATALOG.stats).toHaveLength(381);
  expect(ITEM_BASE_STAT_CATALOG.stats.map(stat => stat.statId)).toEqual([...EXPECTED_GROUNDED_MARKET_STAT_IDS]);
  for (const statId of EXPECTED_GROUNDED_MARKET_STAT_IDS) {
    // Independent frozen v5 classification, not derived from production logic.
    const blocked = new Set<number>([...EXPECTED_UNRESOLVED_MARKET_STAT_IDS_V7,20,98,100,185,186,187,299]).has(statId);
    expect(normalizeMarketFilterCriteria({statFilters:[{statId,minimum:2.5}]}).ok).toBe(true);
    if (blocked) {
      expect(normalizeMarketSearchRequest({itemMask:1073746020,statFilters:[{statId,minimum:2.5}]})).toEqual({ok:false,reason:"unsupported-stat-minimum"});
      continue;
    }
    expect(normalizeMarketSearchRequest({itemMask:1073746020,statFilters:[{statId,minimum:2.5}]})).toEqual({
      ok:true,request:{itemMask:1073746020,statFilters:[{statId,minimum:2.5}]},
    });
  }
  expect(normalizeMarketSearchRequest({itemMask:1073746020,statFilters:[{statId:999999,minimum:1}]})).toEqual({ok:false,reason:"unknown-stat-id"});
});

test("experimental table fields are blocked for the selected definition while scalar and native controls remain distinct", () => {
  // Stat 35 is a series on Whip but a scalar on other definitions. Native stat
  // 25 has table uses too: its retained native minimum control remains valid.
  expect(marketStatMinimumIssue(35,"normal:16:0:23")).toMatch(/table/);
  expect(normalizeMarketSearchRequest({itemMask:65559,statFilters:[{statId:35,minimum:1}]})).toEqual({ok:false,reason:"unsupported-stat-minimum"});
  expect(marketStatMinimumIssue(35,"unique:1:0:100")).toBeNull();
  expect(marketStatMinimumIssue(25)).toBeNull();
  expect(marketStatMinimumIssue(20)).toMatch(/Minimum sockets/);
  expect(normalizeMarketSearchRequest({itemMask:65538,minSockets:4,statFilters:[]})).toMatchObject({ok:true});
  expect(ITEM_BASE_STAT_CATALOG.stats.find(s=>s.statId===186)?.name).toBe("Skill parameter 186");
  expect(ITEM_BASE_STAT_CATALOG.stats.find(s=>s.statId===187)?.name).toBe("Skill parameter 187");
});
