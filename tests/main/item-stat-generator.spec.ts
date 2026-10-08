import { expect, test } from "vitest";
import { generateConstructorStats, ItemStatRandom, NON_RANDOM_ITEM_STATS } from "../../src/main/item-stat-generator";
import { itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { sanitizeMarketListingItem } from "../../src/shared/market-listing-item";
import { projectMarketListingItem } from "../../src/main/market-listing-projection";
import { constructorProjectionGaps } from "../../src/shared/item-listing-definition";

// Invented seeds. Literal outcomes were computed with the unchanged retained
// run-44 POC plus its independent nine-field glove constructor facts, not this code.
test.each([
  [1, { 29: 78, 31: 0.5, 72: 11, 73: 20, 93: 10, 94: 34, 154: 61, 173: 25, 294: 20 }],
  [1000, { 29: 94, 31: 0.5, 72: 19, 73: 21, 93: 10, 94: 35, 154: 61, 173: 21, 294: 20 }],
  [12345, { 29: 99, 31: 0.5, 72: 12, 73: 17, 93: 10, 94: 33, 154: 46, 173: 24, 294: 20 }],
] as const)("generic glove base expansion matches old POC at invented seed %s", (seed, expected) => {
  const fields = itemBaseStatDefinition("unique:4:0:62")!.stats;
  const generated = generateConstructorStats(seed, fields);
  expect(Object.fromEntries(generated.stats.map(stat => [stat.statId, stat.value]))).toEqual(expected);
  expect(generated.unknownStats).toEqual([]);
  expect(generated.draws).toBe(14); // Six ranges + eight preparation draws; 0.5 is scalar.
});

test("uses the independently retained double CPR vector and consumes equal-ended ranges", () => {
  const random = new ItemStatRandom(1);
  expect(Array.from({ length: 5 }, () => random.draw())).toEqual([716294416, 982500864, 124860672, 97785888, 273567680]);
  const generated = generateConstructorStats(1, [
    { statId: 154, kind: "range", minimum: 46, maximum: 68 },
    { statId: 101, kind: "range", minimum: 9, maximum: 9 },
  ]);
  expect(generated.stats).toEqual([{ statId: 101, value: 9 }, { statId: 154, value: 67 }]);
  expect(generated.draws).toBe(10);
});

test("excluded native fields do not draw or become guessed numeric rolls", () => {
  expect([...NON_RANDOM_ITEM_STATS]).toEqual([376, 380, 378, 382, 347, 431, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 444, 21, 432, 20]);
  const generated = generateConstructorStats(1, [
    { statId: 347, kind: "range", minimum: 1, maximum: 9 },
    { statId: 72, kind: "range", minimum: 10, maximum: 20 },
  ]);
  expect(generated.stats).toEqual([{ statId: 72, value: 17 }]);
  expect(generated.unknownStats).toEqual([{ statId: 347, reason: "native-stat-case" }]);
  expect(generated.draws).toBe(9);
});

test("unknown table consumption withholds later ranges and sockets while independent scalars survive", () => {
  const generated = generateConstructorStats(1, [
    { statId: 150, kind: "series", minimum: 1, maximum: 9, values: [1, 3, 9] },
    { statId: 154, kind: "range", minimum: 46, maximum: 68 },
    { statId: 31, kind: "scalar", minimum: 0.5, maximum: 0.5 },
    { statId: 20, kind: "range", minimum: 1, maximum: 2 },
  ]);
  expect(generated.stats).toEqual([{ statId: 31, value: 0.5 }]);
  expect(generated.unknownStats).toEqual([{ statId: 150, reason: "constructor-value" },
    { statId: 154, reason: "prior-draw" }, { statId: 20, reason: "prior-draw" }]);
});

test.each([-1, NaN, 2 ** 32])("rejects invalid generation input without coercion", seed => {
  expect(() => generateConstructorStats(seed, [])).toThrow("Invalid item seed");
});

test("unmapped common glove helper cannot be bypassed by a plausible forged base-stat projection", () => {
  const stats = generateConstructorStats(1, itemBaseStatDefinition("unique:4:0:62")!.stats).stats;
  const projected = sanitizeMarketListingItem({ itemKey: "unique:4:0:62", identified: true, stats, a: 1, sh: "CANARY" });
  expect(projected?.stats).toBeUndefined();
  expect(projected?.unknownStats).toHaveLength(9);
  expect(new Set(projected?.unknownStats?.map(stat => stat.reason))).toEqual(new Set(["tier-helper"]));
  expect(JSON.stringify(projected)).not.toMatch(/CANARY|"a"|"sh"/);
});

test("known constructors expand generically without per-specimen or authentication admission", () => {
  const tiny = projectMarketListingItem({ a: 618478963, b: 92, c: 1, j: 0, d: 1, e: 11, w: 1 }, "SYNTHETIC-0-0-10");
  expect(tiny).toEqual({ itemKey: "unique:10:0:92", identified: true,
    stats: [{ statId: 266, value: 22 }], statsExperimental: true });
});

test("fractional scalar validation survives production projection and keeps a bad sibling explicitly unknown", () => {
  // Retained Lemon constructor: damage scalar 1, speed scalar 1.25. No helper.
  const item = projectMarketListingItem({ a: 1000, b: 0, c: 1, j: 17, d: 1, e: 11, w: 1 }, "SYNTHETIC-0-0-3")!;
  expect(item).toEqual({ itemKey: "unique:3:17:0", identified: true,
    stats: [{ statId: 22, value: 1 }, { statId: 23, value: 1.25 }], statsExperimental: true });
  const repaired = sanitizeMarketListingItem({ ...item, seed: "CANARY", seller: "CANARY",
    stats: [{ statId: 22, value: 1 }, { statId: 23, value: 1.5 }] });
  expect(repaired?.stats).toEqual([{ statId: 22, value: 1 }]);
  expect(repaired?.unknownStats).toEqual([{ statId: 23, reason: "invalid-projection" }]);
  expect(JSON.stringify(repaired)).not.toMatch(/CANARY|seed|seller/);
});

test("seed-free projection validation independently fences missing draw dependencies", () => {
  const fields = [
    { statId: 150, kind: "series" as const, minimum: 1, maximum: 9, values: [1, 3, 9] },
    { statId: 154, kind: "range" as const, minimum: 46, maximum: 68 },
    { statId: 31, kind: "scalar" as const, minimum: 0.5, maximum: 0.5 },
    { statId: 20, kind: "range" as const, minimum: 1, maximum: 2 },
  ];
  expect([...constructorProjectionGaps(fields, true)]).toEqual([[150, "constructor-value"], [154, "prior-draw"], [20, "prior-draw"]]);
  expect([...constructorProjectionGaps(fields.slice(1), false)]).toEqual([[154, "prior-draw"], [20, "prior-draw"]]);
});
