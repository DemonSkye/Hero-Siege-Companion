// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "vitest";
import baseline from "../fixtures/item-data-baseline-992c5da.json";
import { ITEM_CATALOG_BUILD_24868792_DATA } from "../../src/shared/data/item-catalog-build-24868792";
import { ITEM_BASE_STAT_CATALOG_BUILD_24868792_DATA } from "../../src/shared/data/item-base-stat-catalog-build-24868792";
import { MARKET_STAT_CATALOG_BUILD_24868792_DATA } from "../../src/shared/data/market-stat-catalog-build-24868792";
import { MARKET_STAT_ROLES_V8, MARKET_PROC_FAMILIES_V8 } from "../../src/shared/data/market-stat-roles-build-24868792";
import { MARKET_UNRESOLVED_STAT_MEANINGS, MARKET_ENCODED_FIELD_CONTEXTS } from "../../src/shared/data/market-stat-meaning-gaps-build-24868792";
import { RUNEWORD_MARKET_CATALOG_DATA } from "../../src/shared/data/runeword-market-catalog-build-24868792";
import { ITEM_LISTING_CONSTRUCTOR_GAPS, ITEM_LISTING_OPTIONAL_GENERATION_KEYS } from "../../src/shared/data/item-listing-coverage-build-24868792";
import { ITEM_DATA_SOURCES, validateItemData } from "../../src/shared/item-data-validation";
import { Items } from "../../src/shared/items";
import { ItemStats, itemStat } from "../../src/shared/item-stats";
import { itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { lookupKnownItemRarity } from "../../src/shared/item-rarity";
import { marketBaseStatValue } from "../../src/renderer/src/lib/market-stat-display";
import { generateConstructorStats } from "../../src/main/item-stat-generator";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}
const exports = {
  ITEM_CATALOG_BUILD_24868792_DATA, ITEM_BASE_STAT_CATALOG_BUILD_24868792_DATA,
  MARKET_STAT_CATALOG_BUILD_24868792_DATA, MARKET_STAT_ROLES_V8, MARKET_PROC_FAMILIES_V8,
  MARKET_UNRESOLVED_STAT_MEANINGS, MARKET_ENCODED_FIELD_CONTEXTS, RUNEWORD_MARKET_CATALOG_DATA,
  ITEM_LISTING_CONSTRUCTOR_GAPS, ITEM_LISTING_OPTIONAL_GENERATION_KEYS,
  ITEM_RARITY_BY_NAME: ITEM_DATA_SOURCES.rarities.byNormalizedName,
};
const { validateItemDataShape } = createRequire(import.meta.url)("../../scripts/item-data-schema.cjs") as {
  validateItemDataShape(value: unknown): string[];
};

test.each(Object.entries(exports))("preserves the complete 992c5da semantic table %s", (name, value) => {
  // Independently frozen from the original dev exports before migration. Object
  // formatting may change, but all values and array/setter/table orders are pinned.
  const hash = createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
  expect(hash).toBe(baseline.semanticSha256[name as keyof typeof baseline.semanticSha256]);
});

test("canonical sources validate and each retained identity belongs to exactly one group", () => {
  expect(validateItemData()).toEqual([]);
  expect(validateItemDataShape(ITEM_DATA_SOURCES)).toEqual([]);
  const all = Object.values(Items).flat();
  expect(all).toHaveLength(2035);
  expect(new Set(all.map(item => item.catalogKey)).size).toBe(2035);
  expect(new Set(all.map(item => item.itemKey)).size).toBe(2035);
  expect(Items.base).toHaveLength(956);
  expect(Items.runeword).toHaveLength(100);
  for (const item of all) {
    expect(item.stats).toBe(itemBaseStatDefinition(item.catalogKey)?.stats);
    expect(item.statsComplete).toBe(itemBaseStatDefinition(item.catalogKey)?.complete);
    expect(item.provenanceRefs.length).toBeGreaterThan(0);
    if (item.repository === "normal") expect(item.classificationBasis).toBe("normal-repository");
    if (["satanic", "set", "heroic", "angelic", "unholy"].includes(item.group)) {
      expect(item.repository).toBe("unique");
      expect(lookupKnownItemRarity(item.type, item.name! as string)?.toLowerCase()).toBe(item.group);
    }
  }
});

test("unknown labels and classifications remain explicit and seeded base names are distinct", () => {
  const missing = Items.unknown.filter(item => item.identityStatus === "missing");
  expect(missing).toHaveLength(24);
  expect(missing.every(item => item.name === null && item.nameKind === "unavailable" && item.identityIssue !== null)).toBe(true);
  expect(Items.unknown.some(item => item.identityStatus === "resolved" && item.name !== null)).toBe(true);
  expect(Items.base.find(item => item.catalogKey === "normal:0:0:0")).toMatchObject({ name: "Cap", nameKind: "base", identityMode: "seeded" });
  expect(Items.runeword.find(item => item.catalogKey === "runeword:3:0:0"))
    .toMatchObject({ itemKey: "runeword-repository:1", gameId: 0, name: "Breath of the Damned" });
});

