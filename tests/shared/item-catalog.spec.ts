import { describe, expect, test } from "vitest";

import { ITEM_TYPE_NAMES } from "../../src/shared/constants";
import {
  allItemTranslations,
  allResolvableItemTranslations,
  lookupItemTranslation,
  lookupItemTranslationByName,
  lookupSharedItemTranslationByName,
} from "../../src/shared/item-lookup";
import {
  GENERATED_NORMAL_ITEM_BASE_RANGES,
  NORMAL_ITEM_NAME_PROVENANCE,
  isGeneratedNormalItemIdentity,
  lookupGeneratedNormalItemBase,
} from "../../src/shared/normal-item-name";
import { allStackItemTranslations, lookupStackItemTranslation } from "../../src/shared/stack-item-lookup";

describe("item catalog identity", () => {
  test("uses repository, type, ordinal, and weapon subtype as the resolvable identity", () => {
    const rows = allResolvableItemTranslations();
    const keys = rows.map((item) => `${item.repository}:${item.type}:${item.gameId}:${item.weaponType}`);
    const localizationKeys = rows.map((item) => `${item.repository}:${item.localizationId}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(localizationKeys).size).toBe(localizationKeys.length);
    for (const item of rows) {
      expect(lookupItemTranslation(item.type, item.gameId, item.weaponType, item.repository)).toEqual(item);
    }
  });

  test("keeps normal equipment out of the unique catalog unless capture evidence promoted it", () => {
    expect(lookupItemTranslation(4, 50, 0, "normal")?.name).toBe("Ali's Boxing Gloves");
    expect(lookupItemTranslation(4, 61, 0, "normal")?.name).toBe("Shade of Sand");
    expect(lookupItemTranslation(1, 17, 0, "normal")?.name).toBe("Pirate Captain's Shirt");
    expect(lookupItemTranslation(6, 17, 0, "normal")).toBeNull();
    expect(lookupItemTranslation(6, 17, 0, "unique")?.name).toBe("Vagabond's Ward");
  });

  test("requires repository scope when one name exists in multiple repositories", () => {
    expect(lookupItemTranslationByName("Ali's Boxing Gloves", "normal")?.repository).toBe("normal");
    expect(lookupItemTranslationByName("Ali's Boxing Gloves", "unique")?.repository).toBe("unique");
    expect(lookupItemTranslationByName("Ali's Boxing Gloves")).toBeNull();
    expect(lookupSharedItemTranslationByName("Ali's Boxing Gloves")).toEqual(expect.objectContaining({
      type: 4,
      gameId: 50,
      weaponType: 0,
      localizationId: "gloves_alis_boxing_gloves",
    }));
  });

  test("requires an exact weapon subtype and fails ambiguous source rows safely", () => {
    expect(lookupItemTranslation(3, 0, 13, "unique")?.name).toBe("Buriza-ko-nu");
    expect(lookupItemTranslation(3, 0, 7, "unique")?.name).toBe("Sawgun");
    expect(lookupItemTranslation(3, 35, 1, "unique")?.name).toBe("Stofflix Cooking Cleaver");
    expect(lookupItemTranslation(3, 35, 7, "unique")).toBeNull();
    expect(lookupItemTranslation(0, 2, 0, "unique")).toBeNull();
    expect(lookupItemTranslation(3, 4, 1, "unique")).toBeNull();
  });

  test("lets an evidence-backed override win without inventing the displaced ring", () => {
    expect(lookupItemTranslation(7, 48, 0, "unique")?.name).toBe("Scourge Loop");
    expect(lookupItemTranslation(7, 47, 0, "unique")).toBeNull();
    expect(lookupItemTranslationByName("Scourge Loop", "unique")?.gameId).toBe(48);
    expect(lookupItemTranslationByName("Dragon's Blessing")?.name).toBe("Dragon's Blessing");
  });

  test("marks stack rows as normal-repository identities and round-trips them", () => {
    const rows = allStackItemTranslations();
    const keys = rows.map((item) => `${item.repository}:${item.type}:${item.gameId}:${item.weaponType}`);
    expect(rows.every((item) => item.repository === "normal")).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of rows) expect(lookupStackItemTranslation(item.type, item.gameId)).toEqual(item);
  });

  test("keeps every catalog row repository-tagged and labels binary-proven item types", () => {
    expect(allItemTranslations().every((item) => ["normal", "unique", "runeword"].includes(item.repository))).toBe(true);
    expect([ITEM_TYPE_NAMES[16], ITEM_TYPE_NAMES[17], ITEM_TYPE_NAMES[18], ITEM_TYPE_NAMES[19]])
      .toEqual(["Relic", "Glyph", "Flask", "Vault"]);
  });

  test("keeps the extracted normal charm bases separate from fixed item identities", () => {
    expect(NORMAL_ITEM_NAME_PROVENANCE).toEqual({
      steamBuild: 24_868_792,
      executableSha256: "BA72B95AC10785D0ECDCC2B3D1925D6CB3439EFAF4CEF9DE2EA1F67D6CFDD4DF",
      definitionFunction: "gml_Script_DefineItemNormalCharms",
    });
    expect(GENERATED_NORMAL_ITEM_BASE_RANGES).toEqual([
      expect.objectContaining({ firstGameId: 0, lastGameId: 19, baseName: "Small Charm" }),
      expect.objectContaining({ firstGameId: 20, lastGameId: 39, baseName: "Large Charm" }),
      expect.objectContaining({ firstGameId: 40, lastGameId: 59, baseName: "Grand Charm" }),
    ]);

    const charmBases = Array.from({ length: 60 }, (_, gameId) => lookupGeneratedNormalItemBase(10, gameId));
    expect(charmBases.every(Boolean)).toBe(true);
    expect(charmBases.map((item) => item?.gameId)).toEqual(Array.from({ length: 60 }, (_, gameId) => gameId));
    expect(lookupGeneratedNormalItemBase(10, 33)).toEqual(expect.objectContaining({
      repository: "normal",
      baseLocalizationId: "charms_normal_large_charm",
      baseName: "Large Charm",
      nameMode: "seeded-affixes",
    }));
    expect(isGeneratedNormalItemIdentity("normal", 10, 33)).toBe(true);
    expect(isGeneratedNormalItemIdentity("unique", 10, 33)).toBe(false);
    expect(lookupGeneratedNormalItemBase(10, 60)).toBeNull();
    expect(lookupGeneratedNormalItemBase(4, 33)).toBeNull();
    expect(lookupItemTranslation(10, 33, 0, "unique")?.name).toBe("Bag of Unknown Riches");
    expect(lookupItemTranslation(10, 33, 0, "normal")).toBeNull();
  });
});
