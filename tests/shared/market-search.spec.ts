import { describe, expect, test } from "vitest";

import { activeItemCatalog } from "../../src/shared/item-catalog";
import {
  MARKET_PRICE_ASCENDING_SORT,
  MARKET_SEARCH_MAX_ABSOLUTE_STAT_VALUE,
  MARKET_SEARCH_LISTING_LIMIT,
  MARKET_STAT_OPTIONS,
  marketStatOption,
  normalizeMarketSearchRequest,
  resolveMarketItemMask,
  sanitizeMarketSearchResult,
} from "../../src/shared/market-search";

describe("market search shared boundary", () => {
  test("exposes the compact, unique 167-stat filter catalog", () => {
    expect(MARKET_STAT_OPTIONS).toHaveLength(167);
    expect(new Set(MARKET_STAT_OPTIONS.map((option) => option.statId)).size).toBe(167);
    expect(new Set(MARKET_STAT_OPTIONS.map((option) => option.localizationKey)).size).toBe(167);
    expect(MARKET_STAT_OPTIONS.every((option) => option.name.trim().length > 0)).toBe(true);
    const displayedNames = MARKET_STAT_OPTIONS.map((option) => option.name);
    expect(displayedNames).toEqual([...displayedNames].sort((left, right) => left.localeCompare(right)));
    expect(marketStatOption(64)).toEqual({
      statId: 64,
      localizationKey: "mana_per_hit",
      name: "Mana stolen per Hit",
    });
    expect(marketStatOption(201)).toEqual({
      statId: 201,
      localizationKey: "all_talents",
      name: "All Skills",
    });
    expect(marketStatOption(999_999)).toBeNull();
  });

  test("derives captured market item masks from catalog-backed drop identities", () => {
    expect(resolveMarketItemMask({
      repository: "unique",
      type: 1,
      id: 100,
      weaponType: 0,
    })).toEqual({ ok: true, itemMask: 1_073_746_020 });
    expect(resolveMarketItemMask({
      repository: "normal",
      type: 0,
      id: 0,
      weaponType: 0,
    })).toEqual({ ok: true, itemMask: 0 });
    expect(resolveMarketItemMask({
      repository: "unique",
      type: 3,
      id: 35,
      weaponType: 1,
    })).toEqual({ ok: true, itemMask: 1_077_948_451 });
    expect(resolveMarketItemMask({
      repository: "unique",
      type: 8,
      id: 21,
      weaponType: 0,
    })).toEqual({ ok: true, itemMask: 1_073_774_613 });
    expect(resolveMarketItemMask({
      repository: "unique",
      type: 6,
      id: 23,
      weaponType: 0,
    })).toEqual({ ok: true, itemMask: 1_073_766_423 });
  });

  test("resolves every catalog-backed normal and unique identity to a unique mask", () => {
    const identities = [
      ...activeItemCatalog.artifact.definitions,
      ...activeItemCatalog.artifact.missing,
    ].filter((identity) => identity.repository !== "runeword");
    const masks = identities.map((identity) =>
      resolveMarketItemMask({
        repository: identity.repository,
        type: identity.type,
        id: identity.gameId,
        weaponType: identity.weaponType,
      }),
    );

    expect(identities).toHaveLength(1_935);
    expect(masks.every((resolution) => resolution.ok)).toBe(true);
    const values = masks.flatMap((resolution) => resolution.ok ? [resolution.itemMask] : []);
    expect(new Set(values).size).toBe(values.length);
  });

  test("fails closed for unsupported and invalid market identities", () => {
    expect(resolveMarketItemMask({
      repository: "unknown",
      type: 1,
      id: 100,
      weaponType: 0,
    })).toEqual({ ok: false, reason: "unknown-repository" });
    expect(resolveMarketItemMask({
      repository: "runeword",
      type: 3,
      id: 0,
      weaponType: 0,
    })).toEqual({ ok: false, reason: "runeword-unproven" });
    expect(resolveMarketItemMask({
      repository: "unique",
      type: 1,
      id: -1,
      weaponType: 0,
    })).toEqual({ ok: false, reason: "invalid-identity" });
    expect(resolveMarketItemMask({
      repository: "unique",
      type: 999,
      id: 0,
      weaponType: 0,
    })).toEqual({ ok: false, reason: "unclassified-identity" });
    expect(resolveMarketItemMask({
      repository: "unique",
      type: 1,
      id: 4_095,
      weaponType: 0,
    })).toEqual({ ok: false, reason: "out-of-range-identity" });
  });

  test("normalizes caller criteria without exposing a sort override", () => {
    expect(MARKET_PRICE_ASCENDING_SORT).toBe(2);
    const normalized = normalizeMarketSearchRequest({
      itemMask: 0,
      minSockets: 4,
      statFilters: [
        { statId: 201, minimum: 2 },
        { statId: 64, minimum: 8, ignored: true },
      ],
      sort: 1,
      ignored: true,
    });
    expect(normalized).toEqual({
      ok: true,
      request: {
        itemMask: 0,
        minSockets: 4,
        statFilters: [
          { statId: 64, minimum: 8 },
          { statId: 201, minimum: 2 },
        ],
      },
    });
    if (normalized.ok) expect("sort" in normalized.request).toBe(false);

    expect(normalizeMarketSearchRequest({
      itemMask: 1_073_746_020,
      statFilters: [],
    })).toEqual({
      ok: true,
      request: {
        itemMask: 1_073_746_020,
        statFilters: [],
      },
    });
  });

  test.each([
    [{ statFilters: [] }, "invalid-item-mask"],
    [{ itemMask: -1, statFilters: [] }, "invalid-item-mask"],
    [{ itemMask: 0x1_0000_0000, statFilters: [] }, "invalid-item-mask"],
    [{ itemMask: 1.5, statFilters: [] }, "invalid-item-mask"],
    [{ itemMask: 0 }, "invalid-stat-filters"],
    [{ itemMask: 0, statFilters: "none" }, "invalid-stat-filters"],
    [{ itemMask: 0, minSockets: 0, statFilters: [] }, "invalid-min-sockets"],
    [{ itemMask: 0, minSockets: 7, statFilters: [] }, "invalid-min-sockets"],
    [{ itemMask: 0, statFilters: [{ statId: 64, minimum: "8" }] }, "invalid-stat-filter"],
    [{ itemMask: 0, statFilters: [{ statId: 64, minimum: Number.NaN }] }, "invalid-stat-filter"],
    [{
      itemMask: 0,
      statFilters: [{ statId: 64, minimum: MARKET_SEARCH_MAX_ABSOLUTE_STAT_VALUE + 1 }],
    }, "invalid-stat-filter"],
    [{
      itemMask: 0,
      statFilters: [{ statId: 64, minimum: -MARKET_SEARCH_MAX_ABSOLUTE_STAT_VALUE - 1 }],
    }, "invalid-stat-filter"],
    [{ itemMask: 0, statFilters: [{ statId: 999_999, minimum: 1 }] }, "unknown-stat-id"],
    [{
      itemMask: 0,
      statFilters: [
        { statId: 64, minimum: 1 },
        { statId: 64, minimum: 2 },
      ],
    }, "duplicate-stat-id"],
    [{
      itemMask: 0,
      statFilters: Array.from({ length: 17 }, (_, index) => ({ statId: 25 + index, minimum: 1 })),
    }, "too-many-stat-filters"],
  ])("rejects malformed market search input %#", (value, reason) => {
    expect(normalizeMarketSearchRequest(value)).toEqual({ ok: false, reason });
  });

  test("accepts stat minimums at the helper's exact absolute boundary", () => {
    expect(normalizeMarketSearchRequest({
      itemMask: 0,
      statFilters: [
        { statId: 64, minimum: -MARKET_SEARCH_MAX_ABSOLUTE_STAT_VALUE },
        { statId: 201, minimum: MARKET_SEARCH_MAX_ABSOLUTE_STAT_VALUE },
      ],
    })).toMatchObject({ ok: true });
  });

  test("sanitizes, sorts, and caps market listings at the lowest two prices", () => {
    expect(MARKET_SEARCH_LISTING_LIMIT).toBe(2);
    const raw = {
      listings: [
        { price: 90, unitPrice: 30, ignored: true },
        { price: "5" },
        { price: 10, unitPrice: -1 },
        { price: Number.POSITIVE_INFINITY },
        { price: 10, unitPrice: 2 },
        { price: -5 },
      ],
      totalMatches: 12,
      ignored: true,
    };
    expect(sanitizeMarketSearchResult(raw)).toEqual({
      listings: [
        { price: 10 },
        { price: 10, unitPrice: 2 },
      ],
      totalMatches: 12,
    });
    expect(raw.listings).toHaveLength(6);
    expect(sanitizeMarketSearchResult(null)).toEqual({ listings: [] });
    expect(sanitizeMarketSearchResult({ listings: [], totalMatches: -1 })).toEqual({ listings: [] });
  });
});