test("stable stat IDs preserve field roles, unknown units, tables, dynamic fields and fractional generation", () => {
  expect(ItemStats).toHaveLength(383);
  expect(itemStat(999999)).toBeNull();
  expect(itemStat(21)?.role?.kind).toBe("class-identifier");
  expect(itemStat(113)?.role?.kind).toBe("talent-identifier");
  expect(itemStat(0)).toMatchObject({ name: "Stat 0", unit: "unknown", role: null });
  const glove = Object.values(Items).flat().find(item => item.itemKey === "unique:4:0:62")!;
  expect(glove.stats).toContainEqual({ statId: 31, kind: "scalar", minimum: 0.5, maximum: 0.5 });
  expect(generateConstructorStats(618478963, glove.stats).stats).toContainEqual({ statId: 31, value: 0.5 });
  const table = Items.base.find(item => item.itemKey === "normal:16:0:0")!.stats.find(stat => stat.statId === 186)!;
  expect(marketBaseStatValue(table)).toBe("Table: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10");
  expect(Items.base.find(item => item.itemKey === "normal:11:0:18"))
    .toMatchObject({ statsComplete: false, stats: expect.arrayContaining([{ statId: 347, kind: "dynamic", description: "Tablet zones" }]) });
});

test.each([
  ["duplicate stat ID", (data: typeof ITEM_DATA_SOURCES) => { data.statCatalog.stats[1].statId = data.statCatalog.stats[0].statId; }, /duplicate ID/],
  ["unknown stat reference", (data: typeof ITEM_DATA_SOURCES) => { data.constructors.items[0].stats[0].statId = 999999; }, /unknown ID/],
  ["reversed bounds", (data: typeof ITEM_DATA_SOURCES) => { data.constructors.items[0].stats[0].minimum = 10000; }, /invalid bounds/],
  ["false dynamic completeness", (data: typeof ITEM_DATA_SOURCES) => { data.constructors.items.find(item => item.itemKey === "normal:11:0:18")!.complete = true; }, /dynamic coverage claim/],
  ["role ID mismatch", (data: typeof ITEM_DATA_SOURCES) => { data.statCatalog.stats.find(stat => stat.role)!.role!.statId = 999999; }, /role ID mismatch/],
  ["missing definition", (data: typeof ITEM_DATA_SOURCES) => { data.constructors.items.pop(); }, /coverage mismatch/],
  ["runeword collision", (data: typeof ITEM_DATA_SOURCES) => { data.runewords.bindings[1][0] = data.runewords.bindings[0][0]; }, /duplicate ID/],
  ["menu mismatch", (data: typeof ITEM_DATA_SOURCES) => { data.statCatalog.nativeMenuStatIds.push(0); }, /membership mismatch/],
  ["bad provenance", (data: typeof ITEM_DATA_SOURCES) => { data.statCatalog.provenance.roleClassificationSha256 = "bad"; }, /provenance hash/],
] as const)("rejects %s", (_label, mutate, issue) => {
  const data = structuredClone(ITEM_DATA_SOURCES);
  mutate(data);
  expect(validateItemData(data).join("\n")).toMatch(issue);
});

test("raw JSON is usable without a TypeScript parser", () => {
  const raw = JSON.parse(readFileSync("src/shared/data/items/build-24868792/constructor-stats.json", "utf8"));
  expect(raw.items.find((item: { itemKey: string }) => item.itemKey === "unique:4:0:62").stats)
    .toEqual(itemBaseStatDefinition("unique:4:0:62")?.stats);
});

test("schema rejects wrong shapes, mixed value types and unrecognized properties", () => {
  const data = structuredClone(ITEM_DATA_SOURCES) as Record<string, any>;
  data.constructors.items[0].stats[0].minimum = "4";
  data.statCatalog.stats[0].role = { statId: 0, kind: "guessed", detail: "wrong" };
  data.identities.credentials = "synthetic forbidden property";
  data.runewords.bindings[0].push("extra");
  expect(validateItemDataShape(data).join("\n")).toMatch(/additional properties/);
  expect(validateItemDataShape(data).join("\n")).toMatch(/must be number/);
  expect(validateItemDataShape(data).join("\n")).toMatch(/allowed values/);
  expect(validateItemDataShape(data).join("\n")).toMatch(/more than 3/);
});
