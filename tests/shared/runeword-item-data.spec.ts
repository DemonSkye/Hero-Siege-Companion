// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, expect, test, vi } from "vitest";
import { Items } from "../../src/shared/items";
import { ITEM_DATA_SOURCES, validateItemData } from "../../src/shared/item-data-validation";
import { runewordMarketById } from "../../src/shared/runeword-market-catalog";

const { validateItemDataShape } = createRequire(import.meta.url)("../../scripts/item-data-schema.cjs") as {
  validateItemDataShape(value: unknown): string[];
};
afterEach(() => {
  vi.doUnmock("../../src/shared/data/items/build-24868792/identities.json");
  vi.resetModules();
});

test("reusable runewords preserve all nine known item types separately from legacy coordinates", () => {
  // Literal known bindings independently retained in the reviewed dev baseline.
  for (const [external, ordinal, name, itemType] of [
    [69, 67, "Delirium Tremens", 0], [17, 83, "Quickstep", 2],
    [86, 93, "Codex of the Card Collector", 11], [87, 94, "Codex of Relic Feast", 11],
    [88, 95, "Spelunker", 11], [93, 96, "Codex of Experience", 11],
    [94, 97, "Codex of Rift", 11], [95, 98, "Codex of Chaos", 11],
    [96, 99, "Codex of Broken Friendship", 11],
  ] as const) {
    const item = Items.runeword.find(item => item.itemKey === `runeword-repository:${external}`);
    expect(item).toMatchObject({ name, itemType, type: 3, weaponType: 0, gameId: ordinal,
      catalogKey: `runeword:3:0:${ordinal}`, repository: "runeword" });
  }
});

test("unknown runeword item types stay null and nonrunewords retain their ordinary item type", () => {
  expect(Items.runeword.filter(item => item.itemType === null)).toHaveLength(91);
  expect(Items.runeword.find(item => item.itemKey === "runeword-repository:1"))
    .toMatchObject({ type: 3, itemType: null, gameId: 0, name: "Breath of the Damned" });
  for (const item of Object.values(Items).flat()) {
    if (item.repository !== "runeword") expect(item.itemType).toBe(item.type);
    else expect(item.itemType).toBe(runewordMarketById(Number(item.itemKey.split(":")[1]))!.itemType);
  }
});

test("one identity-name edit validates and reaches reusable and real Market consumers together", async () => {
  const changed = structuredClone(ITEM_DATA_SOURCES);
  const renamed = changed.identities.definitions.find(item => item.repository === "runeword" && item.gameId === 0)!;
  renamed.name = "Independent New Name";
  expect(validateItemDataShape(changed)).toEqual([]);
  expect(validateItemData(changed)).toEqual([]);
  vi.resetModules();
  vi.doMock("../../src/shared/data/items/build-24868792/identities.json", () => ({ default: changed.identities }));
  const { Items: editedItems } = await import("../../src/shared/items");
  const { runewordMarketById: editedMarket } = await import("../../src/shared/runeword-market-catalog");
  const { marketItemByKey, marketItemSuggestions } = await import("../../src/renderer/src/lib/market-items");
  expect(editedItems.runeword.find(item => item.itemKey === "runeword-repository:1"))
    .toMatchObject({ name: "Independent New Name", catalogKey: "runeword:3:0:0", type: 3 });
  expect(editedMarket(1)).toMatchObject({ name: "Independent New Name", repositoryId: 1, legacyItemKey: "runeword:3:0:0" });
  expect(marketItemByKey("runeword-repository:1")?.name).toBe("Independent New Name");
  expect(marketItemSuggestions("Independent New Name")[0]?.key).toBe("runeword-repository:1");
  expect(marketItemByKey("runeword:3:0:0")?.name).toBe("Independent New Name");
});

test("binding source owns only IDs and item types, with no independently editable name", () => {
  expect(ITEM_DATA_SOURCES.runewords.bindings.every(binding => binding.length === 3)).toBe(true);
});

test("bindings must join to named runeword identities rather than other catalog domains", () => {
  const changed = structuredClone(ITEM_DATA_SOURCES);
  changed.runewords.bindings[0][1] = "normal:0:0:0";
  // Both are structurally valid catalog keys; the semantic join must reject it.
  expect(validateItemDataShape(changed)).toEqual([]);
  expect(validateItemData(changed)).toContain("Invalid runeword binding");
});
