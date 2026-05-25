import { normalizeShoppingList } from "./preferences";

export interface ShoppingListUpdate {
  items: string[];
  activeIndex: number;
  selectedItem?: string;
}

export function addShoppingListItem(
  items: string[],
  value: string,
  activeIndex: number,
  autocompleteNames: string[],
): ShoppingListUpdate {
  const trimmed = value.trim();
  const canonical = autocompleteNames.find((name) => name.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
  const [normalized] = normalizeShoppingList([canonical]);
  if (!normalized) return { items, activeIndex };

  const exists = items.some((item) => item.toLowerCase() === normalized.toLowerCase());
  const nextItems = exists ? items : [...items, normalized];
  const nextIndex = nextItems.findIndex((item) => item.toLowerCase() === normalized.toLowerCase());
  return { items: nextItems, activeIndex: nextIndex >= 0 ? nextIndex : activeIndex, selectedItem: normalized };
}

export function removeShoppingListItem(items: string[], item: string, activeIndex: number): ShoppingListUpdate {
  const removedIndex = items.findIndex((candidate) => candidate === item);
  const nextItems = items.filter((candidate) => candidate !== item);
  const nextActiveIndex = removedIndex >= 0 && activeIndex >= removedIndex ? Math.max(0, activeIndex - 1) : activeIndex;
  return { items: nextItems, activeIndex: clampShoppingListIndex(nextItems, nextActiveIndex) };
}

export function nextShoppingListIndex(items: string[], activeIndex: number): number {
  if (items.length === 0) return 0;
  return (activeIndex + 1) % items.length;
}

export function clampShoppingListIndex(items: string[], activeIndex: number): number {
  if (items.length === 0) return 0;
  return Math.min(Math.max(activeIndex, 0), items.length - 1);
}
