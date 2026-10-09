import { expect, test } from "vitest";
import { MARKET_PROC_FAMILIES_V8 } from "../../src/shared/data/market-stat-roles-build-24868792";
import { ITEM_BASE_STAT_CATALOG, itemBaseStatMetadata } from "../../src/shared/item-base-stat-catalog";
import { MARKET_STAT_OPTIONS, marketStatMinimumIssue, marketStatOption, normalizeMarketFilterCriteria, normalizeMarketSearchRequest } from "../../src/shared/market-search";
import { marketStatRole, unresolvedMarketStatMeaning } from "../../src/shared/market-stat-capabilities";
import { marketBaseStatValue } from "../../src/renderer/src/lib/market-stat-display";
import { EXPECTED_CLASS_IDS_V8, EXPECTED_TALENT_IDS_V8, EXPECTED_PROC_FAMILIES_V8, EXPECTED_EXACT_LABELS_V8,
  EXPECTED_NO_GENERIC_MINIMUM_IDS_V8, EXPECTED_UNRESOLVED_MEANING_IDS_V8 } from "../fixtures/market-stat-roles-v8";

test("v8 exact text remains separate from qualified roles, numeric quantities and unknown fallbacks",()=>{
  expect(ITEM_BASE_STAT_CATALOG.stats).toHaveLength(383);
  expect(ITEM_BASE_STAT_CATALOG.stats.filter(stat=>stat.nativeMarketMenu)).toHaveLength(167);
  for(const [statId,localizationKey,name] of EXPECTED_EXACT_LABELS_V8){
    expect(itemBaseStatMetadata(statId)).toMatchObject({statId,localizationKey,name,nativeMarketMenu:false});
    expect(marketStatOption(statId)?.name).toBe(`${name} (experimental)`);
  }
  expect(itemBaseStatMetadata(22)?.name).toBe("Stat 22");
  expect(marketStatOption(22)?.name).toBe("Base Attack Damage (experimental)");
  expect(marketStatOption(22)?.description).toContain("Attack Damage as this value raised by Enhanced Damage");
  expect(itemBaseStatMetadata(23)?.name).toBe("Stat 23");
  expect(itemBaseStatMetadata(390)?.unit).toBe("seconds");
  expect(marketBaseStatValue({statId:390,kind:"range",minimum:5,maximum:7})).toBe("5 s\u20137 s");
  for(const id of EXPECTED_UNRESOLVED_MEANING_IDS_V8){
    expect(marketStatRole(id)).toBeNull();expect(unresolvedMarketStatMeaning(id)).not.toBeNull();
    expect(marketStatOption(id)?.name).toBe(`Stat ${id} (experimental)`);
    expect(normalizeMarketSearchRequest({itemMask:0,statFilters:[{statId:id,minimum:1}]}).ok).toBe(true);
  }
});

test("all seven event tuples retain their literal selectors, levels and chance IDs",()=>{
  for(const [eventKey,skillIdentifierId,levelId,chanceId] of EXPECTED_PROC_FAMILIES_V8){
    expect(MARKET_PROC_FAMILIES_V8).toContainEqual({eventKey,skillIdentifierId,levelId,chanceId});
    expect(marketStatRole(skillIdentifierId)?.kind).toBe("talent-identifier");
    expect(marketStatMinimumIssue(skillIdentifierId)).toMatch(/exact selector/);
    for(const id of [levelId,chanceId]){
      expect(marketStatRole(id)?.kind).toBe("quantity");
      expect(marketStatOption(id)?.name).toMatch(/\(experimental\)$/);
      expect(normalizeMarketSearchRequest({itemMask:1073746020,statFilters:[{statId:id,minimum:2.5}]}).ok).toBe(true);
    }
  }
  expect(marketStatOption(119)?.name).toBe("Talent identifier on spell hit (Stat 119) (experimental)");
  expect(marketStatOption(121)?.name).toBe("Talent chance on spell hit (Stat 121) (experimental)");
  expect(marketBaseStatValue({statId:118,kind:"range",minimum:3,maximum:6})).toBe("3\u20136");
});

test("class/talent selectors, effects and collections do not become generic amounts; native controls remain intact",()=>{
  for(const id of EXPECTED_CLASS_IDS_V8)expect(marketStatRole(id)?.kind).toBe("class-identifier");
  for(const id of EXPECTED_TALENT_IDS_V8)expect(marketStatRole(id)?.kind).toBe("talent-identifier");
  expect(MARKET_STAT_OPTIONS.filter(option=>marketStatMinimumIssue(option.statId)).map(option=>option.statId).sort((a,b)=>a-b)).toEqual([...EXPECTED_NO_GENERIC_MINIMUM_IDS_V8]);
  expect(MARKET_STAT_OPTIONS.filter(option=>!marketStatMinimumIssue(option.statId))).toHaveLength(345);
  expect(MARKET_STAT_OPTIONS.filter(option=>!option.experimental&&marketStatMinimumIssue(option.statId))).toEqual([]);
  // Native 202 has a proved native minimum control and also a selector use in
  // the v8 tooltip family. Preserve that control; don't invent a new encoder.
  expect(marketStatOption(202)?.name).toBe("Singular Skills");expect(marketStatMinimumIssue(202)).toBeNull();
  for(const id of EXPECTED_NO_GENERIC_MINIMUM_IDS_V8){
    expect(normalizeMarketFilterCriteria({statFilters:[{statId:id,minimum:1}]}).ok).toBe(true);
    expect(normalizeMarketSearchRequest({itemMask:0,statFilters:[{statId:id,minimum:1}]})).toEqual({ok:false,reason:"unsupported-stat-minimum"});
  }
  expect(marketStatRole(203)).toMatchObject({kind:"quantity",talentFieldId:202});
  expect(marketStatRole(206)).toMatchObject({kind:"quantity",talentFieldId:205});
  expect(marketStatRole(445)).toMatchObject({kind:"quantity",talentFieldId:444});
  expect(marketBaseStatValue({statId:21,kind:"scalar",minimum:4,maximum:4})).toBe("Identifier: 4");
  expect(marketBaseStatValue({statId:102,kind:"scalar",minimum:1,maximum:1})).toBe("Conditional effect");
});
