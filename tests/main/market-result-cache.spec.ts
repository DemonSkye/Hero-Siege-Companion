import { describe, expect, test } from "vitest";
import { MarketResultCache } from "../../src/main/market-result-cache";

describe("market result cache", () => {
  test("maximum and explicit zero cannot reuse unbounded or different-range prices", () => {
    const cache = new MarketResultCache(() => 1000);
    const keys = [{}, { maxSockets: 4 }, { maxSockets: 6 }, { maxSockets: 0 }, { minSockets: 0, maxSockets: 0 }]
      .map(bounds => cache.key("scope", { itemMask: 1073746020, ...bounds, statFilters: [] }));
    expect(new Set(keys).size).toBe(5);
    cache.set(keys[1], { listings: [{ price: 444 }] });
    expect(cache.get(keys[1])).toEqual({ result: { listings: [{ price: 444 }] }, observedAt: 1000 });
    for (const i of [0, 2, 3, 4]) expect(cache.get(keys[i])).toBeNull();
  });
  test("different runewords and normal masks cannot share cached prices",()=>{
    const cache = new MarketResultCache(()=>1000);
    const first = cache.key("scope",{runewordId:1,statFilters:[]});
    const grief = cache.key("scope",{runewordId:81,statFilters:[]});
    const normal = cache.key("scope",{itemMask:1,statFilters:[]});
    expect(new Set([first,grief,normal]).size).toBe(3);
    cache.set(first,{listings:[{price:100}]});
    expect(cache.get(grief)).toBeNull();
    expect(cache.get(normal)).toBeNull();
  });
  test("keys by session scope and normalized filters, stores only sanitized results, and retains observation time", () => {
    let now = 1_000;
    const cache = new MarketResultCache(() => now);
    const request = { itemMask: 42, minSockets: 2, statFilters: [{ statId: 60, minimum: 5 }] };
    const key = cache.key("scope-a", request);
    expect(cache.key("scope-b", request)).not.toBe(key);
    cache.set(key, { listings: [{ price: 20, seller: "secret" } as never], totalMatches: 1 });
    const hit = cache.get(key);
    expect(hit).toEqual({ result: { listings: [{ price: 20 }], totalMatches: 1 }, observedAt: 1_000 });
    expect(JSON.stringify(hit)).not.toContain("secret");
    now += 30_000;
    expect(cache.get(key)).toBeNull();
  });

  test("evicts the least recently used result at its bound", () => {
    const cache = new MarketResultCache(() => 1, 1_000, 2);
    const request = (itemMask: number) => ({ itemMask, statFilters: [] });
    const first = cache.key("scope", request(1));
    const second = cache.key("scope", request(2));
    const third = cache.key("scope", request(3));
    cache.set(first, { listings: [] });
    cache.set(second, { listings: [] });
    expect(cache.get(first)).not.toBeNull();
    cache.set(third, { listings: [] });
    expect(cache.get(second)).toBeNull();
    expect(cache.get(first)).not.toBeNull();
    expect(cache.get(third)).not.toBeNull();
  });
});
