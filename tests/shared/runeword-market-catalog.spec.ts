import {expect,test} from "vitest";
import {RUNEWORD_MARKET_DEFINITIONS,runewordMarketById,runewordMarketByLegacyKey} from "../../src/shared/runeword-market-catalog";
import {marketStatOption,normalizeMarketSearchRequest} from "../../src/shared/market-search";
import {itemBaseStatDefinition} from "../../src/shared/item-base-stat-catalog";
import {EXPECTED_RUNEWORD_REPOSITORY_IDS} from "../fixtures/runeword-market-permutation";

test("native repository IDs preserve all100 permuted selector bindings",()=>{
  expect(RUNEWORD_MARKET_DEFINITIONS.map(item=>item.repositoryId)).toEqual([...EXPECTED_RUNEWORD_REPOSITORY_IDS]);
  expect([...EXPECTED_RUNEWORD_REPOSITORY_IDS].sort((a,b)=>a-b)).toEqual(Array.from({length:100},(_,n)=>n+1));
  expect(runewordMarketByLegacyKey("runeword:3:0:0")).toMatchObject({repositoryId:1,name:"Breath of the Damned"});
  expect(runewordMarketByLegacyKey("runeword:3:0:1")).toMatchObject({repositoryId:81,name:"Grief"});
  expect(runewordMarketById(1)?.name).toBe("Breath of the Damned");
  expect(runewordMarketById(81)?.name).toBe("Grief");
  expect(runewordMarketById(0)).toBeNull();
  expect(itemBaseStatDefinition("runeword-repository:1")?.stats).toContainEqual({statId:28,kind:"range",minimum:730,maximum:880});
  expect(itemBaseStatDefinition("runeword:3:0:0")).toEqual(itemBaseStatDefinition("runeword-repository:1"));
});

test.each([[86,"Codex of the Card Collector"],[87,"Codex of Relic Feast"],[93,"Codex of Experience"],
  [94,"Codex of Rift"],[95,"Codex of Chaos"],[96,"Codex of Broken Friendship"]] as const)("Codex%i uses its external ID for %s",(id,name)=>{
  expect(runewordMarketById(id)).toMatchObject({repositoryId:id,itemType:11,name});
});

test("normalization accepts all100 selectors independently and rejects stale mixed targets",()=>{
  for(const id of EXPECTED_RUNEWORD_REPOSITORY_IDS) expect(normalizeMarketSearchRequest({runewordId:id,minSockets:4,
    statFilters:[{statId:271,minimum:10}],ignored:true})).toEqual({ok:true,request:{runewordId:id,minSockets:4,statFilters:[{statId:271,minimum:10}]}});
  for(const id of [0,-1,101,1.5,"81",null,NaN]) expect(normalizeMarketSearchRequest({runewordId:id,statFilters:[]})).toEqual({ok:false,reason:"invalid-runeword-id"});
  expect(normalizeMarketSearchRequest({itemMask:1073746020,runewordId:81,statFilters:[]})).toEqual({ok:false,reason:"mixed-item-target"});
  expect(normalizeMarketSearchRequest({itemMask:0,runewordId:undefined,statFilters:[]})).toEqual({ok:true,request:{itemMask:0,statFilters:[]}});
  expect(normalizeMarketSearchRequest({statFilters:[]})).toEqual({ok:false,reason:"invalid-item-mask"});
});

test.each([[163,"Physical Damage taken as Cold"],[164,"Physical Damage taken as Fire"],[165,"Physical Damage taken as Arcane"],
  [166,"Physical Damage taken as Lightning"],[199,"Flask Skill Haste"],[283,"Increased Experience Gain Below Level 100"]] as const)("exact English join for item stat%i",(id,name)=>{
  expect(marketStatOption(id)?.name).toBe(`${name} (experimental)`);
});

test("character-attribute collisions cannot relabel item stats",()=>{
  expect(marketStatOption(271)?.name).toBe("Ranged Skills (experimental)");
  expect(marketStatOption(33)?.name).toBe("Strength");
});
