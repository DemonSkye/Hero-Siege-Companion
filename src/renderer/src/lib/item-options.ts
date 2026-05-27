import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { allItemIconNames } from "../../../shared/item-icons";
import { allItemTranslations } from "../../../shared/item-lookup";
import { allStackItemTranslations } from "../../../shared/stack-item-lookup";
import { normalizeLookupText, normalizeSortText } from "./text";

interface ItemNameOption {
  name: string;
  type: number | null;
  typeLabel: string;
  sortName: string;
}

export const DEFAULT_SHOPPING_LIST = ["Copper Ore", "Iron Ore", "Gold Ore", "Ruby", "Jade", "Tarethium Ore"];
export const SHOPPING_SUGGESTION_LIMIT = 8;

export const ITEM_TYPE_OPTIONS = Object.entries(ITEM_TYPE_NAMES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

const itemNameOptions = itemNameOptionList();
export const itemNameOptionByNormalizedName = new Map(itemNameOptions.map((option) => [normalizeLookupText(option.name), option]));
export const shoppingAutocompleteNames = itemNameOptions.map((option) => option.name);

function itemNameOptionList(): ItemNameOption[] {
  const options = new Map<string, ItemNameOption>();
  const addOption = (name: string, type: number | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = normalizeLookupText(trimmed);
    const existing = options.get(key);
    const typeLabel = typeLabelForType(type, trimmed);
    if (!existing || (type !== null && existing.type === null) || typeLabel !== "Item") {
      options.set(key, { name: trimmed, type, typeLabel, sortName: normalizeSortText(trimmed) });
    }
  };

  for (const name of DEFAULT_SHOPPING_LIST) addOption(name, inferredItemTypeValue(name));
  for (const item of allStackItemTranslations()) addOption(item.name, item.type);
  for (const item of allItemTranslations()) addOption(item.name, item.type);
  for (const name of allItemIconNames()) addOption(name, inferredItemTypeValue(name));

  return Array.from(options.values()).sort((a, b) => a.typeLabel.localeCompare(b.typeLabel) || a.sortName.localeCompare(b.sortName));
}

function typeLabelForType(type: number | null, name: string): string {
  if (type !== null) return ITEM_TYPE_NAMES[type] ?? "Item";
  return inferredItemTypeLabel(name);
}

export function itemTypeValueForName(name: string): number | null {
  return itemNameOptionByNormalizedName.get(normalizeLookupText(name))?.type ?? inferredItemTypeValue(name);
}

export function inferredItemTypeValue(name: string): number | null {
  const normalized = normalizeLookupText(name);
  if (normalized.includes("key")) return 12;
  if (normalized.includes("ore") || ["ruby", "jade"].includes(normalized)) return 14;
  return null;
}

export function inferredItemTypeLabel(name: string): string {
  const type = inferredItemTypeValue(name);
  return type === null ? "Item" : ITEM_TYPE_NAMES[type] ?? "Item";
}
