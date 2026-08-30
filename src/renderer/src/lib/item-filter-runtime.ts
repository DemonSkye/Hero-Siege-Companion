import { computed, ref, type Ref } from "vue";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { playItemFilterSound } from "./item-filter-sounds";
import {
  ITEM_FILTER_FALLBACK_SOUND_ID,
  ITEM_FILTER_SOUNDS,
  ITEM_FILTER_SUGGESTION_LIMIT,
  INVENTORY_SOURCE_ITEM_FILTER_TYPES,
  canonicalItemName,
  customSoundDisplayName,
  createCustomSoundId,
  createItemFilterGroup,
  createRecoveredItemFilterGroup,
  createItemFilterPackPayload,
  itemFilterGroupedItems,
  itemFilterSoundOptions,
  itemTimelineKey,
  itemTypeLabelForName,
  matchItemFilter,
  mergeItemFilterPack,
  normalizeCustomItemFilterSounds,
  normalizeItemFilterGroups,
  normalizeSpecificItems,
  parseItemFilterPackPayload,
  resolveItemFilterSound,
  type CustomItemFilterSound,
  type ItemFilterGroup,
  type ItemFilterPackImportPreview,
  type ItemFilterMatchHistoryEntry,
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
  const itemFilterMatchHistory = ref<ItemFilterMatchHistoryEntry[]>([]);
  const pendingItemFilterPackImport = ref<ItemFilterPackImportPreview | null>(null);
  const itemFilterPackImportBusy = ref(false);
  let pendingItemFilterPackSource = "";
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

  function updateItemFilterGroup(group: ItemFilterGroup): void {
    const [normalizedGroup] = normalizeItemFilterGroups([group], options.customItemFilterSounds.value);
    if (!normalizedGroup) return;
    options.itemFilterGroups.value = options.itemFilterGroups.value.map((candidate) =>
      candidate.id === normalizedGroup.id ? normalizedGroup : candidate,
    );
  }

  function addItemToFilterGroup(group: ItemFilterGroup, value = itemFilterDraftItem.value): void {
    const trimmed = value.trim();
    const canonical = canonicalItemName(trimmed);
    if (!canonical) return;
    const normalizedName = normalizeLookupText(canonical);
    if (group.items.some((item) => normalizeLookupText(item.name) === normalizedName)) return;
    updateItemFilterGroup({
      ...group,
      items: normalizeSpecificItems(
        [...group.items, { name: canonical, soundId: "", typeLabel: itemTypeLabelForName(canonical) }],
        options.customItemFilterSounds.value,
      ),
    });
    itemFilterDraftItem.value = "";
  }

  function removeItemFromFilterGroup(group: ItemFilterGroup, item: ItemFilterSpecificItem): void {
    const normalizedName = normalizeLookupText(item.name);
    updateItemFilterGroup({
      ...group,
      items: group.items.filter((candidate) => normalizeLookupText(candidate.name) !== normalizedName),
    });
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
    itemFilterMatchHistory.value = [];
    for (const item of [...items].reverse()) {
      itemFilterSeenTimelineKeys.add(itemTimelineKey(item));
      if (!canProcessItemFilterTimelineItem(item)) continue;
      const match = matchItemFilter(item, activeItemFilterGroups.value);
      if (match) {
        const soundResolution = resolveItemFilterSound(match.soundId, itemFilterSoundOptionsList.value);
        updateItemFilterMatchHistory(match, itemFilterMatchSoundLabel(soundResolution), item.createdAt || Date.now());
      }
    }
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
    const soundResolution = resolveItemFilterSound(match.soundId, itemFilterSoundOptionsList.value);
    updateItemFilterMatchHistory(match, itemFilterMatchSoundLabel(soundResolution), nowMs);
    if (options.itemFilterMuted.value) return;
    const lastPlayedAt = itemFilterLastPlayedAt.get(match.group.id) ?? 0;
    if (nowMs - lastPlayedAt < match.group.cooldownMs) return;
    itemFilterLastPlayedAt.set(match.group.id, nowMs);
    void playItemFilterSound(soundResolution.effectiveSoundId, match.group.volume, options.customItemFilterSounds.value).catch(() => {
      // Audio feedback should never interfere with capture or rendering.
    });
  }

  function updateItemFilterMatchHistory(match: ItemFilterRuleMatch, soundName: string, matchedAt: number): void {
    const id = itemTimelineKey(match.item);
    const nextMatch: ItemFilterMatchHistoryEntry = {
      id,
      item: match.item,
      groupId: match.group.id,
      groupName: match.group.name,
      soundName,
      matchedAt,
    };
    itemFilterMatchHistory.value = [nextMatch, ...itemFilterMatchHistory.value.filter((entry) => entry.id !== id)].slice(0, 100);
  }

  function resetItemFilterSession(items: ItemTimelineEntry[] = []): void {
    itemFilterMatchHistory.value = [];
    initializeItemFilterSeenItems(items);
    itemFilterLastPlayedAt.clear();
  }

  async function testItemFilterSound(
    soundId = selectedItemFilterGroup.value?.soundId ?? ITEM_FILTER_SOUNDS[0].id,
    volume = selectedItemFilterGroup.value?.volume ?? 70,
  ): Promise<void> {
    try {
      const soundResolution = resolveItemFilterSound(soundId, itemFilterSoundOptionsList.value);
      await playItemFilterSound(soundResolution.effectiveSoundId, volume, options.customItemFilterSounds.value);
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
    try {
      if (sound.src.startsWith("file://")) {
        const removed = await window.heroSiegeCompanion.removeSound(sound.src);
        if (!removed) throw new Error("Managed sound could not be removed.");
      }

      const nextSounds = options.customItemFilterSounds.value.filter((candidate) => candidate.id !== sound.id);
      const rewrittenGroups = options.itemFilterGroups.value.map((group) => ({
        ...group,
        soundId: group.soundId === sound.id ? ITEM_FILTER_FALLBACK_SOUND_ID : group.soundId,
        items: group.items.map((item) => item.soundId === sound.id ? { ...item, soundId: "" } : item),
      }));
      options.customItemFilterSounds.value = nextSounds;
      options.itemFilterGroups.value = normalizeItemFilterGroups(rewrittenGroups, nextSounds);
      options.showToast(`${sound.name} removed`);
    } catch {
      options.showToast(`${sound.name} could not be removed`);
    }
  }

  async function exportItemFilterPack(): Promise<void> {
    try {
      const payload = createItemFilterPackPayload(options.itemFilterGroups.value, options.customItemFilterSounds.value);
      const exported = await window.heroSiegeCompanion.exportConfiguration(JSON.stringify(payload, null, 2), {
        title: "Export Hero Siege item filter pack",
        defaultPath: "hero-siege-item-filter-pack.json",
      });
      if (exported) {
        const soundCount = payload.uiPreferences.customItemFilterSounds.length;
        options.showToast(`Filter pack exported with ${payload.uiPreferences.itemFilterGroups.length} group${payload.uiPreferences.itemFilterGroups.length === 1 ? "" : "s"} and ${soundCount} custom sound${soundCount === 1 ? "" : "s"}`);
      }
    } catch {
      options.showToast("Filter pack export failed");
    }
  }

  async function prepareItemFilterPackImport(): Promise<void> {
    if (itemFilterPackImportBusy.value) return;
    itemFilterPackImportBusy.value = true;
    try {
      if (pendingItemFilterPackImport.value) await discardPendingItemFilterPackImport();
      const contents = await window.heroSiegeCompanion.importConfiguration();
      if (!contents) return;
      const preview = parseItemFilterPackPayload(contents);
      if (!preview) {
        options.showToast("That file is not a valid item filter pack");
        return;
      }
      pendingItemFilterPackSource = contents;
      pendingItemFilterPackImport.value = preview;
    } catch {
      options.showToast("Filter pack import failed");
    } finally {
      itemFilterPackImportBusy.value = false;
    }
  }

  async function confirmItemFilterPackImport(): Promise<void> {
    const preview = pendingItemFilterPackImport.value;
    if (!preview || itemFilterPackImportBusy.value) return;
    itemFilterPackImportBusy.value = true;
    try {
      const approvedSource = JSON.stringify(createItemFilterPackPayload(preview.groups, preview.sounds), null, 2);
      const installedSource = pendingItemFilterPackSource
        ? await window.heroSiegeCompanion.installConfigurationSounds(approvedSource)
        : "";
      const installedPreview = installedSource ? parseItemFilterPackPayload(installedSource) : preview;
      if (!installedPreview) throw new Error("Installed filter pack could not be read.");
      const previousGroupCount = options.itemFilterGroups.value.length;
      const merged = mergeItemFilterPack(options.itemFilterGroups.value, options.customItemFilterSounds.value, installedPreview);
      options.customItemFilterSounds.value = merged.sounds;
      options.itemFilterGroups.value = merged.groups;
      pendingItemFilterPackImport.value = null;
      pendingItemFilterPackSource = "";
      const firstImportedGroup = merged.groups[previousGroupCount];
      if (firstImportedGroup) activeItemFilterGroupId.value = firstImportedGroup.id;
      options.showToast(`${merged.addedGroupCount} filter group${merged.addedGroupCount === 1 ? "" : "s"} added${merged.addedSoundCount ? ` with ${merged.addedSoundCount} custom sound${merged.addedSoundCount === 1 ? "" : "s"}` : ""}`);
    } catch {
      options.showToast("Filter pack import failed");
    } finally {
      itemFilterPackImportBusy.value = false;
    }
  }

  async function discardPendingItemFilterPackImport(): Promise<void> {
    pendingItemFilterPackImport.value = null;
    pendingItemFilterPackSource = "";
  }

  return {
    itemFilterDraftItem,
    itemFilterDraftGroupName,
    itemFilterMatchHistory,
    activeItemFilterGroups,
    watchedItemCount,
    itemFilterSoundOptionsList,
    selectedItemFilterGroup,
    selectedItemFilterGroupedItems,
    itemFilterSuggestions,
    pendingItemFilterPackImport,
    itemFilterPackImportBusy,
    addItemFilterGroup,
    removeItemFilterGroup,
    restoreMissingItemFilterGroup,
    selectItemFilterGroup,
    updateItemFilterGroup,
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
    exportItemFilterPack,
    prepareItemFilterPackImport,
    confirmItemFilterPackImport,
    discardPendingItemFilterPackImport,
  };
}

export function canProcessItemFilterTimelineItem(item: ItemTimelineEntry): boolean {
  return item.source === "server" || INVENTORY_SOURCE_ITEM_FILTER_TYPES.has(item.type);
}

function itemFilterMatchSoundLabel(soundResolution: { name: string; fallbackName: string; missingCustomSound: boolean }): string {
  return soundResolution.missingCustomSound ? `${soundResolution.name} (${soundResolution.fallbackName} fallback)` : soundResolution.name;
}
