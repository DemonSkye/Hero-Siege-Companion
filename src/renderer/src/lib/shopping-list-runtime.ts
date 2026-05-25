import { computed, ref } from "vue";
import { SHOPPING_SUGGESTION_LIMIT, shoppingAutocompleteNames } from "./item-options";
import {
  addShoppingListItem,
  clampShoppingListIndex,
  nextShoppingListIndex,
  removeShoppingListItem,
} from "./shopping-list";

interface UseShoppingListRuntimeOptions {
  showToast: (message: string) => void;
}

export function useShoppingListRuntime({ showToast }: UseShoppingListRuntimeOptions) {
  const shoppingListItems = ref<string[]>([]);
  const shoppingDraftItem = ref("");
  const activeShoppingIndex = ref(0);
  const activeShoppingItem = computed(() => shoppingListItems.value[activeShoppingIndex.value] ?? shoppingListItems.value[0] ?? "");
  const shoppingSuggestions = computed(() => {
    const query = shoppingDraftItem.value.trim().toLowerCase();
    const existing = new Set(shoppingListItems.value.map((item) => item.toLowerCase()));
    if (!query) {
      return shoppingAutocompleteNames.filter((name) => !existing.has(name.toLowerCase())).slice(0, SHOPPING_SUGGESTION_LIMIT);
    }
    return shoppingAutocompleteNames
      .filter((name) => !existing.has(name.toLowerCase()) && name.toLowerCase().includes(query))
      .slice(0, SHOPPING_SUGGESTION_LIMIT);
  });

  async function copyShoppingItem(item: string, advance: boolean) {
    const trimmed = item.trim();
    if (!trimmed) return;
    await window.heroSiegeCompanion.writeClipboardText(trimmed);
    showToast(`Copied ${trimmed} to clipboard`);

    const index = shoppingListItems.value.findIndex((candidate) => candidate === item);
    if (index >= 0) activeShoppingIndex.value = index;
    if (advance) moveToNextShoppingItem();
  }

  function addShoppingItem(value = shoppingDraftItem.value) {
    const update = addShoppingListItem(shoppingListItems.value, value, activeShoppingIndex.value, shoppingAutocompleteNames);
    shoppingListItems.value = update.items;
    activeShoppingIndex.value = update.activeIndex;
    if (!update.selectedItem) return;
    shoppingDraftItem.value = "";
  }

  function removeShoppingItem(item: string) {
    const update = removeShoppingListItem(shoppingListItems.value, item, activeShoppingIndex.value);
    shoppingListItems.value = update.items;
    activeShoppingIndex.value = update.activeIndex;
  }

  function moveToNextShoppingItem() {
    activeShoppingIndex.value = nextShoppingListIndex(shoppingListItems.value, activeShoppingIndex.value);
  }

  function clampActiveShoppingIndex() {
    activeShoppingIndex.value = clampShoppingListIndex(shoppingListItems.value, activeShoppingIndex.value);
  }

  return {
    shoppingListItems,
    shoppingDraftItem,
    activeShoppingIndex,
    activeShoppingItem,
    shoppingSuggestions,
    copyShoppingItem,
    addShoppingItem,
    removeShoppingItem,
    moveToNextShoppingItem,
    clampActiveShoppingIndex,
  };
}
