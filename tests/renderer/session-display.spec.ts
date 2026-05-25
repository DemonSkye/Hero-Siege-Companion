import { ref } from "vue";
import { describe, expect, test } from "vitest";
import { standardTile } from "../../src/renderer/src/lib/compact-tiles";
import { itemFilterTimelineValue } from "../../src/renderer/src/lib/item-filters";
import { useSessionDisplay } from "../../src/renderer/src/lib/session-display";
import { baseTime, companionState, itemFilterGroup } from "./fixtures";

describe("session display runtime", () => {
  test("projects capture, run tile, resource, and timeline state for the renderer", () => {
    const display = useSessionDisplay({
      state: ref(companionState()),
      now: ref(baseTime),
      compactRunTiles: ref([standardTile("duration"), standardTile("gold")]),
      itemFilterGroups: ref([itemFilterGroup()]),
      logLimit: ref(1),
      timelineLimit: ref(5),
      timelineType: ref("all"),
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
      logLimit: ref(10),
      timelineLimit: ref(10),
      timelineType: ref("all"),
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
      logLimit: ref(10),
      timelineLimit: ref(10),
      timelineType: ref(itemFilterTimelineValue(group)),
      hideKeys: ref(false),
      hideMaterials: ref(false),
      hideSocketables: ref(false),
    });

    expect(display.visibleItemTimeline.value.map((item) => item.label)).toEqual(["Sash of the Magi"]);
  });
});
