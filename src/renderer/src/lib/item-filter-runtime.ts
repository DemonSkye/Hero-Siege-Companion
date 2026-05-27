import { computed, ref, type Ref } from "vue";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { playItemFilterSound } from "./item-filter-sounds";
import {
  ITEM_FILTER_SOUNDS,
  ITEM_FILTER_SUGGESTION_LIMIT,
  INVENTORY_SOURCE_ITEM_FILTER_TYPES,
  canonicalItemName,
  customSoundDisplayName,
  createCustomSoundId,
  createItemFilterGroup,
  createRecoveredItemFilterGroup,
  itemFilterGroupedItems,
  itemFilterSoundOptions,
  itemTimelineKey,
  itemTypeLabelForName,
  matchItemFilter,
  normalizeCustomItemFilterSounds,
  normalizeItemFilterGroups,
  normalizeSpecificItems,
  soundName,
  type CustomItemFilterSound,
  type ItemFilterGroup,
  type ItemFilterMatch,
  type ItemFilterMatchTotal,
  type ItemFilterRuleMatch,
  type ItemFilterSpecificItem,
} from "./item-filters";
import { shoppingAutocompleteNames } from "./item-options";
import { normalizeLookupText } from "./text";

export interface ItemFilterRuntimeOptions {
  itemFilterGroups: Ref<ItemFilterGroup[]>;
  itemFilterMuted: Ref<boolean>;
  customItemFilterSounds: Ref<CustomItemFilterSound[]>;
  showToast: (message: string) => void;
}

