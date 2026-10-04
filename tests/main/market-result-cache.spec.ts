import { describe, expect, test } from "vitest";
import { MarketResultCache } from "../../src/main/market-result-cache";

describe("market result cache", () => {
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
