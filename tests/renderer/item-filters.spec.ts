import { describe, expect, test, vi } from "vitest";

import {
  createItemFilterGroup,
  createCustomSoundId,
  customSoundDisplayName,
  itemFilterSoundOptions,
  itemFilterGroupedItems,
  itemTimelineKey,
  matchItemFilter,
  normalizeItemFilterGroups,
  normalizeCustomItemFilterSounds,
  normalizeSpecificItems,
  soundName,
} from "../../src/renderer/src/lib/item-filters";
import { itemFilterGroup, itemTimelineEntry } from "./fixtures";

describe("renderer item filter rules", () => {
  test("normalizes persisted filter groups so stale preferences cannot break matching", () => {
    const [group] = normalizeItemFilterGroups([
      {
        id: "persisted",
        name: "",
        enabled: undefined,
        soundId: "deleted-sound",
        volume: 999,
        cooldownMs: -50,
        rarities: ["Satanic", "Impossible"],
        types: ["12", "999"],
        items: ["sash of the magi", "Sash of the Magi", { name: "Copper Ore", soundId: "coin-ping" }],
      },
    ]);

    expect(group).toMatchObject({
      id: "persisted",
      name: "Untitled Group",
      enabled: true,
      soundId: "crystal-tink",
      volume: 100,
      cooldownMs: 0,
      rarities: ["Satanic"],
      types: [12],
    });
    expect(group.items.map((item) => item.name)).toEqual(["Sash of the Magi", "Copper Ore"]);
    expect(group.items.find((item) => item.name === "Copper Ore")?.soundId).toBe("coin-ping");
  });

  test("canonicalizes watched items, removes duplicates, and groups them for the editor", () => {
    const items = normalizeSpecificItems([
      "sash of the magi",
      "Sash of the Magi",
      { name: "copper ore", soundId: "deep-gong" },
      { name: "unknown trophy", soundId: "missing-sound" },
    ]);
    const group = itemFilterGroup({ items });

    expect(items).toEqual([
      { name: "Sash of the Magi", soundId: "", typeLabel: "Belt" },
      { name: "unknown trophy", soundId: "", typeLabel: "Item" },
      { name: "Copper Ore", soundId: "deep-gong", typeLabel: "Material" },
    ]);
    expect(itemFilterGroupedItems(group)).toEqual([
      { typeLabel: "Belt", items: [{ name: "Sash of the Magi", soundId: "", typeLabel: "Belt" }] },
      { typeLabel: "Item", items: [{ name: "unknown trophy", soundId: "", typeLabel: "Item" }] },
      { typeLabel: "Material", items: [{ name: "Copper Ore", soundId: "deep-gong", typeLabel: "Material" }] },
    ]);
  });

  test("specific watched items override broader rarity/type rules and can choose their own sound", () => {
    const group = itemFilterGroup({
      rarities: ["Angelic"],
      types: [],
      soundId: "crystal-tink",
      items: [{ name: "Sash of the Magi", soundId: "deep-gong", typeLabel: "Belt" }],
    });
    const match = matchItemFilter(itemTimelineEntry({ label: "Sash of the Magi", rarity: "Common", type: 6 }), [group]);

    expect(match).toMatchObject({ group, soundId: "deep-gong" });
  });

  test("rarity/type rules match only when a group has criteria", () => {
    const emptyGroup = itemFilterGroup({ rarities: [], types: [], items: [] });
    const typeGroup = itemFilterGroup({ rarities: ["Heroic"], types: [7], items: [], soundId: "bell-chime" });
    const item = itemTimelineEntry({ label: "Scourge Loop", rarity: "Heroic", type: 7 });

    expect(matchItemFilter(item, [emptyGroup])).toBeNull();
    expect(matchItemFilter(item, [typeGroup])).toMatchObject({ group: typeGroup, soundId: "bell-chime" });
  });

  test("new groups have stable defaults without inheriting stale editor state", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createItemFilterGroup("  Boss Drops  ", 2)).toEqual({
      id: "group-1234-8",
      name: "Boss Drops",
      enabled: true,
      soundId: "crystal-tink",
      volume: 70,
      cooldownMs: 1000,
      rarities: [],
      types: [],
      items: [],
    });
    expect(createItemFilterGroup("", 2).name).toBe("Group 3");
    expect(soundName("missing")).toBe("Crystal Tink");
  });

  test("custom sounds are normalized and can be used by filter groups", () => {
    vi.spyOn(Date, "now").mockReturnValue(999);
    const customSounds = normalizeCustomItemFilterSounds([
      { id: createCustomSoundId("Boss Drop.wav", 0), name: "Boss Drop", fileName: "Boss Drop.wav", src: "file:///sounds/boss.wav" },
      { id: "bad", name: "Bad", fileName: "bad.txt", src: "data:text/plain;base64,AAAA" },
    ]);
    const [group] = normalizeItemFilterGroups([{ id: "custom", name: "Custom", soundId: customSounds[0].id, items: [{ name: "Copper Ore", soundId: customSounds[0].id }] }], customSounds);
    const soundOptions = itemFilterSoundOptions(customSounds);

    expect(customSounds).toHaveLength(1);
    expect(group.soundId).toBe(customSounds[0].id);
    expect(group.items[0].soundId).toBe(customSounds[0].id);
    expect(soundName(customSounds[0].id, soundOptions)).toBe("Boss Drop");
    expect(customSoundDisplayName("Ding_123.ogg")).toBe("Ding 123");
  });

  test("timeline keys include timestamp, fingerprint, type, id, and label to avoid UI collisions", () => {
    expect(itemTimelineKey(itemTimelineEntry({ createdAt: 10, fingerprint: "abc", type: 7, id: 40, label: "Scourge Loop" }))).toBe(
      "10:abc:7:40:Scourge Loop",
    );
  });
});
