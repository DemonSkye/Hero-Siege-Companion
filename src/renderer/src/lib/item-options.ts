import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { allItemIconNames } from "../../../shared/item-icons";
import { allItemTranslations, type ItemTranslation } from "../../../shared/item-lookup";
import { allStackItemTranslations } from "../../../shared/stack-item-lookup";
import { normalizeLookupText, normalizeSortText } from "./text";

interface ItemNameOption {
  name: string;
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
  const addOption = (name: string, typeLabel: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = normalizeLookupText(trimmed);
    const existing = options.get(key);
    if (!existing || typeLabel !== "Item") {
      options.set(key, { name: trimmed, typeLabel, sortName: normalizeSortText(trimmed) });
    }
  };

  for (const name of DEFAULT_SHOPPING_LIST) addOption(name, inferredItemTypeLabel(name));
  for (const item of allStackItemTranslations()) addOption(item.name, itemTypeLabelFromTranslation(item));
  for (const item of allItemTranslations()) addOption(item.name, itemTypeLabelFromTranslation(item));
  for (const name of allItemIconNames()) addOption(name, inferredItemTypeLabel(name));

  return Array.from(options.values()).sort((a, b) => a.typeLabel.localeCompare(b.typeLabel) || a.sortName.localeCompare(b.sortName));
}

function itemTypeLabelFromTranslation(item: ItemTranslation): string {
  return ITEM_TYPE_NAMES[item.type] ?? "Item";
}

export function inferredItemTypeLabel(name: string): string {
  const normalized = normalizeLookupText(name);
  if (normalized.includes("key")) return "Key";
  if (normalized.includes("ore") || ["ruby", "jade"].includes(normalized)) return "Material";
  return "Item";
}