export function useItemFilterRuntime(options: ItemFilterRuntimeOptions) {
  const itemFilterDraftItem = ref("");
  const itemFilterDraftGroupName = ref("");
  const activeItemFilterGroupId = ref("");
  const lastItemFilterMatch = ref<ItemFilterMatch | null>(null);
  const itemFilterMatchTotals = ref<ItemFilterMatchTotal[]>([]);
  const itemFilterSeenTimelineKeys = new Set<string>();
  const itemFilterLastPlayedAt = new Map<string, number>();

  const activeItemFilterGroups = computed(() => options.itemFilterGroups.value.filter((group) => group.enabled));
  const watchedItemCount = computed(() =>
    options.itemFilterGroups.value.reduce((total, group) => total + new Set(group.items.map((item) => normalizeLookupText(item.name))).size, 0),
  );
  const itemFilterSoundOptionsList = computed(() => itemFilterSoundOptions(options.customItemFilterSounds.value));
  const selectedItemFilterGroup = computed(
    () => options.itemFilterGroups.value.find((group) => group.id === activeItemFilterGroupId.value) ?? options.itemFilterGroups.value[0] ?? null,
  );
  const selectedItemFilterGroupedItems = computed(() => itemFilterGroupedItems(selectedItemFilterGroup.value));
  const itemFilterSuggestions = computed(() => {
    const query = normalizeLookupText(itemFilterDraftItem.value);
    if (query.length < 3) return [];
    const existing = new Set((selectedItemFilterGroup.value?.items ?? []).map((item) => normalizeLookupText(item.name)));
    return shoppingAutocompleteNames
      .filter((name) => !existing.has(normalizeLookupText(name)) && normalizeLookupText(name).includes(query))
      .slice(0, ITEM_FILTER_SUGGESTION_LIMIT);
  });

  function addItemFilterGroup(): void {
    const nextGroup = createItemFilterGroup(itemFilterDraftGroupName.value, options.itemFilterGroups.value.length);
    options.itemFilterGroups.value = [...options.itemFilterGroups.value, nextGroup];
    activeItemFilterGroupId.value = nextGroup.id;
    itemFilterDraftGroupName.value = "";
  }

  function removeItemFilterGroup(group: ItemFilterGroup): void {
    options.itemFilterGroups.value = options.itemFilterGroups.value.filter((candidate) => candidate.id !== group.id);
    clampActiveItemFilterGroup();
  }

  function restoreMissingItemFilterGroup(id: string, name: string): void {
    const trimmedId = id.trim();
    if (!trimmedId) return;
    const existing = options.itemFilterGroups.value.find((group) => group.id === trimmedId);
    if (existing) {
      activeItemFilterGroupId.value = existing.id;
      return;
    }
    const group = createRecoveredItemFilterGroup(trimmedId, name, options.itemFilterGroups.value.length);
    options.itemFilterGroups.value = [...options.itemFilterGroups.value, group];
    activeItemFilterGroupId.value = group.id;
    options.showToast(`${group.name} restored`);
  }

  function selectItemFilterGroup(group: ItemFilterGroup): void {
    activeItemFilterGroupId.value = group.id;
  }

  function addItemToFilterGroup(group: ItemFilterGroup, value = itemFilterDraftItem.value): void {
    const trimmed = value.trim();
    const canonical = canonicalItemName(trimmed);
    if (!canonical) return;
    const normalizedName = normalizeLookupText(canonical);
    if (group.items.some((item) => normalizeLookupText(item.name) === normalizedName)) return;
    group.items = normalizeSpecificItems(
      [...group.items, { name: canonical, soundId: "", typeLabel: itemTypeLabelForName(canonical) }],
      options.customItemFilterSounds.value,
    );
    itemFilterDraftItem.value = "";
  }

  function removeItemFromFilterGroup(group: ItemFilterGroup, item: ItemFilterSpecificItem): void {
    const normalizedName = normalizeLookupText(item.name);
    group.items = group.items.filter((candidate) => normalizeLookupText(candidate.name) !== normalizedName);
  }

  function clampActiveItemFilterGroup(): void {
    if (options.itemFilterGroups.value.length === 0) {
      activeItemFilterGroupId.value = "";
      return;
    }
    if (!options.itemFilterGroups.value.some((group) => group.id === activeItemFilterGroupId.value)) {
      activeItemFilterGroupId.value = options.itemFilterGroups.value[0].id;
    }
  }

  function initializeItemFilterSeenItems(items: ItemTimelineEntry[]): void {
    itemFilterSeenTimelineKeys.clear();
    for (const item of items) itemFilterSeenTimelineKeys.add(itemTimelineKey(item));
  }

  function processItemFilterTimeline(items: ItemTimelineEntry[]): void {
    const nextItems = items.filter((item) => !itemFilterSeenTimelineKeys.has(itemTimelineKey(item))).reverse();
    for (const item of nextItems) {
      itemFilterSeenTimelineKeys.add(itemTimelineKey(item));
      if (!canProcessItemFilterTimelineItem(item)) continue;
      const match = matchItemFilter(item, activeItemFilterGroups.value);
      if (match) handleItemFilterMatch(match);
    }
  }

  function handleItemFilterMatch(match: ItemFilterRuleMatch): void {
    const nowMs = Date.now();
    const itemLabel = match.item.label || `Type ${match.item.type} #${match.item.id}`;
    lastItemFilterMatch.value = {
      itemLabel,
      groupName: match.group.name,
      soundName: soundName(match.soundId, itemFilterSoundOptionsList.value),
      createdAt: nowMs,
    };
    updateItemFilterMatchTotal(match, itemLabel, nowMs);
    if (options.itemFilterMuted.value) return;
    const lastPlayedAt = itemFilterLastPlayedAt.get(match.group.id) ?? 0;
    if (nowMs - lastPlayedAt < match.group.cooldownMs) return;
    itemFilterLastPlayedAt.set(match.group.id, nowMs);
    void playItemFilterSound(match.soundId, match.group.volume, options.customItemFilterSounds.value).catch(() => {
      // Audio feedback should never interfere with capture or rendering.
    });
  }

  function updateItemFilterMatchTotal(match: ItemFilterRuleMatch, itemLabel: string, nowMs: number): void {
    const id = `${match.group.id}:${normalizeLookupText(itemLabel)}`;
    const existing = itemFilterMatchTotals.value.find((total) => total.id === id);
    const nextTotal: ItemFilterMatchTotal = {
      id,
      itemLabel,
      groupName: match.group.name,
      count: (existing?.count ?? 0) + itemFilterMatchAmount(match.item),
      lastMatchedAt: nowMs,
    };
    itemFilterMatchTotals.value = [nextTotal, ...itemFilterMatchTotals.value.filter((total) => total.id !== id)]
      .sort((a, b) => b.count - a.count || b.lastMatchedAt - a.lastMatchedAt || a.itemLabel.localeCompare(b.itemLabel))
      .slice(0, 60);
  }

  function resetItemFilterSession(items: ItemTimelineEntry[] = []): void {
    lastItemFilterMatch.value = null;
    itemFilterMatchTotals.value = [];
    initializeItemFilterSeenItems(items);
    itemFilterLastPlayedAt.clear();
  }

  async function testItemFilterSound(
    soundId = selectedItemFilterGroup.value?.soundId ?? ITEM_FILTER_SOUNDS[0].id,
    volume = selectedItemFilterGroup.value?.volume ?? 70,
  ): Promise<void> {
    try {
      await playItemFilterSound(soundId, volume, options.customItemFilterSounds.value);
    } catch (error) {
      // Some systems block audio until the next direct user gesture.
      console.warn("Item filter sound did not play", error);
    }
  }

  async function importItemFilterSounds(): Promise<void> {
    try {
      const selected = await window.heroSiegeCompanion.importSounds();
      if (!selected.length) return;
      const existingNames = new Set(options.customItemFilterSounds.value.map((sound) => sound.fileName.toLowerCase()));
      const nextSounds: CustomItemFilterSound[] = [];
      selected.forEach((sound, index) => {
        if (!sound.fileName || !sound.src.startsWith("file://")) return;
        if (existingNames.has(sound.fileName.toLowerCase())) return;
        existingNames.add(sound.fileName.toLowerCase());
        nextSounds.push({
          id: createCustomSoundId(sound.fileName, index),
          name: customSoundDisplayName(sound.fileName),
          fileName: sound.fileName,
          src: sound.src,
        });
      });
      options.customItemFilterSounds.value = normalizeCustomItemFilterSounds([...options.customItemFilterSounds.value, ...nextSounds]);
      options.showToast(nextSounds.length ? `${nextSounds.length} custom sound${nextSounds.length === 1 ? "" : "s"} imported` : "No new sounds imported");
    } catch {
      options.showToast("Sound import failed");
    }
  }

  async function exportItemFilterSoundPack(): Promise<void> {
    try {
      const result = await window.heroSiegeCompanion.exportSoundPack(options.customItemFilterSounds.value);
      if (result.exported) {
        options.showToast(`Soundpack exported with ${result.includedFiles.length} sound${result.includedFiles.length === 1 ? "" : "s"}`);
      } else if (!result.canceled) {
        options.showToast("No custom sounds to export");
      }
    } catch {
      options.showToast("Soundpack export failed");
    }
  }

  async function removeItemFilterSound(sound: CustomItemFilterSound): Promise<void> {
    const nextSounds = options.customItemFilterSounds.value.filter((candidate) => candidate.id !== sound.id);
    options.customItemFilterSounds.value = nextSounds;
    options.itemFilterGroups.value = normalizeItemFilterGroups(options.itemFilterGroups.value, nextSounds);
    if (sound.src.startsWith("file://")) {
      void window.heroSiegeCompanion.removeSound(sound.src);
    }
    options.showToast(`${sound.name} removed`);
  }

  return {
    itemFilterDraftItem,
    itemFilterDraftGroupName,
    lastItemFilterMatch,
    itemFilterMatchTotals,
    activeItemFilterGroups,
    watchedItemCount,
    itemFilterSoundOptionsList,
    selectedItemFilterGroup,
    selectedItemFilterGroupedItems,
    itemFilterSuggestions,
    addItemFilterGroup,
    removeItemFilterGroup,
    restoreMissingItemFilterGroup,
    selectItemFilterGroup,
    addItemToFilterGroup,
    removeItemFromFilterGroup,
    clampActiveItemFilterGroup,
    initializeItemFilterSeenItems,
    resetItemFilterSession,
    processItemFilterTimeline,
    testItemFilterSound,
    importItemFilterSounds,
    exportItemFilterSoundPack,
    removeItemFilterSound,
  };
}

export function canProcessItemFilterTimelineItem(item: ItemTimelineEntry): boolean {
  return item.source === "server" || INVENTORY_SOURCE_ITEM_FILTER_TYPES.has(item.type);
}

function itemFilterMatchAmount(item: ItemTimelineEntry): number {
  return Number.isFinite(item.amount) ? Math.max(Math.trunc(item.amount), 1) : 1;
}
