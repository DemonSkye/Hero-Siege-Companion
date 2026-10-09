import { expect, test } from "vitest";
import { generateConstructorStats, ItemStatRandom, NON_RANDOM_ITEM_STATS } from "../../src/main/item-stat-generator";
import { itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { sanitizeMarketListingItem } from "../../src/shared/market-listing-item";
import { projectMarketListingItem } from "../../src/main/market-listing-projection";
import { constructorProjectionGaps } from "../../src/shared/item-listing-definition";
import { ITEM_LISTING_CONSTRUCTOR_GAPS } from "../../src/shared/data/item-listing-coverage-build-24868792";

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

test.each([0, 1])("audited glove Tier metadata Boolean %s consumes no draw or ordinary field", boolean => {
  // run-52 resolves the helper writes to 431=definition.b, then 432=Boolean.
  // Both are DontRandomStats entries; (0,4) cannot execute its stat-292 write.
  const fields = itemBaseStatDefinition("unique:4:0:62")!.stats;
  const generated = generateConstructorStats(1000, [...fields,
    { statId: 431, kind: "scalar", minimum: 62, maximum: 62 },
    { statId: 432, kind: "scalar", minimum: boolean, maximum: boolean },
  ]);
  const expected = { 29: 94, 31: 0.5, 72: 19, 73: 21, 93: 10, 94: 35, 154: 61, 173: 21, 294: 20 };
  expect(Object.fromEntries(generated.stats.map(stat => [stat.statId, stat.value]))).toEqual(expected);
  expect(generated.draws).toBe(14);
  expect(generated.unknownStats).toEqual([{ statId: 431, reason: "native-stat-case" }, { statId: 432, reason: "native-stat-case" }]);
  const projected = projectMarketListingItem({ a: 1000, b: 62, c: 1, d: 24, e: 11, w: 1 }, "SYNTHETIC-0-0-4")!;
  expect(Object.fromEntries(projected.stats!.map(stat => [stat.statId, stat.value]))).toEqual(expected);
  expect(projected).toMatchObject({ itemKey: "unique:4:0:62", identified: true, statsExperimental: true });
  expect(projected.unknownStats).toBeUndefined();
  expect(projected.stats).toHaveLength(9);
  expect(JSON.stringify(projected)).not.toMatch(/"statId":43[12]|seed|fingerprint/);
});

test("only constructors with other unaudited helpers keep a helper gap", () => {
  // The shared tier helper writes nonrandom 431/432 and, for some weapons, a
  // scalar 292 = 1 that equals every retained 292 constructor value.
  expect(ITEM_LISTING_CONSTRUCTOR_GAPS).toEqual({ "normal:11:0": "constructor-helper", "normal:19:0": "constructor-helper" });
  const key = "normal:11:0:23";
  const stats = itemBaseStatDefinition(key)!.stats.map(stat => ({ statId: stat.statId, value: stat.minimum }));
  const projected = sanitizeMarketListingItem({ itemKey: key, identified: true, stats, a: 1, sh: "CANARY" });
  expect(projected?.stats).toBeUndefined();
  expect(projected?.statsReason).toBe("constructor-helper");
  expect(new Set(projected?.unknownStats?.map(stat => stat.reason))).toEqual(new Set(["constructor-helper"]));
  expect(JSON.stringify(projected)).not.toMatch(/CANARY|"a"|"sh"/);
});

// Literal outcomes were computed with the unchanged retained run-44 POC from
// independently retained Monsoon constructor facts, not this code. Seeds are invented.
test.each([
  [1, { 22: 125, 23: 1.8, 24: 400, 28: 673, 33: 46, 36: 42, 64: 14, 67: 20, 76: 10, 77: 1, 201: 4, 202: 525, 203: 1 }],
  [1000, { 22: 121, 23: 1.8, 24: 400, 28: 800, 33: 58, 36: 43, 64: 15, 67: 19, 76: 10, 77: 1, 201: 4, 202: 525, 203: 1 }],
  [12345, { 22: 125, 23: 1.8, 24: 400, 28: 838, 33: 48, 36: 41, 64: 14, 67: 13, 76: 10, 77: 1, 201: 2, 202: 525, 203: 1 }],
] as const)("unique bow Monsoon projects its tier-family rolls at invented seed %s and the IPC gate keeps them", (seed, expected) => {
  const projected = projectMarketListingItem({ a: seed, b: 16, c: 1, j: 13, d: 1, e: 11, w: 1 }, "SYNTHETIC-0-0-3")!;
  expect(projected).toMatchObject({ itemKey: "unique:3:13:16", identified: true, statsExperimental: true });
  expect(Object.fromEntries(projected.stats!.map(stat => [stat.statId, stat.value]))).toEqual(expected);
  // The talent identifier leaves the late socket draw position unproved.
  expect(projected.unknownStats).toEqual([{ statId: 20, reason: "prior-draw" }]);
  expect(projected.statsReason).toBeUndefined();
  expect(sanitizeMarketListingItem(JSON.parse(JSON.stringify({ ...projected, a: seed, sh: "CANARY" })))).toEqual(projected);
  expect(generateConstructorStats(seed, itemBaseStatDefinition("unique:3:13:16")!.stats, { latePhaseUnknown: true }).draws).toBe(15);
});

test("formerly tier-gapped amulets project and their modifier guards remain", () => {
  // run-44 POC, Gryphon's Claw constructor, invented seed 1000.
  const row = { a: 1000, b: 65, c: 1, d: 1, e: 11, w: 1 };
  const projected = projectMarketListingItem(row, "SYNTHETIC-0-0-5")!;
  expect(Object.fromEntries(projected.stats!.map(stat => [stat.statId, stat.value]))).toEqual({ 51: 26, 72: 23, 73: 49, 99: 18, 202: 184, 203: 16 });
  expect(projected.unknownStats).toBeUndefined();
  const modified = projectMarketListingItem({ ...row, r: 1 }, "SYNTHETIC-0-0-5")!;
  expect(modified.stats).toBeUndefined();
  expect(modified.statsReason).toBe("unsupported-variant");
});

test.each(["unique:3:4:5", "unique:3:13:16", "unique:3:3:1"])("tier helper writes to %s consume no draw and change no projected value", key => {
  const fields = itemBaseStatDefinition(key)!.stats;
  const tier = [{ statId: 431, kind: "scalar" as const, minimum: 1, maximum: 1 },
    { statId: 432, kind: "scalar" as const, minimum: 1, maximum: 1 },
    { statId: 292, kind: "scalar" as const, minimum: 1, maximum: 1 }];
  const withHelper = [...fields.filter(field => field.statId !== 292), ...tier];
  for (const seed of [1, 1000, 12345]) {
    const base = generateConstructorStats(seed, fields);
    const helped = generateConstructorStats(seed, withHelper);
    expect(helped.draws).toBe(base.draws);
    expect(helped.stats.filter(stat => stat.statId !== 292)).toEqual(base.stats.filter(stat => stat.statId !== 292));
    expect(helped.stats.find(stat => stat.statId === 292)?.value).toBe(1);
  }
});

test.each([{ p: 1 }, { r: 1 }, { q: 0 }, { aa: 0 }, { ab: 1 }, { m: -1 }])("glove admission preserves unsupported modifier guards: %j", patch => {
  const projected = projectMarketListingItem({ a: 1000, b: 62, c: 1, d: 24, e: 11, w: 1, ...patch }, "SYNTHETIC-0-0-4");
  expect(projected?.stats).toBeUndefined();
  expect(projected?.unknownStats).toHaveLength(9);
  expect(new Set(projected?.unknownStats?.map(stat => stat.reason))).toEqual(new Set(["modifier"]));
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
