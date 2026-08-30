import { ref } from "vue";
import { describe, expect, test } from "vitest";
import { standardTile } from "../../src/renderer/src/lib/compact-tiles";
import { itemFilterTimelineValue, itemTimelineKey } from "../../src/renderer/src/lib/item-filters";
import { useSessionDisplay } from "../../src/renderer/src/lib/session-display";
import { baseTime, companionState, itemFilterGroup, itemTimelineEntry } from "./fixtures";

describe("session display runtime", () => {
  test("projects capture, run tile, resource, and timeline state for the renderer", () => {
    const display = useSessionDisplay({
      state: ref(companionState()),
      now: ref(baseTime),
      compactRunTiles: ref([standardTile("duration"), standardTile("gold"), standardTile("keys"), standardTile("ores"), standardTile("materials")]),
      itemFilterGroups: ref([itemFilterGroup()]),
      itemFilterMatchHistory: ref([]),
      logLimit: ref(1),
      timelineType: ref("all"),
      hideUnfilteredTimelineItems: ref(false),
      hideKeys: ref(false),
      hideMaterials: ref(true),
      hideSocketables: ref(false),
    });

    expect(display.captureStatusLabel.value).toBe("Capturing");
    expect(display.compactRunTileDisplays.value[0]).toMatchObject({
      label: "This Run",
      value: "10:00",
      detail: "TestHero",
    });
    expect(display.compactRunTileDisplays.value.map((tile) => [tile.label, tile.value])).toContainEqual(["Keys", "2"]);
    expect(display.compactRunTileDisplays.value.map((tile) => [tile.label, tile.value])).toContainEqual(["Ore", "5"]);
    expect(display.compactRunTileDisplays.value.map((tile) => [tile.label, tile.value])).toContainEqual(["Materials", "3"]);
    expect(display.runScoreDisplays.value.map((tile) => tile.kind)).toEqual(["duration", "gold", "xp", "kills"]);
    expect(display.runScoreDisplays.value.map((tile) => tile.kind)).not.toContain("keys");
    expect(display.keyDropTotal.value).toBe(2);
    expect(display.oreDropTotal.value).toBe(5);
    expect(display.visibleItemTimeline.value.map((item) => item.label)).toEqual(["Sash of the Magi"]);
    expect(display.trackedItems.value.find((item) => item.rarity === "Satanic")?.drops).toEqual([
      { name: "Sash of the Magi", total: 2, mf: 1 },
    ]);
  });

  test("blocks manual pause toggles while capture-stopped pause is waiting for capture", () => {
    const display = useSessionDisplay({
      state: ref(companionState({ captureRunning: false, runStatus: "paused", runPausedReason: "captureStopped" })),
      now: ref(baseTime),
      compactRunTiles: ref([]),
      itemFilterGroups: ref([]),
      itemFilterMatchHistory: ref([]),
      logLimit: ref(10),
      timelineType: ref("all"),
      hideUnfilteredTimelineItems: ref(false),
      hideKeys: ref(false),
      hideMaterials: ref(false),
      hideSocketables: ref(false),
    });

    expect(display.runPausedLabel.value).toBe("Paused: capture stopped");
    expect(display.canToggleRunPaused.value).toBe(false);
  });

  test("filters the item timeline by a configured item filter group", () => {
    const group = itemFilterGroup();
    const display = useSessionDisplay({
      state: ref(companionState()),
      now: ref(baseTime),
      compactRunTiles: ref([]),
      itemFilterGroups: ref([group]),
      itemFilterMatchHistory: ref([]),
      logLimit: ref(10),
      timelineType: ref(itemFilterTimelineValue(group)),
      hideUnfilteredTimelineItems: ref(false),
      hideKeys: ref(false),
      hideMaterials: ref(false),
      hideSocketables: ref(false),
    });

    expect(display.visibleItemTimeline.value.map((item) => item.label)).toEqual(["Sash of the Magi"]);
  });

  test("keeps filter-matched timeline rows available when unfiltered drops are hidden", () => {
    const group = itemFilterGroup();
    const matchedItem = itemTimelineEntry({
      label: "Aurelion Fury",
      rarity: "Angelic",
      type: 3,
      id: 9,
      fingerprint: "old-match",
      createdAt: baseTime - 120_000,
    });
    const display = useSessionDisplay({
      state: ref(companionState()),
      now: ref(baseTime),
      compactRunTiles: ref([]),
      itemFilterGroups: ref([group]),
      itemFilterMatchHistory: ref([
        {
          id: itemTimelineKey(matchedItem),
          item: matchedItem,
          groupId: group.id,
          groupName: group.name,
          soundName: "Deep Gong",
          matchedAt: matchedItem.createdAt,
        },
      ]),
      logLimit: ref(10),
      timelineType: ref("all"),
      hideUnfilteredTimelineItems: ref(true),
      hideKeys: ref(false),
      hideMaterials: ref(false),
      hideSocketables: ref(false),
    });

    expect(display.itemTimelineSourceCount.value).toBe(1);
    expect(display.visibleItemTimeline.value.map((item) => item.label)).toEqual(["Aurelion Fury"]);
  });

  test("shows the bounded session timeline newest-first", () => {
    const state = companionState();
    state.stats.itemTimeline = [
      itemTimelineEntry({ label: "Oldest", fingerprint: "oldest", createdAt: baseTime - 2_000 }),
      itemTimelineEntry({ label: "Newest", fingerprint: "newest", createdAt: baseTime }),
      itemTimelineEntry({ label: "Middle", fingerprint: "middle", createdAt: baseTime - 1_000 }),
    ];
    const display = useSessionDisplay({
      state: ref(state),
      now: ref(baseTime),
      compactRunTiles: ref([]),
      itemFilterGroups: ref([]),
      itemFilterMatchHistory: ref([]),
      logLimit: ref(10),
      timelineType: ref("all"),
      hideUnfilteredTimelineItems: ref(false),
      hideKeys: ref(false),
      hideMaterials: ref(false),
      hideSocketables: ref(false),
    });

    expect(display.visibleItemTimeline.value.map((item) => item.label)).toEqual(["Newest", "Middle", "Oldest"]);
  });
});
