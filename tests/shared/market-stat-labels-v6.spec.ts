import { expect, test } from "vitest";
import { ITEM_BASE_STAT_CATALOG, itemBaseStatMetadata } from "../../src/shared/item-base-stat-catalog";
import { marketStatMinimumIssue, marketStatOption, normalizeMarketSearchRequest } from "../../src/shared/market-search";
import { marketBaseStatValue } from "../../src/renderer/src/lib/market-stat-display";
import { EXPECTED_MARKET_STAT_LABELS_V6 } from "../fixtures/market-stat-labels-v6";

test("all 115 validated native item-stat joins retain their exact English fragments and experimental status", () => {
  expect(EXPECTED_MARKET_STAT_LABELS_V6).toHaveLength(115);
  expect(new Set(EXPECTED_MARKET_STAT_LABELS_V6.map(row=>row[0])).size).toBe(115);
  for (const [statId,localizationKey,english] of EXPECTED_MARKET_STAT_LABELS_V6) {
    expect(itemBaseStatMetadata(statId)).toMatchObject({statId,localizationKey,name:english,nativeMarketMenu:false});
    expect(marketStatOption(statId)).toMatchObject({statId,localizationKey,name:`${english} (experimental)`,experimental:true});
  }
  expect(ITEM_BASE_STAT_CATALOG.stats.filter(stat=>stat.name.startsWith("Stat "))).toHaveLength(84);
  expect(itemBaseStatMetadata(384)?.name).toBe("Stat 384");
  expect(itemBaseStatMetadata(387)?.name).toBe("Stat 387");
});

test("new labels change neither scalar/table formatting nor the 15 nonscalar restrictions", () => {
  expect(marketBaseStatValue({statId:350,kind:"scalar",minimum:2,maximum:2})).toBe("2");
  expect(marketBaseStatValue({statId:35,kind:"series",minimum:0.5,maximum:5,values:[0.5,1,1.5]})).toBe("Table: 0.5, 1, 1.5");
  for (const statId of [10,11,12,13,14,15,20,98,100,120,185,186,187,299,347]) {
    expect(marketStatMinimumIssue(statId)).not.toBeNull();
    expect(normalizeMarketSearchRequest({runewordId:86,statFilters:[{statId,minimum:1}]})).toEqual({ok:false,reason:"unsupported-stat-minimum"});
  }
  // Readable text for 98/100/299 does not itself prove a supported scalar shape.
  expect(marketStatOption(98)?.name).toBe("Crushing Blow Armor Break increased by (experimental)");
  expect(marketStatOption(271)?.name).toBe("Ranged Skills (experimental)");
  expect(marketStatOption(341)?.name).toBe("Chance for Guardians to perform an additional attack (experimental)");
  expect(marketStatOption(33)?.name).toBe("Strength");
});
