import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { inferredItemTypeLabel, itemNameOptionByNormalizedName } from "./item-options";
import { isRecord, normalizeLookupText, normalizeSortText, stringField, structuredCloneCompat } from "./text";

export interface ItemFilterSpecificItem {
  name: string;
  soundId: string;
  typeLabel: string;
}

export interface ItemFilterGroup {
  id: string;
  name: string;
  enabled: boolean;
  soundId: string;
  volume: number;
  cooldownMs: number;
  rarities: string[];
  types: number[];
  items: ItemFilterSpecificItem[];
}

export interface ItemFilterMatch {
  itemLabel: string;
  groupName: string;
  soundName: string;
  createdAt: number;
}

export interface ItemFilterRuleMatch {
  group: ItemFilterGroup;
  soundId: string;
  item: ItemTimelineEntry;
}

export const ITEM_FILTER_SUGGESTION_LIMIT = 12;
export const ITEM_FILTER_RARITIES = ["Set", "Satanic", "Heroic", "Angelic", "Unholy", "Runeword"];
export const ITEM_FILTER_SOUNDS = [
  { id: "crystal-tink", name: "Crystal Tink" },
  { id: "coin-ping", name: "Coin Ping" },
  { id: "bell-chime", name: "Bell Chime" },
  { id: "rune-spark", name: "Rune Spark" },
  { id: "deep-gong", name: "Deep Gong" },
  { id: "soft-pop", name: "Soft Pop" },
  { id: "bright-cascade", name: "Bright Cascade" },
  { id: "low-pulse", name: "Low Pulse" },
] as const;

export const DEFAULT_ITEM_FILTER_GROUPS: ItemFilterGroup[] = [
  {
    id: "sample-group",
    name: "Sample Group",
    enabled: true,
    soundId: "crystal-tink",
    volume: 70,
    cooldownMs: 1200,
    rarities: ["Heroic"],
    types: [],
    items: [],
  },
];

export function createItemFilterGroup(name: string, index: number): ItemFilterGroup {
  return {
    id: `group-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: name.trim() || `Group ${index + 1}`,
    enabled: true,
    soundId: ITEM_FILTER_SOUNDS[0].id,
    volume: 70,
    cooldownMs: 1000,
    rarities: [],
    types: [],
    items: [],
  };
}

export function normalizeItemFilterGroups(value: unknown): ItemFilterGroup[] {
  const groups = Array.isArray(value) ? value : DEFAULT_ITEM_FILTER_GROUPS;
  const normalized = groups.map(normalizeItemFilterGroup).filter(Boolean) as ItemFilterGroup[];
  return normalized.length ? normalized.slice(0, 40) : structuredCloneCompat(DEFAULT_ITEM_FILTER_GROUPS);
}

function normalizeItemFilterGroup(value: unknown): ItemFilterGroup | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id") || `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const volume = Number(value.volume);
  const cooldownMs = Number(value.cooldownMs);
  return {
    id,
    name: stringField(value, "name") || "Untitled Group",
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    soundId: validSoundId(stringField(value, "soundId")) ? stringField(value, "soundId") : ITEM_FILTER_SOUNDS[0].id,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.trunc(volume))) : 70,
    cooldownMs: Number.isFinite(cooldownMs) ? Math.max(0, Math.min(30_000, Math.trunc(cooldownMs))) : 1000,
    rarities: normalizeStringList(value.rarities).filter((rarity) => ITEM_FILTER_RARITIES.includes(rarity)),
    types: normalizeNumberList(value.types).filter((type) => Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAMES, type)),
    items: normalizeSpecificItems(value.items),
  };
}

export function normalizeSpecificItems(value: unknown): ItemFilterSpecificItem[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const items: ItemFilterSpecificItem[] = [];
  for (const item of values) {
    const name = typeof item === "string" ? item.trim() : isRecord(item) ? stringField(item, "name").trim() : "";
    if (!name) continue;
    const canonical = canonicalItemName(name);
    const normalizedName = normalizeLookupText(canonical);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const soundId = isRecord(item) && validSoundId(stringField(item, "soundId")) ? stringField(item, "soundId") : "";
    items.push({ name: canonical, soundId, typeLabel: itemTypeLabelForName(canonical) });
  }
  return sortSpecificItems(items).slice(0, 150);
}

