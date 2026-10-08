import data from "./data/items/build-24868792/rarities.json";

type KnownItemRarity = "Satanic" | "Set" | "Angelic" | "Heroic" | "Unholy" | "Runeword";

const ITEM_RARITY_BY_NAME: Readonly<Record<string, KnownItemRarity>> = data.byNormalizedName as Readonly<Record<string, KnownItemRarity>>;

export function lookupKnownItemRarity(_type: number, name: string | undefined): KnownItemRarity | null {
  if (!name) return null;
  return ITEM_RARITY_BY_NAME[normalizeItemName(name)] ?? null;
}

function normalizeItemName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019`\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '\"')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '\"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
