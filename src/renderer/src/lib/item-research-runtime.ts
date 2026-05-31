import { computed, type Ref } from "vue";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { playItemFilterSound } from "./item-filter-sounds";
import { itemTimelineKey } from "./item-filters";
import {
  activeItemResearchEntries,
  classifyItemResearchFields,
  isItemResearchCandidate,
  itemResearchSignature,
  normalizeItemResearchEntries,
  updateItemResearchEntry,
  upsertItemResearchEntry,
  type ItemResearchEntry,
} from "./item-research";

export interface ItemResearchRuntimeOptions {
  itemResearchEntries: Ref<ItemResearchEntry[]>;
  developerItemResearchEnabled: Ref<boolean>;
  unknownItemAudioPrompt: Ref<boolean>;
  showToast: (message: string) => void;
  openItemFilterTab: () => void;
}

export function useItemResearchRuntime(options: ItemResearchRuntimeOptions) {
  const itemResearchSeenTimelineKeys = new Set<string>();
  let lastUnknownItemPromptAt = 0;
  const unresolvedItemResearchEntries = computed(() => activeItemResearchEntries(options.itemResearchEntries.value));

  function initializeItemResearchSeenItems(items: ItemTimelineEntry[]): void {
    itemResearchSeenTimelineKeys.clear();
    for (const item of items) itemResearchSeenTimelineKeys.add(itemTimelineKey(item));
  }

  function processItemResearchTimeline(items: ItemTimelineEntry[]): void {
    const nextItems = items.filter((item) => !itemResearchSeenTimelineKeys.has(itemTimelineKey(item))).reverse();
    for (const item of nextItems) {
      itemResearchSeenTimelineKeys.add(itemTimelineKey(item));
      if (!options.developerItemResearchEnabled.value || !isItemResearchCandidate(item)) continue;
      options.itemResearchEntries.value = upsertItemResearchEntry(options.itemResearchEntries.value, item);
      if (classifyItemResearchFields(item) !== "known-missing-icon") maybePromptUnknownItem();
    }
  }

  function maybePromptUnknownItem(): void {
    if (!options.unknownItemAudioPrompt.value) return;
    const nowMs = Date.now();
    if (nowMs - lastUnknownItemPromptAt < 5000) return;
    lastUnknownItemPromptAt = nowMs;
    void playItemFilterSound("low-pulse", 45).catch(() => {
      // Item research audio is optional and should never affect capture.
    });
  }

  function saveItemResearchEntry(signature: string, value: { resolvedName: string; notes: string }): void {
    options.itemResearchEntries.value = updateItemResearchEntry(options.itemResearchEntries.value, signature, value);
  }

  function ignoreItemResearchEntry(signature: string): void {
    options.itemResearchEntries.value = updateItemResearchEntry(options.itemResearchEntries.value, signature, { ignored: true });
  }

  function resetItemResearchEntry(signature: string): void {
    options.itemResearchEntries.value = updateItemResearchEntry(options.itemResearchEntries.value, signature, {
      resolvedName: "",
      notes: "",
      ignored: false,
    });
  }

  function clearResolvedItemResearchEntries(): void {
    options.itemResearchEntries.value = normalizeItemResearchEntries(options.itemResearchEntries.value.filter((entry) => !entry.resolvedName.trim()));
  }

  function clearIgnoredItemResearchEntries(): void {
    options.itemResearchEntries.value = normalizeItemResearchEntries(options.itemResearchEntries.value.filter((entry) => !entry.ignored));
  }

  function identifyTimelineItem(item: ItemTimelineEntry): void {
    if (!options.developerItemResearchEnabled.value || !isItemResearchCandidate(item)) return;
    const signature = itemResearchSignature(item);
    if (!options.itemResearchEntries.value.some((entry) => entry.signature === signature)) {
      options.itemResearchEntries.value = upsertItemResearchEntry(options.itemResearchEntries.value, item);
    }
    options.openItemFilterTab();
    options.showToast(`${item.label || "Unknown item"} added to Item Research`);
  }

  return {
    unresolvedItemResearchEntries,
    initializeItemResearchSeenItems,
    processItemResearchTimeline,
    saveItemResearchEntry,
    ignoreItemResearchEntry,
    resetItemResearchEntry,
    clearResolvedItemResearchEntries,
    clearIgnoredItemResearchEntries,
    identifyTimelineItem,
  };
}
