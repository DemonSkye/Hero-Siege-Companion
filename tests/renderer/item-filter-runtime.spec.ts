import { afterEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

import { compactFilterGroupRecoveryOptions } from "../../src/renderer/src/lib/compact-tiles";
import { canProcessItemFilterTimelineItem, useItemFilterRuntime } from "../../src/renderer/src/lib/item-filter-runtime";
import { baseTime, itemFilterGroup, itemTimelineEntry } from "./fixtures";

describe("renderer item filter runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("allows inventory-sourced stack/resource drops through the source guard", () => {
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "server", type: 3 }))).toBe(true);
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "inventory", type: 11 }))).toBe(true);
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "inventory", type: 12 }))).toBe(true);
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "inventory", type: 13 }))).toBe(true);
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "inventory", type: 14 }))).toBe(true);
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "inventory", type: 15 }))).toBe(true);
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "inventory", type: 18 }))).toBe(true);
    expect(canProcessItemFilterTimelineItem(itemTimelineEntry({ source: "inventory", type: 3 }))).toBe(false);
  });

  test("matches watched inventory collectibles without reopening equipment inventory alerts", () => {
    const runtime = useItemFilterRuntime({
      itemFilterGroups: ref([
        itemFilterGroup({
          name: "Valuables",
          rarities: [],
          types: [],
          soundId: "deep-gong",
          items: [{ name: "Infernal Colosseum Fragment", soundId: "", typeLabel: "Collectible" }],
        }),
        itemFilterGroup({
          id: "gear-alerts",
          name: "Gear Alerts",
          rarities: [],
          types: [],
          items: [{ name: "Aurelion Fury", soundId: "", typeLabel: "Weapon" }],
        }),
      ]),
      itemFilterMuted: ref(true),
      customItemFilterSounds: ref([]),
      showToast: vi.fn(),
    });

    runtime.initializeItemFilterSeenItems([]);
    runtime.processItemFilterTimeline([
      itemTimelineEntry({
        source: "inventory",
        label: "Aurelion Fury",
        type: 3,
        id: 9,
        rarity: "Angelic",
        fingerprint: "inventory-gear",
      }),
      itemTimelineEntry({
        source: "inventory",
        label: "Infernal Colosseum Fragment",
        type: 13,
        id: 53,
        rarity: "Mythic",
        fingerprint: "inventory-fragment",
      }),
    ]);

    expect(runtime.itemFilterMatchHistory.value).toHaveLength(1);
    expect(runtime.itemFilterMatchHistory.value[0]).toMatchObject({
      item: expect.objectContaining({ label: "Infernal Colosseum Fragment" }),
      groupId: "loot-alerts",
      groupName: "Valuables",
      soundName: "Deep Gong",
    });
  });

  test("keeps recent filter matches until the filter session resets", () => {
    const runtime = useItemFilterRuntime({
      itemFilterGroups: ref([
        itemFilterGroup({
          items: [
            { name: "Sash of the Magi", soundId: "deep-gong", typeLabel: "Belt" },
            { name: "Copper Ore", soundId: "", typeLabel: "Material" },
          ],
          rarities: [],
          types: [],
        }),
      ]),
      itemFilterMuted: ref(true),
      customItemFilterSounds: ref([]),
      showToast: vi.fn(),
    });

    runtime.initializeItemFilterSeenItems([]);
    runtime.processItemFilterTimeline([
      itemTimelineEntry({ source: "inventory", label: "Copper Ore", type: 13, amount: 3, fingerprint: "copper-2", createdAt: 30 }),
      itemTimelineEntry({ source: "server", label: "Sash of the Magi", amount: 1, fingerprint: "sash-1", createdAt: 20 }),
      itemTimelineEntry({ source: "inventory", label: "Copper Ore", type: 13, amount: 2, fingerprint: "copper-1", createdAt: 10 }),
    ]);

    expect(runtime.itemFilterMatchHistory.value.map((entry) => entry.item.label)).toEqual(["Copper Ore", "Sash of the Magi", "Copper Ore"]);

    runtime.resetItemFilterSession([]);

    expect(runtime.itemFilterMatchHistory.value).toEqual([]);
  });

  test("rebuilds existing filter match history newest first with a 100 item cap", () => {
    const runtime = useItemFilterRuntime({
      itemFilterGroups: ref([itemFilterGroup()]),
      itemFilterMuted: ref(true),
      customItemFilterSounds: ref([]),
      showToast: vi.fn(),
    });
    const existingTimeline = Array.from({ length: 105 }, (_, index) =>
      itemTimelineEntry({
        source: "server",
        fingerprint: `existing-${index}`,
        createdAt: baseTime + 1000 - index,
      }),
    );

    runtime.initializeItemFilterSeenItems(existingTimeline);

    expect(runtime.itemFilterMatchHistory.value).toHaveLength(100);
    expect(runtime.itemFilterMatchHistory.value[0].item.fingerprint).toBe("existing-0");
    expect(runtime.itemFilterMatchHistory.value.at(-1)?.item.fingerprint).toBe("existing-99");
  });

  test("labels missing custom sounds with fallback copy for matched drops", () => {
    const runtime = useItemFilterRuntime({
      itemFilterGroups: ref([
        itemFilterGroup({
          soundId: "custom-sound:missing",
          items: [{ name: "Sash of the Magi", soundId: "", typeLabel: "Belt" }],
          rarities: [],
          types: [],
        }),
      ]),
      itemFilterMuted: ref(true),
      customItemFilterSounds: ref([]),
      showToast: vi.fn(),
    });

    runtime.initializeItemFilterSeenItems([]);
    runtime.processItemFilterTimeline([itemTimelineEntry({ source: "server", label: "Sash of the Magi", fingerprint: "missing-sound" })]);

    expect(runtime.itemFilterMatchHistory.value[0]).toMatchObject({
      item: expect.objectContaining({ label: "Sash of the Magi" }),
      groupName: "Loot Alerts",
      soundName: "Missing custom sound (Crystal Tink fallback)",
    });
  });

  test("recovers a deleted filter group from a compact tile reference", () => {
    const itemFilterGroups = ref([itemFilterGroup({ id: "loot-alerts" })]);
    const showToast = vi.fn();
    const runtime = useItemFilterRuntime({
      itemFilterGroups,
      itemFilterMuted: ref(true),
      customItemFilterSounds: ref([]),
      showToast,
    });

    const recoverable = compactFilterGroupRecoveryOptions(
      [
        { id: "merc-tile", kind: "custom", label: "Merc Items", source: "filterGroup", groupId: "merc-items" },
        { id: "merc-tile-2", kind: "custom", label: "Merc Items", source: "filterGroup", groupId: "merc-items" },
        { id: "loot-tile", kind: "custom", label: "Loot Alerts", source: "filterGroup", groupId: "loot-alerts" },
      ],
      itemFilterGroups.value,
    );

    expect(recoverable).toEqual([{ id: "merc-items", name: "Merc Items", tileCount: 2 }]);

    runtime.restoreMissingItemFilterGroup(recoverable[0].id, recoverable[0].name);

    expect(itemFilterGroups.value.at(-1)).toMatchObject({
      id: "merc-items",
      name: "Merc Items",
      enabled: true,
      soundId: "crystal-tink",
      volume: 70,
      cooldownMs: 1000,
      rarities: [],
      types: [],
      items: [],
    });
    expect(runtime.selectedItemFilterGroup.value?.id).toBe("merc-items");
    expect(showToast).toHaveBeenCalledWith("Merc Items restored");
  });
});
