import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { activeItemCatalog, type ItemCatalogDefinition } from "../../../shared/item-catalog";
import { allItemIconNames } from "../../../shared/item-icons";
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

const itemNameOptions = createItemNameOptions(activeItemCatalog.allDefinitions());
export const itemNameOptionByNormalizedName = new Map(itemNameOptions.map((option) => [normalizeLookupText(option.name), option]));
export const shoppingAutocompleteNames = itemNameOptions.map((option) => option.name);

export function createItemNameOptions(
  catalogDefinitions: readonly ItemCatalogDefinition[],
  iconNames: readonly string[] = allItemIconNames(),
): ItemNameOption[] {
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
  for (const name of iconNames) addOption(name, inferredItemTypeValue(name));
  for (const definition of catalogDefinitions) {
    const name = definition.identityMode === "seeded" ? definition.baseName : definition.name;
    addOption(name, definition.type);
  }

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
