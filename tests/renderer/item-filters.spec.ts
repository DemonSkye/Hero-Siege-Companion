import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

import { allItemIconFiles, lookupItemIconFile } from "../../src/shared/item-icons";
import {
  createItemFilterGroup,
  createCustomSoundId,
  customSoundDisplayName,
  itemFilterSoundOptions,
  itemFilterGroupedItems,
  itemFilterHasTimelineCriteria,
  itemFilterIdFromTimelineValue,
  itemFilterTimelineOptions,
  itemFilterTimelineValue,
  itemTimelineKey,
  matchItemFilter,
  normalizeItemFilterGroups,
  normalizeCustomItemFilterSounds,
  normalizeSpecificItems,
  resolveItemFilterSound,
  soundName,
} from "../../src/renderer/src/lib/item-filters";
import { itemFilterGroup, itemTimelineEntry } from "./fixtures";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

  test("canonicalizes user-entered diacritics the same way lookup and icons do", () => {
    const items = normalizeSpecificItems(["Bifrost Key", "Signet of Bifrost"]);
    const group = itemFilterGroup({ items: [{ name: "Bifrost Key", soundId: "deep-gong", typeLabel: "Key" }] });

    expect(items.map((item) => item.name)).toEqual(["Bifröst Key", "Signet of Bifröst"]);
    expect(lookupItemIconFile("Bifrost Key")).toBe(lookupItemIconFile("Bifröst Key"));
    expect(matchItemFilter(itemTimelineEntry({ label: "Bifröst Key", rarity: "Common", type: 12 }), [group])).toMatchObject({ group });
  });

  test("icon manifest entries point at files that exist in img/items", () => {
    const missingFiles = allItemIconFiles().filter((file) => !fs.existsSync(path.join(appRoot, "img", "items", file)));

    expect(missingFiles).toEqual([]);
    expect(lookupItemIconFile("Angel")).toBe("angel.png");
    expect(lookupItemIconFile("Abomination's Brain")).toBe("abomination-s-brain.png");
    expect(lookupItemIconFile("Solar Prophet's Crown")).toBe("solar-prophet-s-crown.png");
    expect(lookupItemIconFile("Solar Prophet's Robes")).toBe("solar-prophet-s-robes.png");
    expect(lookupItemIconFile("The Detonator")).toBe("the-detonator.png");
    expect(lookupItemIconFile("Valkyrie's Thunder Javelin")).toBe("valkyrie-s-thunder-javelin.png");
    expect(lookupItemIconFile("Gut's HFS")).toBe("gut-s-hfs.png");
    expect(lookupItemIconFile("St. Brooks Elementium Pistol")).toBe("st-brooks-elementium-pistol.png");
    expect(lookupItemIconFile("Commander's Sentry Blaster")).toBe("st-brooks-elementium-pistol.png");
    expect(lookupItemIconFile("Sarcasters Coffee Mug")).toBe("sarcasters-coffee-mug.png");
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

  test("selected non-gear inventory types can match despite misleading packet rarity", () => {
    const broadGroup = itemFilterGroup({
      rarities: ["Set", "Satanic", "Heroic", "Angelic", "Unholy", "Runeword"],
      types: [12, 13, 14, 15],
      items: [],
      soundId: "bell-chime",
    });
    const rarityOnlyGroup = itemFilterGroup({ rarities: ["Satanic"], types: [], items: [] });
    const gearGroup = itemFilterGroup({ rarities: ["Satanic"], types: [3], items: [] });
    const fragment = itemTimelineEntry({ source: "inventory", label: "Infernal Colosseum Fragment", rarity: "Mythic", type: 13, id: 53 });
    const weapon = itemTimelineEntry({ source: "inventory", label: "Aurelion Fury", rarity: "Mythic", type: 3, id: 9 });

    expect(matchItemFilter(fragment, [broadGroup])).toMatchObject({ group: broadGroup, soundId: "bell-chime" });
    expect(matchItemFilter(fragment, [rarityOnlyGroup])).toBeNull();
    expect(matchItemFilter(weapon, [gearGroup])).toBeNull();
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
    const [missingSoundGroup] = normalizeItemFilterGroups(
      [{ id: "missing-custom", name: "Missing", soundId: "custom-sound:missing", items: [{ name: "Copper Ore", soundId: "custom-sound:missing" }] }],
      customSounds,
    );
    const soundOptions = itemFilterSoundOptions(customSounds);

    expect(customSounds).toHaveLength(1);
    expect(group.soundId).toBe(customSounds[0].id);
    expect(group.items[0].soundId).toBe(customSounds[0].id);
    expect(missingSoundGroup.soundId).toBe("custom-sound:missing");
    expect(missingSoundGroup.items[0].soundId).toBe("custom-sound:missing");
    expect(resolveItemFilterSound("custom-sound:missing", soundOptions)).toMatchObject({
      effectiveSoundId: "crystal-tink",
      name: "Missing custom sound",
      fallbackName: "Crystal Tink",
      missingCustomSound: true,
    });
    expect(soundName("custom-sound:missing", soundOptions)).toBe("Missing custom sound");
    expect(soundName(customSounds[0].id, soundOptions)).toBe("Boss Drop");
    expect(customSoundDisplayName("Ding_123.ogg")).toBe("Ding 123");
  });

  test("timeline keys include timestamp, fingerprint, type, id, and label to avoid UI collisions", () => {
    expect(itemTimelineKey(itemTimelineEntry({ createdAt: 10, fingerprint: "abc", type: 7, id: 40, label: "Scourge Loop" }))).toBe(
      "10:abc:7:40:Scourge Loop",
    );
  });

  test("item filter groups expose stable timeline dropdown options", () => {
    const emptyGroup = itemFilterGroup({ id: "empty", items: [], rarities: [], types: [] });
    const disabledGroup = itemFilterGroup({ id: "boss", name: "Boss Drops", enabled: false, items: [], rarities: ["Heroic"], types: [] });

    expect(itemFilterHasTimelineCriteria(emptyGroup)).toBe(false);
    expect(itemFilterTimelineValue(disabledGroup)).toBe("item-filter:boss");
    expect(itemFilterIdFromTimelineValue("item-filter:boss")).toBe("boss");
    expect(itemFilterTimelineOptions([emptyGroup, disabledGroup])).toEqual([
      { value: "item-filter:boss", label: "Filter: Boss Drops (disabled)" },
    ]);
  });
});