function validSoundId(soundId: string): boolean {
  return ITEM_FILTER_SOUNDS.some((sound) => sound.id === soundId);
}

export function soundName(soundId: string): string {
  return ITEM_FILTER_SOUNDS.find((sound) => sound.id === soundId)?.name ?? ITEM_FILTER_SOUNDS[0].name;
}

export function canonicalItemName(name: string): string {
  const trimmed = name.trim();
  return itemNameOptionByNormalizedName.get(normalizeLookupText(trimmed))?.name ?? trimmed;
}

export function itemTypeLabelForName(name: string): string {
  return itemNameOptionByNormalizedName.get(normalizeLookupText(name))?.typeLabel ?? inferredItemTypeLabel(name);
}

function sortSpecificItems(items: ItemFilterSpecificItem[]): ItemFilterSpecificItem[] {
  return [...items].sort((a, b) => itemTypeLabelForName(a.name).localeCompare(itemTypeLabelForName(b.name)) || normalizeSortText(a.name).localeCompare(normalizeSortText(b.name)));
}

export function itemFilterGroupedItems(group: ItemFilterGroup | null): Array<{ typeLabel: string; items: ItemFilterSpecificItem[] }> {
  if (!group) return [];
  const groups = new Map<string, ItemFilterSpecificItem[]>();
  const seen = new Set<string>();
  for (const item of sortSpecificItems(group.items)) {
    const canonical = canonicalItemName(item.name);
    const normalizedName = normalizeLookupText(canonical);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const typeLabel = itemTypeLabelForName(canonical);
    item.name = canonical;
    item.typeLabel = typeLabel;
    const items = groups.get(typeLabel) ?? [];
    items.push(item);
    groups.set(typeLabel, items);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([typeLabel, items]) => ({ typeLabel, items }));
}

export function toggleFilterRarity(group: ItemFilterGroup, rarity: string, enabled: boolean) {
  const next = new Set(group.rarities);
  if (enabled) next.add(rarity);
  else next.delete(rarity);
  group.rarities = Array.from(next);
}

export function toggleFilterType(group: ItemFilterGroup, type: number, enabled: boolean) {
  const next = new Set(group.types);
  if (enabled) next.add(type);
  else next.delete(type);
  group.types = Array.from(next).sort((a, b) => a - b);
}

export function matchItemFilter(item: ItemTimelineEntry, activeGroups: ItemFilterGroup[]): ItemFilterRuleMatch | null {
  const label = item.label || (item.id ? `#${item.id}` : "");
  const normalizedLookupLabel = normalizeLookupText(label);
  for (const group of activeGroups) {
    const specificItem = group.items.find((candidate) => normalizeLookupText(candidate.name) === normalizedLookupLabel);
    if (specificItem) return { group, soundId: specificItem.soundId || group.soundId, item };
  }

  for (const group of activeGroups) {
    const hasGroupCriteria = group.rarities.length > 0 || group.types.length > 0;
    if (!hasGroupCriteria) continue;
    const matchesRarity = group.rarities.length === 0 || group.rarities.some((rarity) => rarity.toLowerCase() === item.rarity.toLowerCase());
    const matchesType = group.types.length === 0 || group.types.includes(item.type);
    if (matchesRarity && matchesType) return { group, soundId: group.soundId, item };
  }

  return null;
}

export function itemTimelineKey(item: ItemTimelineEntry): string {
  return `${item.createdAt}:${item.fingerprint ?? ""}:${item.type}:${item.id}:${item.label}`;
}

function normalizeStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map((item) => String(item).trim()).filter(Boolean)));
}

function normalizeNumberList(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map(Number).filter(Number.isFinite).map(Math.trunc)));
}
