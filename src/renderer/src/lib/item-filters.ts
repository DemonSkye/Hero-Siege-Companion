import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { inferredItemTypeLabel, itemNameOptionByNormalizedName } from "./item-options";
import { isRecord, normalizeLookupText, normalizeSortText, stringField, structuredCloneCompat } from "./text";

export interface ItemFilterSpecificItem {
  name: string;
  soundId: string;
  typeLabel: string;
}

export interface ItemFilterSoundOption {
  id: string;
  name: string;
}

export interface CustomItemFilterSound extends ItemFilterSoundOption {
  src: string;
  fileName: string;
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

export interface ItemFilterMatchTotal {
  id: string;
  itemLabel: string;
  groupName: string;
  count: number;
  lastMatchedAt: number;
}

export interface ItemFilterRuleMatch {
  group: ItemFilterGroup;
  soundId: string;
  item: ItemTimelineEntry;
}

export interface ItemFilterCriteriaItem {
  name: string;
  soundId?: string;
}

export interface ItemFilterCriteriaGroup {
  rarities: string[];
  types: number[];
  items: Array<string | ItemFilterCriteriaItem>;
}

export interface ItemFilterMatchCandidate {
  source?: ItemTimelineEntry["source"];
  rarity: string;
  label: string;
  type: number;
}

export const ITEM_FILTER_SUGGESTION_LIMIT = 12;
export const ITEM_FILTER_RARITIES = ["Set", "Satanic", "Heroic", "Angelic", "Unholy", "Runeword"];
export const INVENTORY_SOURCE_ITEM_FILTER_TYPES = new Set([11, 12, 13, 14, 15, 18]);
export const ITEM_FILTER_TIMELINE_VALUE_PREFIX = "item-filter:";
export const ITEM_FILTER_SOUNDS: ItemFilterSoundOption[] = [
  { id: "crystal-tink", name: "Crystal Tink" },
  { id: "coin-ping", name: "Coin Ping" },
  { id: "bell-chime", name: "Bell Chime" },
  { id: "rune-spark", name: "Rune Spark" },
  { id: "deep-gong", name: "Deep Gong" },
  { id: "soft-pop", name: "Soft Pop" },
  { id: "bright-cascade", name: "Bright Cascade" },
  { id: "low-pulse", name: "Low Pulse" },
];
export const CUSTOM_SOUND_LIMIT = 24;
export const CUSTOM_SOUND_ID_PREFIX = "custom-sound:";

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
  return createBaseItemFilterGroup(`group-${Date.now()}-${Math.random().toString(16).slice(2)}`, name.trim() || `Group ${index + 1}`);
}

export function createRecoveredItemFilterGroup(id: string, name: string, index: number): ItemFilterGroup {
  return createBaseItemFilterGroup(id.trim() || `group-${Date.now()}-${Math.random().toString(16).slice(2)}`, name.trim() || `Recovered Group ${index + 1}`);
}

function createBaseItemFilterGroup(id: string, name: string): ItemFilterGroup {
  return {
    id,
    name,
    enabled: true,
    soundId: ITEM_FILTER_SOUNDS[0].id,
    volume: 70,
    cooldownMs: 1000,
    rarities: [],
    types: [],
    items: [],
  };
}

export function normalizeItemFilterGroups(value: unknown, customSounds: CustomItemFilterSound[] = []): ItemFilterGroup[] {
  const groups = Array.isArray(value) ? value : DEFAULT_ITEM_FILTER_GROUPS;
  const normalized = groups.map((group) => normalizeItemFilterGroup(group, customSounds)).filter(Boolean) as ItemFilterGroup[];
  return normalized.length ? normalized.slice(0, 40) : structuredCloneCompat(DEFAULT_ITEM_FILTER_GROUPS);
}

function normalizeItemFilterGroup(value: unknown, customSounds: CustomItemFilterSound[]): ItemFilterGroup | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id") || `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const volume = Number(value.volume);
  const cooldownMs = Number(value.cooldownMs);
  const soundId = stringField(value, "soundId");
  return {
    id,
    name: stringField(value, "name") || "Untitled Group",
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    soundId: validSoundId(soundId, customSounds) ? soundId : ITEM_FILTER_SOUNDS[0].id,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.trunc(volume))) : 70,
    cooldownMs: Number.isFinite(cooldownMs) ? Math.max(0, Math.min(30_000, Math.trunc(cooldownMs))) : 1000,
    rarities: normalizeStringList(value.rarities).filter((rarity) => ITEM_FILTER_RARITIES.includes(rarity)),
    types: normalizeNumberList(value.types).filter((type) => Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAMES, type)),
    items: normalizeSpecificItems(value.items, customSounds),
  };
}

export function normalizeSpecificItems(value: unknown, customSounds: CustomItemFilterSound[] = []): ItemFilterSpecificItem[] {
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
    const soundId = isRecord(item) && validSoundId(stringField(item, "soundId"), customSounds) ? stringField(item, "soundId") : "";
    items.push({ name: canonical, soundId, typeLabel: itemTypeLabelForName(canonical) });
  }
  return sortSpecificItems(items).slice(0, 150);
}

