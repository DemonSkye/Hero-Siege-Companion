import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import ItemFilterView from "../../src/renderer/src/components/ItemFilterView.vue";
import {
  ITEM_FILTER_SOUNDS,
  createItemFilterPackPayload,
  parseItemFilterPackPayload,
  type CustomItemFilterSound,
} from "../../src/renderer/src/lib/item-filters";
import { itemFilterGroup } from "./fixtures";

const customSound: CustomItemFilterSound = {
  id: "custom-sound:drop-alert",
  name: "Drop Alert",
  fileName: "drop-alert.wav",
  src: "file:///managed/drop-alert.wav",
};

function mountFilterView(overrides: Record<string, unknown> = {}) {
  const group = itemFilterGroup();
  return mount(ItemFilterView, {
    props: {
      itemFilterGroups: [group],
      recoverableCompactFilterGroups: [],
      itemFilterSounds: [...ITEM_FILTER_SOUNDS, { id: customSound.id, name: customSound.name }],
      customItemFilterSounds: [customSound],
      selectedItemFilterGroup: group,
      selectedItemFilterGroupedItems: [],
      itemFilterDraftGroupName: "",
      itemFilterDraftItem: "",
      itemFilterSuggestions: [],
      itemTypeOptions: [
        { value: "6", label: "Belt" },
        { value: "13", label: "Material" },
      ],
      itemFilterMuted: false,
      developerItemResearchEnabled: true,
      itemResearchEntries: [{ signature: "legacy-row" }],
      unresolvedItemResearchCount: 1,
      ...overrides,
    },
    attachTo: document.body,
  });
}

describe("Item Filter Stack", () => {
  test("keeps global mute prominent and removes the player-facing research notebook", async () => {
    const wrapper = mountFilterView();

    expect(wrapper.text()).toContain("Loot alerts are active");
    expect(wrapper.text()).toContain("Filter Stack");
    expect(wrapper.text()).not.toContain("Item Research");

    await buttonByText(wrapper, "Mute all").trigger("click");

    expect(wrapper.emitted("update:itemFilterMuted")?.[0]).toEqual([true]);
    wrapper.unmount();
  });

  test("collapses every top-level group into a useful human-readable summary", async () => {
    const wrapper = mountFilterView();
    const groupToggle = buttonByText(wrapper, "Loot Alerts");

    expect(groupToggle.attributes("aria-expanded")).toBe("true");
    expect(groupToggle.text()).toContain("On · 1 rarity · 1 type · 1 watched · Crystal Tink");
    expect(wrapper.text()).toContain("Group name");

    await groupToggle.trigger("click");

    expect(groupToggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("Group name");

    await groupToggle.trigger("click");

    expect(wrapper.emitted("selectGroup")?.at(-1)).toEqual([expect.objectContaining({ id: "loot-alerts" })]);
    wrapper.unmount();
  });

  test("forwards expanded group edits through explicit coordinator events", async () => {
    const wrapper = mountFilterView();

    await wrapper.get('.filter-stack-field input[type="text"]').setValue("Priority Drops");
    await wrapper.get('.item-filter-add-item input[type="search"]').setValue("Copper");
    await wrapper.get(".item-filter-add-item").trigger("submit");

    expect(wrapper.emitted("updateGroup")).toContainEqual([
      expect.objectContaining({ id: "loot-alerts", name: "Priority Drops" }),
    ]);
    expect(wrapper.emitted("update:itemFilterDraftItem")?.at(-1)).toEqual(["Copper"]);
    expect(wrapper.emitted("addItemToGroup")?.at(-1)).toEqual([
      expect.objectContaining({ id: "loot-alerts" }),
      undefined,
    ]);
    wrapper.unmount();
  });

  test("opens the contextual Sound Library and exposes import, preview, export, and confirmed remove actions", async () => {
    const wrapper = mountFilterView();

    await buttonByText(wrapper, "Sound Library").trigger("click");

    expect(wrapper.text()).toContain("Built-in sounds");
    expect(wrapper.text()).toContain("Drop Alert");
    expect(wrapper.text()).toContain("drop-alert.wav · 0 uses");

    await buttonByText(wrapper, "Import sounds").trigger("click");
    await buttonByText(wrapper, "Export soundpack").trigger("click");
    await wrapper.get('button[aria-label="Preview Drop Alert"]').trigger("click");
    await wrapper.get('button[aria-label="Remove Drop Alert"]').trigger("click");

    expect(wrapper.text()).toContain("Remove “Drop Alert”?");
    await buttonByText(wrapper, "Remove sound").trigger("click");

    expect(wrapper.emitted("importSounds")).toHaveLength(1);
    expect(wrapper.emitted("exportSoundpack")).toHaveLength(1);
    expect(wrapper.emitted("testSound")).toContainEqual([customSound.id, 70]);
    expect(wrapper.emitted("removeSound")?.[0]).toEqual([customSound]);
    wrapper.unmount();
  });

  test("previews filter pack contents before the user adds them", async () => {
    const pack = createItemFilterPackPayload([
      itemFilterGroup({ id: "shared", name: "Shared Drops", soundId: customSound.id }),
    ], [customSound]);
    const pendingImport = parseItemFilterPackPayload(pack);
    const wrapper = mountFilterView({ pendingItemFilterPackImport: pendingImport });

    expect(wrapper.text()).toContain("Review filter pack");
    expect(wrapper.text()).toContain("Shared Drops");
    expect(wrapper.text()).toContain("Existing groups and sounds stay untouched.");

    await buttonByText(wrapper, "Add pack").trigger("click");

    expect(wrapper.emitted("confirmFilterPackImport")).toHaveLength(1);
    wrapper.unmount();
  });
});

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`Unable to find button containing text: ${text}`);
  return button;
}
