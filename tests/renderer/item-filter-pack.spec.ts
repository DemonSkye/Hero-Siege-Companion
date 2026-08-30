import { describe, expect, test, vi } from "vitest";
import { ref } from "vue";

import { useItemFilterRuntime } from "../../src/renderer/src/lib/item-filter-runtime";
import {
  createItemFilterPackPayload,
  mergeItemFilterPack,
  parseItemFilterPackPayload,
  type CustomItemFilterSound,
} from "../../src/renderer/src/lib/item-filters";
import { itemFilterGroup } from "./fixtures";

const usedSound: CustomItemFilterSound = {
  id: "custom-sound:used",
  name: "Used Alert",
  fileName: "used.wav",
  src: "file:///managed/used.wav",
};
const itemSound: CustomItemFilterSound = {
  id: "custom-sound:item",
  name: "Item Alert",
  fileName: "item.wav",
  src: "file:///managed/item.wav",
};
const unusedSound: CustomItemFilterSound = {
  id: "custom-sound:unused",
  name: "Unused Alert",
  fileName: "unused.wav",
  src: "file:///managed/unused.wav",
};

describe("item filter packs", () => {
  test("exports only custom sounds referenced by a group or exact item", () => {
    const payload = createItemFilterPackPayload([
      itemFilterGroup({
        soundId: usedSound.id,
        items: [{ name: "Sash of the Magi", soundId: itemSound.id, typeLabel: "Belt" }],
      }),
    ], [usedSound, itemSound, unusedSound], "2026-08-29T12:00:00.000Z");

    expect(payload).toMatchObject({
      app: "hero-siege-companion",
      kind: "item-filter-pack",
      schemaVersion: 1,
      exportedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(payload.uiPreferences.customItemFilterSounds.map((sound) => sound.id)).toEqual([
      usedSound.id,
      itemSound.id,
    ]);
  });

  test("parses a dedicated filter pack and reports missing custom sound references", () => {
    const payload = createItemFilterPackPayload([
      itemFilterGroup({ soundId: usedSound.id }),
    ], [usedSound]);
    payload.uiPreferences.itemFilterGroups[0].items.push({
      name: "Copper Ore",
      soundId: "custom-sound:missing",
      typeLabel: "Material",
    });
    payload.uiPreferences.customItemFilterSounds.push(unusedSound);

    const preview = parseItemFilterPackPayload(JSON.stringify(payload));

    expect(preview?.groups).toHaveLength(1);
    expect(preview?.sounds.map((sound) => sound.id)).toEqual([usedSound.id]);
    expect(preview?.unusedSounds.map((sound) => sound.id)).toEqual([unusedSound.id]);
    expect(preview?.missingCustomSoundIds).toEqual(["custom-sound:missing"]);
    expect(parseItemFilterPackPayload(JSON.stringify({ app: "hero-siege-companion", kind: "configuration", schemaVersion: 1 }))).toBeNull();
  });

  test("adds imported groups without replacing current filters and resolves id collisions", () => {
    const current = itemFilterGroup({ id: "loot-alerts", name: "Current Alerts" });
    const imported = itemFilterGroup({ id: "loot-alerts", name: "Shared Alerts", soundId: usedSound.id });
    const preview = parseItemFilterPackPayload(createItemFilterPackPayload([imported], [usedSound]));
    expect(preview).not.toBeNull();

    const merged = mergeItemFilterPack([current], [], preview!);

    expect(merged.groups).toHaveLength(2);
    expect(merged.groups[0].name).toBe("Current Alerts");
    expect(merged.groups[1]).toMatchObject({
      id: "loot-alerts-imported-2",
      name: "Shared Alerts (Imported)",
      soundId: usedSound.id,
    });
    expect(merged.sounds).toEqual([usedSound]);
    expect(merged.addedGroupCount).toBe(1);
    expect(merged.addedSoundCount).toBe(1);
  });

  test("remaps colliding custom sound ids so imported rules keep their reviewed audio", () => {
    const currentSound = { ...usedSound, src: "file:///managed/current-used.wav" };
    const importedSound = { ...usedSound, src: "file:///managed/imported-used.wav" };
    const imported = itemFilterGroup({
      id: "shared-alerts",
      name: "Shared Alerts",
      soundId: importedSound.id,
      items: [{ name: "Sash of the Magi", soundId: importedSound.id, typeLabel: "Belt" }],
    });
    const preview = parseItemFilterPackPayload(createItemFilterPackPayload([imported], [importedSound]));
    expect(preview).not.toBeNull();

    const merged = mergeItemFilterPack([], [currentSound], preview!);

    expect(merged.sounds).toEqual([
      currentSound,
      {
        ...importedSound,
        id: "custom-sound:used-imported-2",
        name: "Used Alert (Imported)",
      },
    ]);
    expect(merged.groups[0]).toMatchObject({
      soundId: "custom-sound:used-imported-2",
      items: [{ soundId: "custom-sound:used-imported-2" }],
    });
    expect(merged.addedSoundCount).toBe(1);
  });

  test("previews an imported pack without changing filter state when canceled", async () => {
    const payload = createItemFilterPackPayload([
      itemFilterGroup({ id: "shared-alerts", name: "Shared Alerts", soundId: usedSound.id }),
    ], [usedSound]);
    const importConfiguration = vi.fn().mockResolvedValue(JSON.stringify(payload));
    const installConfigurationSounds = vi.fn();
    Object.defineProperty(window, "heroSiegeCompanion", {
      configurable: true,
      value: { importConfiguration, installConfigurationSounds },
    });
    const groups = ref([itemFilterGroup()]);
    const sounds = ref<CustomItemFilterSound[]>([]);
    const runtime = useItemFilterRuntime({
      itemFilterGroups: groups,
      itemFilterMuted: ref(false),
      customItemFilterSounds: sounds,
      showToast: vi.fn(),
    });

    await runtime.prepareItemFilterPackImport();

    expect(importConfiguration).toHaveBeenCalledWith();
    expect(installConfigurationSounds).not.toHaveBeenCalled();
    expect(runtime.pendingItemFilterPackImport.value?.groups[0].name).toBe("Shared Alerts");
    expect(groups.value).toHaveLength(1);

    await runtime.discardPendingItemFilterPackImport();

    expect(runtime.pendingItemFilterPackImport.value).toBeNull();
    expect(groups.value).toHaveLength(1);
    expect(sounds.value).toEqual([]);
    expect(installConfigurationSounds).not.toHaveBeenCalled();
  });

  test("installs only reviewed referenced sounds before applying and exporting a pack", async () => {
    const importedSound = { ...usedSound, src: "file:///managed/imported-used.wav" };
    const payload = createItemFilterPackPayload([
      itemFilterGroup({ id: "shared-alerts", name: "Shared Alerts", soundId: importedSound.id }),
    ], [importedSound]);
    payload.uiPreferences.customItemFilterSounds.push({
      ...unusedSound,
      src: "data:audio/wav;base64,VU5VU0VE",
    });
    const importConfiguration = vi.fn().mockResolvedValue(JSON.stringify(payload));
    const installConfigurationSounds = vi.fn().mockImplementation(async (source: string) => source);
    const exportConfiguration = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, "heroSiegeCompanion", {
      configurable: true,
      value: {
        importConfiguration,
        installConfigurationSounds,
        exportConfiguration,
        removeSound: vi.fn().mockResolvedValue(true),
      },
    });
    const groups = ref([itemFilterGroup()]);
    const sounds = ref<CustomItemFilterSound[]>([]);
    const showToast = vi.fn();
    const runtime = useItemFilterRuntime({
      itemFilterGroups: groups,
      itemFilterMuted: ref(false),
      customItemFilterSounds: sounds,
      showToast,
    });

    await runtime.prepareItemFilterPackImport();
    await runtime.confirmItemFilterPackImport();
    await runtime.exportItemFilterPack();

    expect(groups.value.map((group) => group.name)).toEqual(["Loot Alerts", "Shared Alerts"]);
    expect(sounds.value).toEqual([importedSound]);
    expect(runtime.pendingItemFilterPackImport.value).toBeNull();
    expect(installConfigurationSounds).toHaveBeenCalledTimes(1);
    const approvedInstallPayload = JSON.parse(installConfigurationSounds.mock.calls[0][0]);
    expect(approvedInstallPayload.uiPreferences.customItemFilterSounds.map((sound: CustomItemFilterSound) => sound.id)).toEqual([
      importedSound.id,
    ]);
    expect(exportConfiguration).toHaveBeenCalledTimes(1);
    const [json, options] = exportConfiguration.mock.calls[0];
    expect(JSON.parse(json)).toMatchObject({ kind: "item-filter-pack", schemaVersion: 1 });
    expect(options).toEqual({
      title: "Export Hero Siege item filter pack",
      defaultPath: "hero-siege-item-filter-pack.json",
    });
    expect(showToast).toHaveBeenCalledWith("1 filter group added with 1 custom sound");
  });

  test("waits for managed sound deletion before removing state and clears every reference", async () => {
    let finishRemoval!: (removed: boolean) => void;
    const removeSound = vi.fn().mockReturnValue(new Promise<boolean>((resolve) => {
      finishRemoval = resolve;
    }));
    Object.defineProperty(window, "heroSiegeCompanion", {
      configurable: true,
      value: { removeSound },
    });
    const groups = ref([
      itemFilterGroup({
        id: "custom-default",
        soundId: usedSound.id,
        items: [
          { name: "Sash of the Magi", soundId: usedSound.id, typeLabel: "Belt" },
          { name: "Copper Ore", soundId: itemSound.id, typeLabel: "Material" },
        ],
      }),
      itemFilterGroup({ id: "other", soundId: itemSound.id }),
    ]);
    const sounds = ref<CustomItemFilterSound[]>([usedSound, itemSound]);
    const showToast = vi.fn();
    const runtime = useItemFilterRuntime({
      itemFilterGroups: groups,
      itemFilterMuted: ref(false),
      customItemFilterSounds: sounds,
      showToast,
    });

    const removal = runtime.removeItemFilterSound(usedSound);
    await Promise.resolve();

    expect(removeSound).toHaveBeenCalledWith(usedSound.src);
    expect(sounds.value).toEqual([usedSound, itemSound]);
    expect(groups.value[0].soundId).toBe(usedSound.id);

    finishRemoval(true);
    await removal;

    expect(sounds.value).toEqual([itemSound]);
    expect(groups.value[0].soundId).toBe("crystal-tink");
    expect(groups.value[0].items).toEqual([
      { name: "Sash of the Magi", soundId: "", typeLabel: "Belt" },
      { name: "Copper Ore", soundId: itemSound.id, typeLabel: "Material" },
    ]);
    expect(groups.value[1].soundId).toBe(itemSound.id);
    expect(JSON.stringify(groups.value)).not.toContain(usedSound.id);
    expect(showToast).toHaveBeenCalledWith("Used Alert removed");
  });

  test("keeps sound and filter state unchanged when managed deletion fails", async () => {
    const removeSound = vi.fn().mockResolvedValue(false);
    Object.defineProperty(window, "heroSiegeCompanion", {
      configurable: true,
      value: { removeSound },
    });
    const originalGroups = [itemFilterGroup({ soundId: usedSound.id })];
    const originalSounds = [usedSound];
    const groups = ref(originalGroups);
    const sounds = ref<CustomItemFilterSound[]>(originalSounds);
    const groupsBeforeRemoval = groups.value;
    const soundsBeforeRemoval = sounds.value;
    const showToast = vi.fn();
    const runtime = useItemFilterRuntime({
      itemFilterGroups: groups,
      itemFilterMuted: ref(false),
      customItemFilterSounds: sounds,
      showToast,
    });

    await runtime.removeItemFilterSound(usedSound);

    expect(groups.value).toBe(groupsBeforeRemoval);
    expect(sounds.value).toBe(soundsBeforeRemoval);
    expect(groups.value[0].soundId).toBe(usedSound.id);
    expect(showToast).toHaveBeenCalledWith("Used Alert could not be removed");
  });
});