export function normalizeCustomItemFilterSounds(value: unknown): CustomItemFilterSound[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const sounds: CustomItemFilterSound[] = [];
  for (const item of values) {
    if (!isRecord(item)) continue;
    const id = stringField(item, "id");
    const src = stringField(item, "src") || stringField(item, "dataUrl");
    if (!id.startsWith(CUSTOM_SOUND_ID_PREFIX) || !isCustomSoundSource(src)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const fileName = stringField(item, "fileName").trim() || "Custom Sound.audio";
    const name = stringField(item, "name").trim() || customSoundDisplayName(fileName);
    sounds.push({
      id,
      name: name.slice(0, 60),
      fileName: fileName.slice(0, 120),
      src,
    });
  }
  return sounds.slice(0, CUSTOM_SOUND_LIMIT);
}

function isCustomSoundSource(value: string): boolean {
  return value.startsWith("data:audio/") || value.startsWith("file://");
}

export function createCustomSoundId(fileName: string, index: number): string {
  const normalized = normalizeLookupText(fileName).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sound";
  return `${CUSTOM_SOUND_ID_PREFIX}${Date.now()}-${index}-${normalized}`;
}

export function customSoundDisplayName(fileName: string): string {
  return fileName.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Custom Sound";
}

export function itemFilterSoundOptions(customSounds: CustomItemFilterSound[] = []): ItemFilterSoundOption[] {
  return [...ITEM_FILTER_SOUNDS, ...normalizeCustomItemFilterSounds(customSounds).map(({ id, name }) => ({ id, name }))];
}

export function customSoundForId(soundId: string, customSounds: CustomItemFilterSound[] = []): CustomItemFilterSound | null {
  return normalizeCustomItemFilterSounds(customSounds).find((sound) => sound.id === soundId) ?? null;
}

function validSoundId(soundId: string, customSounds: CustomItemFilterSound[] = []): boolean {
  return itemFilterSoundOptions(customSounds).some((sound) => sound.id === soundId);
}

export function soundName(soundId: string, sounds: ItemFilterSoundOption[] = ITEM_FILTER_SOUNDS): string {
  return sounds.find((sound) => sound.id === soundId)?.name ?? ITEM_FILTER_SOUNDS[0].name;
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
    const groupedItem = { ...item, name: canonical, typeLabel };
    const items = groups.get(typeLabel) ?? [];
    items.push(groupedItem);
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

export function itemFilterTimelineValue(group: Pick<ItemFilterGroup, "id">): string {
  return `${ITEM_FILTER_TIMELINE_VALUE_PREFIX}${group.id}`;
}

export function itemFilterIdFromTimelineValue(value: string): string | null {
  return value.startsWith(ITEM_FILTER_TIMELINE_VALUE_PREFIX)
    ? value.slice(ITEM_FILTER_TIMELINE_VALUE_PREFIX.length)
    : null;
}

export function itemFilterHasTimelineCriteria(group: ItemFilterGroup): boolean {
  return group.items.length > 0 || group.rarities.length > 0 || group.types.length > 0;
}

export function itemFilterTimelineOptions(groups: ItemFilterGroup[]): Array<{ value: string; label: string }> {
  return groups
    .filter(itemFilterHasTimelineCriteria)
    .map((group) => ({
      value: itemFilterTimelineValue(group),
      label: `Filter: ${group.name}${group.enabled ? "" : " (disabled)"}`,
    }));
}

export function matchItemFilter(item: ItemTimelineEntry, activeGroups: ItemFilterGroup[]): ItemFilterRuleMatch | null {
  const label = item.label || (item.id ? `#${item.id}` : "");
  const normalizedLookupLabel = normalizeLookupText(label);
  for (const group of activeGroups) {
    const specificItem = matchingSpecificCriteriaItem(group, normalizedLookupLabel);
    if (specificItem) return { group, soundId: criteriaItemSoundId(specificItem) || group.soundId, item };
  }

  for (const group of activeGroups) {
    if (itemMatchesRarityTypeCriteria(item, group)) return { group, soundId: group.soundId, item };
  }

  return null;
}

export function itemMatchesItemFilterCriteria(item: ItemFilterMatchCandidate, group: ItemFilterCriteriaGroup): boolean {
  const normalizedLookupLabel = normalizeLookupText(item.label);
  return Boolean(matchingSpecificCriteriaItem(group, normalizedLookupLabel)) || itemMatchesRarityTypeCriteria(item, group);
}

function matchingSpecificCriteriaItem(group: ItemFilterCriteriaGroup, normalizedLookupLabel: string): string | ItemFilterCriteriaItem | null {
  return group.items.find((candidate) => normalizeLookupText(criteriaItemName(candidate)) === normalizedLookupLabel) ?? null;
}

function criteriaItemName(item: string | ItemFilterCriteriaItem): string {
  return typeof item === "string" ? item : item.name;
}

function criteriaItemSoundId(item: string | ItemFilterCriteriaItem): string {
  return typeof item === "string" ? "" : item.soundId ?? "";
}

function itemMatchesRarityTypeCriteria(item: ItemFilterMatchCandidate, group: ItemFilterCriteriaGroup): boolean {
  const hasGroupCriteria = group.rarities.length > 0 || group.types.length > 0;
  if (!hasGroupCriteria) return false;
  const matchesType = group.types.length === 0 || group.types.includes(item.type);
  const matchesRarity =
    group.rarities.length === 0 ||
    itemCanMatchSelectedTypeWithoutRarity(item, group, matchesType) ||
    group.rarities.some((rarity) => rarity.toLowerCase() === item.rarity.toLowerCase());
  return matchesRarity && matchesType;
}

function itemCanMatchSelectedTypeWithoutRarity(item: ItemFilterMatchCandidate, group: ItemFilterCriteriaGroup, matchesType: boolean): boolean {
  return item.source === "inventory" && matchesType && group.types.length > 0 && INVENTORY_SOURCE_ITEM_FILTER_TYPES.has(item.type);
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
