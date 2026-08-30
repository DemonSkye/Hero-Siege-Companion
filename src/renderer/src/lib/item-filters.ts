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

export interface ItemFilterSoundResolution {
  soundId: string;
  effectiveSoundId: string;
  name: string;
  fallbackName: string;
  missingCustomSound: boolean;
}

export interface CustomItemFilterSound extends ItemFilterSoundOption {
  src: string;
  fileName: string;
}

export interface ItemFilterPackPayload {
  app: "hero-siege-companion";
  kind: typeof ITEM_FILTER_PACK_KIND;
  schemaVersion: typeof ITEM_FILTER_PACK_SCHEMA_VERSION;
  exportedAt: string;
  uiPreferences: {
    itemFilterGroups: ItemFilterGroup[];
    customItemFilterSounds: CustomItemFilterSound[];
  };
}

export interface ItemFilterPackImportPreview {
  groups: ItemFilterGroup[];
  sounds: CustomItemFilterSound[];
  unusedSounds: CustomItemFilterSound[];
  missingCustomSoundIds: string[];
}

export interface ItemFilterPackMergeResult {
  groups: ItemFilterGroup[];
  sounds: CustomItemFilterSound[];
  addedGroupCount: number;
  addedSoundCount: number;
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

export interface ItemFilterMatchHistoryEntry {
  id: string;
  item: ItemTimelineEntry;
  groupId: string;
  groupName: string;
  soundName: string;
  matchedAt: number;
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
export const ITEM_FILTER_FALLBACK_SOUND_ID = ITEM_FILTER_SOUNDS[0].id;
export const CUSTOM_SOUND_LIMIT = 24;
export const CUSTOM_SOUND_ID_PREFIX = "custom-sound:";
export const ITEM_FILTER_GROUP_LIMIT = 40;
export const ITEM_FILTER_PACK_KIND = "item-filter-pack";
export const ITEM_FILTER_PACK_SCHEMA_VERSION = 1;

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
  if (!Array.isArray(value)) return structuredCloneCompat(DEFAULT_ITEM_FILTER_GROUPS);
  return normalizeItemFilterGroupList(value, customSounds);
}

function normalizeItemFilterGroupList(value: unknown, customSounds: CustomItemFilterSound[]): ItemFilterGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((group) => normalizeItemFilterGroup(group, customSounds))
    .filter((group): group is ItemFilterGroup => Boolean(group))
    .slice(0, ITEM_FILTER_GROUP_LIMIT);
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
    soundId: normalizeItemFilterSoundId(soundId, customSounds, ITEM_FILTER_FALLBACK_SOUND_ID),
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
    const soundId = isRecord(item) ? normalizeItemFilterSoundId(stringField(item, "soundId"), customSounds, "") : "";
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

export function referencedCustomItemFilterSoundIds(groups: ItemFilterGroup[]): string[] {
  const ids = new Set<string>();
  for (const group of groups) {
    if (isCustomSoundId(group.soundId)) ids.add(group.soundId);
    for (const item of group.items) {
      if (isCustomSoundId(item.soundId)) ids.add(item.soundId);
    }
  }
  return Array.from(ids);
}

export function createItemFilterPackPayload(
  groups: ItemFilterGroup[],
  customSounds: CustomItemFilterSound[],
  exportedAt = new Date().toISOString(),
): ItemFilterPackPayload {
  const normalizedSounds = normalizeCustomItemFilterSounds(customSounds);
  const normalizedGroups = normalizeItemFilterGroupList(groups, normalizedSounds);
  const referencedSoundIds = new Set(referencedCustomItemFilterSoundIds(normalizedGroups));
  return {
    app: "hero-siege-companion",
    kind: ITEM_FILTER_PACK_KIND,
    schemaVersion: ITEM_FILTER_PACK_SCHEMA_VERSION,
    exportedAt,
    uiPreferences: {
      itemFilterGroups: structuredCloneCompat(normalizedGroups),
      customItemFilterSounds: normalizedSounds.filter((sound) => referencedSoundIds.has(sound.id)),
    },
  };
}

export function parseItemFilterPackPayload(value: unknown): ItemFilterPackImportPreview | null {
  const parsed = parseJsonRecord(value);
  if (
    !parsed ||
    parsed.app !== "hero-siege-companion" ||
    parsed.kind !== ITEM_FILTER_PACK_KIND ||
    parsed.schemaVersion !== ITEM_FILTER_PACK_SCHEMA_VERSION ||
    !isRecord(parsed.uiPreferences)
  ) {
    return null;
  }

  const availableSounds = normalizeCustomItemFilterSounds(parsed.uiPreferences.customItemFilterSounds);
  const groups = normalizeItemFilterGroupList(parsed.uiPreferences.itemFilterGroups, availableSounds);
  if (!groups.length) return null;
  const referencedSoundIds = new Set(referencedCustomItemFilterSoundIds(groups));
  const sounds = availableSounds.filter((sound) => referencedSoundIds.has(sound.id));
  const availableSoundIds = new Set(sounds.map((sound) => sound.id));
  return {
    groups,
    sounds,
    unusedSounds: availableSounds.filter((sound) => !referencedSoundIds.has(sound.id)),
    missingCustomSoundIds: Array.from(referencedSoundIds).filter((id) => !availableSoundIds.has(id)),
  };
}

export function mergeItemFilterPack(
  currentGroups: ItemFilterGroup[],
  currentSounds: CustomItemFilterSound[],
  pack: ItemFilterPackImportPreview,
): ItemFilterPackMergeResult {
  const normalizedCurrentSounds = normalizeCustomItemFilterSounds(currentSounds);
  const normalizedCurrentGroups = normalizeItemFilterGroupList(currentGroups, normalizedCurrentSounds);
  const availableGroupSlots = Math.max(0, ITEM_FILTER_GROUP_LIMIT - normalizedCurrentGroups.length);
  const selectedImportedGroups = pack.groups.slice(0, availableGroupSlots);
  const selectedImportedSoundIds = new Set(referencedCustomItemFilterSoundIds(selectedImportedGroups));
  const currentSoundsById = new Map(normalizedCurrentSounds.map((sound) => [sound.id, sound]));
  const usedSoundIds = new Set(currentSoundsById.keys());
  const soundIdRemap = new Map<string, string>();
  const importedSoundAdditions: CustomItemFilterSound[] = [];
  const availableSoundSlots = Math.max(0, CUSTOM_SOUND_LIMIT - normalizedCurrentSounds.length);

  for (const sound of normalizeCustomItemFilterSounds(pack.sounds)) {
    if (!selectedImportedSoundIds.has(sound.id)) continue;
    const currentSound = currentSoundsById.get(sound.id);
    if (currentSound?.src === sound.src) {
      soundIdRemap.set(sound.id, sound.id);
      continue;
    }

    const id = currentSound ? uniqueImportedSoundId(sound.id, usedSoundIds) : sound.id;
    soundIdRemap.set(sound.id, id);
    usedSoundIds.add(id);
    if (importedSoundAdditions.length < availableSoundSlots) {
      importedSoundAdditions.push({
        ...sound,
        id,
        name: id === sound.id ? sound.name : `${sound.name} (Imported)`,
      });
    }
  }

  for (const soundId of selectedImportedSoundIds) {
    if (!soundIdRemap.has(soundId) && currentSoundsById.has(soundId)) {
      soundIdRemap.set(soundId, uniqueImportedSoundId(soundId, usedSoundIds));
    }
  }
  const sounds = normalizeCustomItemFilterSounds([...normalizedCurrentSounds, ...importedSoundAdditions]);

  const usedGroupIds = new Set(normalizedCurrentGroups.map((group) => group.id));
  const importedGroups = selectedImportedGroups.map((group) => {
    const originalId = group.id;
    const id = uniqueImportedGroupId(originalId, usedGroupIds);
    return {
      ...group,
      id,
      name: id === originalId ? group.name : `${group.name} (Imported)`,
      soundId: soundIdRemap.get(group.soundId) ?? group.soundId,
      items: group.items.map((item) => ({
        ...item,
        soundId: soundIdRemap.get(item.soundId) ?? item.soundId,
      })),
      rarities: [...group.rarities],
      types: [...group.types],
    };
  });
  const groups = normalizeItemFilterGroupList([...normalizedCurrentGroups, ...importedGroups], sounds);

  return {
    groups,
    sounds,
    addedGroupCount: groups.length - normalizedCurrentGroups.length,
    addedSoundCount: importedSoundAdditions.length,
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function uniqueImportedGroupId(value: string, usedIds: Set<string>): string {
  const base = value.trim() || "imported-filter";
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let suffix = 2;
  while (usedIds.has(`${base}-imported-${suffix}`)) suffix += 1;
  const id = `${base}-imported-${suffix}`;
  usedIds.add(id);
  return id;
}

function uniqueImportedSoundId(value: string, usedIds: Set<string>): string {
  const base = value.trim() || `${CUSTOM_SOUND_ID_PREFIX}imported`;
  let suffix = 2;
  while (usedIds.has(`${base}-imported-${suffix}`)) suffix += 1;
  const id = `${base}-imported-${suffix}`;
  usedIds.add(id);
  return id;
}

export function customSoundForId(soundId: string, customSounds: CustomItemFilterSound[] = []): CustomItemFilterSound | null {
  return normalizeCustomItemFilterSounds(customSounds).find((sound) => sound.id === soundId) ?? null;
}

export function isCustomSoundId(soundId: string): boolean {
  return soundId.trim().startsWith(CUSTOM_SOUND_ID_PREFIX);
}

export function resolveItemFilterSound(soundId: string, sounds: ItemFilterSoundOption[] = ITEM_FILTER_SOUNDS): ItemFilterSoundResolution {
  const trimmedSoundId = soundId.trim();
  const fallback = sounds.find((sound) => sound.id === ITEM_FILTER_FALLBACK_SOUND_ID) ?? ITEM_FILTER_SOUNDS[0];
  const option = sounds.find((sound) => sound.id === trimmedSoundId);
  if (option) {
    return {
      soundId: trimmedSoundId,
      effectiveSoundId: option.id,
      name: option.name,
      fallbackName: fallback.name,
      missingCustomSound: false,
    };
  }

  if (isCustomSoundId(trimmedSoundId)) {
    return {
      soundId: trimmedSoundId,
      effectiveSoundId: fallback.id,
      name: "Missing custom sound",
      fallbackName: fallback.name,
      missingCustomSound: true,
    };
  }

  return {
    soundId: fallback.id,
    effectiveSoundId: fallback.id,
    name: fallback.name,
    fallbackName: fallback.name,
    missingCustomSound: false,
  };
}

function validSoundId(soundId: string, customSounds: CustomItemFilterSound[] = []): boolean {
  return itemFilterSoundOptions(customSounds).some((sound) => sound.id === soundId.trim());
}

function normalizeItemFilterSoundId(soundId: string, customSounds: CustomItemFilterSound[], fallbackSoundId: string): string {
  const trimmedSoundId = soundId.trim();
  if (!trimmedSoundId) return fallbackSoundId;
  if (validSoundId(trimmedSoundId, customSounds)) return trimmedSoundId;
  return isCustomSoundId(trimmedSoundId) ? trimmedSoundId : fallbackSoundId;
}

export function soundName(soundId: string, sounds: ItemFilterSoundOption[] = ITEM_FILTER_SOUNDS): string {
  return resolveItemFilterSound(soundId, sounds).name;
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

export function toggledStringList(values: string[], value: string, enabled: boolean): string[] {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return Array.from(next);
}

export function toggledNumberList(values: number[], value: number, enabled: boolean): number[] {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return Array.from(next).sort((a, b) => a - b);
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
