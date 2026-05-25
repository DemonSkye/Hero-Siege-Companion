import { describe, expect, test, vi } from "vitest";
import { useShoppingListRuntime } from "../../src/renderer/src/lib/shopping-list-runtime";

describe("shopping list runtime", () => {
  test("adds canonical items and advances after copying", async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: { writeClipboardText },
      configurable: true,
    });

    const showToast = vi.fn();
    const runtime = useShoppingListRuntime({ showToast });

    runtime.shoppingDraftItem.value = "ruby";
    runtime.addShoppingItem();
    runtime.addShoppingItem("jade");

    expect(runtime.shoppingListItems.value).toEqual(["Ruby", "Jade"]);
    expect(runtime.activeShoppingItem.value).toBe("Jade");

    await runtime.copyShoppingItem("Ruby", true);

    expect(writeClipboardText).toHaveBeenCalledWith("Ruby");
    expect(showToast).toHaveBeenCalledWith("Copied Ruby to clipboard");
    expect(runtime.activeShoppingItem.value).toBe("Jade");
  });

  test("excludes current shopping-list items from suggestions", () => {
    const runtime = useShoppingListRuntime({ showToast: vi.fn() });
    runtime.shoppingListItems.value = ["Ruby"];
    runtime.shoppingDraftItem.value = "rub";

    expect(runtime.shoppingSuggestions.value).not.toContain("Ruby");
  });
});
