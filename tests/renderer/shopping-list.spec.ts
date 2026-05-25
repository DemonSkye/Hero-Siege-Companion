import { describe, expect, test } from "vitest";
import { addShoppingListItem, clampShoppingListIndex, nextShoppingListIndex, removeShoppingListItem } from "../../src/renderer/src/lib/shopping-list";

describe("shopping list helpers", () => {
  test("adds canonical autocomplete names and selects the added item", () => {
    expect(addShoppingListItem(["Ruby"], "the wheel of fortune", 0, ["The Wheel of Fortune"])).toEqual({
      items: ["Ruby", "The Wheel of Fortune"],
      activeIndex: 1,
      selectedItem: "The Wheel of Fortune",
    });
  });

  test("dedupes case-insensitively without moving existing items", () => {
    expect(addShoppingListItem(["Ruby"], "ruby", 0, ["Ruby"])).toEqual({
      items: ["Ruby"],
      activeIndex: 0,
      selectedItem: "Ruby",
    });
  });

  test("removes items and clamps the active index", () => {
    expect(removeShoppingListItem(["Ruby", "Sapphire", "Emerald"], "Sapphire", 2)).toEqual({
      items: ["Ruby", "Emerald"],
      activeIndex: 1,
    });
    expect(clampShoppingListIndex(["Ruby"], 10)).toBe(0);
    expect(nextShoppingListIndex(["Ruby", "Sapphire"], 1)).toBe(0);
  });
});
