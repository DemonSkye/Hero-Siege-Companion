import { computed, type Ref } from "vue";
import type { CompanionState } from "../../../shared/app-state";
import { MATERIAL_LIKE_TIMELINE_TYPES } from "../../../shared/constants";
import type { ItemDropCounter, ItemTimelineEntry } from "../../../shared/stats";
import {
  COMPACT_RUN_TILE_LIMIT,
  compactRunTileDisplay,
  type CompactRunTileConfig,
} from "./compact-tiles";
import { formatDuration, formatNumber } from "./format";
import {
  itemFilterIdFromTimelineValue,
  matchItemFilter,
  type ItemFilterGroup,
  type ItemFilterMatchHistoryEntry,
} from "./item-filters";
import {
  TRACKED_RARITY_ORDER,
  resourceRecordTotal,
  sortedDropBreakdown,
} from "./past-runs";

interface UseSessionDisplayOptions {
  state: Ref<CompanionState>;
  now: Ref<number>;
  compactRunTiles: Ref<CompactRunTileConfig[]>;
  itemFilterGroups: Ref<ItemFilterGroup[]>;
  itemFilterMatchHistory: Ref<ItemFilterMatchHistoryEntry[]>;
  logLimit: Ref<number>;
  timelineLimit: Ref<number>;
  timelineType: Ref<string>;
  hideUnfilteredTimelineItems: Ref<boolean>;
  hideKeys: Ref<boolean>;
  hideMaterials: Ref<boolean>;
  hideSocketables: Ref<boolean>;
}

export function useSessionDisplay({
  state,
  now,
  compactRunTiles,
  itemFilterGroups,
  itemFilterMatchHistory,
  logLimit,
  timelineLimit,
  timelineType,
  hideUnfilteredTimelineItems,
  hideKeys,
  hideMaterials,
  hideSocketables,
}: UseSessionDisplayOptions) {
  const captureStatusLabel = computed(() => {
    if (state.value.captureStatus === "running") return "Capturing";
    if (state.value.captureStatus === "waiting") return "Waiting for Hero Siege";
    if (state.value.captureStatus === "error") return "Needs attention";
    return "Idle";
  });

  const runElapsedMs = computed(() => {
    const pausedNowMs =
      state.value.runStatus === "paused" && state.value.runPausedAt
        ? Math.max(now.value - state.value.runPausedAt, 0)
        : 0;
    return Math.max(now.value - state.value.stats.sessionStartedAt - state.value.runPausedDurationMs - pausedNowMs, 0);
  });
  const sessionDuration = computed(() => formatDuration(runElapsedMs.value));
  const currentGoldLabel = computed(() => (state.value.stats.seasonMode ? formatNumber(state.value.stats.totalGold) : "pending"));
  const runPausedLabel = computed(() => (state.value.runPausedReason === "captureStopped" ? "Paused: capture stopped" : "Paused"));
  const canToggleRunPaused = computed(
    () => !(state.value.runStatus === "paused" && state.value.runPausedReason === "captureStopped" && !state.value.captureRunning),
  );
  const nextZoneAt = computed(() => {
    const date = new Date(now.value);
    const minutes = date.getMinutes();
    const nextMinute = minutes < 30 ? 30 : 60;
    const next = new Date(date);
    next.setMinutes(nextMinute, 0, 0);
    return next;
  });
  const zoneCountdown = computed(() => formatDuration(Math.max(nextZoneAt.value.getTime() - now.value, 0)));
  const zoneResetLabel = computed(() => nextZoneAt.value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  const compactClock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  const keyDropTotal = computed(() => resourceRecordTotal(state.value.stats.keys));
  const oreDropTotal = computed(() => resourceRecordTotal(state.value.stats.ores));
  const trackedItems = computed(() => {
    return TRACKED_RARITY_ORDER.map((rarity) => ({
      rarity,
      total: state.value.stats.items[rarity]?.total ?? 0,
      mf: state.value.stats.items[rarity]?.mf ?? 0,
      perHour: state.value.stats.itemsPerHour[rarity] ?? 0,
      drops: itemDropBreakdown(state.value, rarity),
    }));
  });
  const compactTrackedItems = computed(() =>
    trackedItems.value.filter((item) => item.total > 0 || ["Set", "Satanic", "Heroic", "Angelic"].includes(item.rarity)),
  );
  const selectedTimelineItemFilterGroup = computed(() => {
    const groupId = itemFilterIdFromTimelineValue(timelineType.value);
    return groupId ? itemFilterGroups.value.find((group) => group.id === groupId) ?? null : null;
  });
  const itemTimelineSourceCount = computed(() =>
    hideUnfilteredTimelineItems.value ? itemFilterMatchHistory.value.length : state.value.stats.itemTimeline.length,
  );
  const filteredItemTimeline = computed(() => {
    if (hideUnfilteredTimelineItems.value) {
      return itemFilterMatchHistory.value
        .filter((entry) => itemPassesTimelineFilters(entry.item, entry.groupId))
        .map((entry) => entry.item);
    }

    return state.value.stats.itemTimeline.filter((item) => itemPassesTimelineFilters(item));
  });
  const visibleItemTimeline = computed(() => filteredItemTimeline.value.slice(0, timelineLimit.value));
  const recentLogs = computed(() => state.value.logs.slice(0, logLimit.value));
  const pastRuns = computed(() => state.value.pastRuns ?? []);
  const compactRunTileDisplays = computed(() =>
    compactRunTiles.value
      .map((tile) =>
        compactRunTileDisplay(tile, {
          stats: state.value.stats,
          runStatus: state.value.runStatus,
          sessionDuration: sessionDuration.value,
          runPausedLabel: runPausedLabel.value,
          currentGoldLabel: currentGoldLabel.value,
          zoneCountdown: zoneCountdown.value,
          zoneResetLabel: zoneResetLabel.value,
          itemFilterGroups: itemFilterGroups.value,
        }),
      )
      .slice(0, COMPACT_RUN_TILE_LIMIT),
  );

  return {
    captureStatusLabel,
    runElapsedMs,
    sessionDuration,
    currentGoldLabel,
    compactRunTileDisplays,
    runPausedLabel,
    canToggleRunPaused,
    nextZoneAt,
    zoneCountdown,
    zoneResetLabel,
    compactClock,
    keyDropTotal,
    oreDropTotal,
    trackedItems,
    compactTrackedItems,
    filteredItemTimeline,
    itemTimelineSourceCount,
    visibleItemTimeline,
    recentLogs,
    pastRuns,
  };

  function itemPassesTimelineFilters(item: ItemTimelineEntry, matchedGroupId = ""): boolean {
    if (hideKeys.value && item.type === 12) return false;
    if (hideMaterials.value && MATERIAL_LIKE_TIMELINE_TYPES.has(item.type)) return false;
    if (hideSocketables.value && item.type === 15) return false;
    const selectedItemFilterGroupId = itemFilterIdFromTimelineValue(timelineType.value);
    if (selectedItemFilterGroupId) {
      if (hideUnfilteredTimelineItems.value) return matchedGroupId === selectedItemFilterGroupId;
      const group = selectedTimelineItemFilterGroup.value;
      return group ? Boolean(matchItemFilter(item, [group])) : true;
    }
    if (timelineType.value !== "all" && item.type !== Number(timelineType.value)) return false;
    return true;
  }
}

function itemDropBreakdown(state: CompanionState, rarity: string): ItemDropCounter[] {
  const breakdown = state.stats.itemBreakdown?.[rarity] ?? {};
  return sortedDropBreakdown(breakdown);
}
