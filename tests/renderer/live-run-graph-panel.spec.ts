import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import LiveRunGraphPanel from "../../src/renderer/src/components/LiveRunGraphPanel.vue";
import type {
  LiveRunChartLane,
  LiveRunChartPoint,
  LiveRunCustomItem,
  LiveRunStandardMetric,
} from "../../src/renderer/src/lib/live-run-history";

describe("LiveRunGraphPanel", () => {
  test("keeps standard lanes fixed, shows actual totals, and renders accessible step geometry", () => {
    const customItem = trackedItem("The Bucket");
    const wrapper = mountPanel({
      elapsedMs: 120_000,
      customItems: [customItem],
      lanes: [
        lane("items", "Items", [0, 2, 5]),
        lane("gold", "Gold", [0, 500, 1_000]),
        lane("custom-item", "The Bucket", [0, 1, 3], customItem.seriesId, customItem.name),
        lane("kills", "Kills", [0, 4, 9]),
        lane("xp", "Experience", [0, 5_000, 12_345]),
      ],
    });

    expect(wrapper.get("#run-pace-card-title").text()).toBe("Run Pace");
    expect(wrapper.findAll(".run-pace-lane").map((entry) => entry.attributes("data-lane-id"))).toEqual([
      "xp",
      "gold",
      "kills",
      "items",
      "item:the bucket",
    ]);
    expect(wrapper.findAll(".run-pace-lane-label").map((entry) => entry.text())).toEqual([
      "XP",
      "Gold",
      "Kills",
      "Items",
      "The Bucket",
    ]);
    expect(wrapper.get('[data-lane-id="xp"] .run-pace-lane-summary').text()).toContain("12,345");
    expect(wrapper.get('[data-lane-id="gold"] .run-pace-lane-summary').text()).toContain("1,000");
    expect(wrapper.get('[data-lane-id="xp"] [data-run-pace-trend-summary]').text()).toContain("after 2 recorded changes");
    expect(wrapper.get(".run-pace-scope-note").text()).toContain("graphs are not saved to Past Runs");
    expect(wrapper.get(".run-pace-time-axis").text()).toContain("0:00");
    expect(wrapper.get(".run-pace-time-axis").text()).toContain("2:00");
    expect(wrapper.get(".run-pace-time-axis").text()).toContain("Since graph started");

    const svg = wrapper.get('[data-lane-id="xp"] svg');
    expect(svg.attributes("aria-hidden")).toBe("true");
    expect(svg.attributes("focusable")).toBe("false");
    const path = wrapper.get('[data-lane-id="xp"] .run-pace-line');
    expect(path.attributes("d")).toContain("H 500 V 95.196");
    expect(path.attributes("d")).toContain("H 1000 V 0");
    expect(wrapper.find("polyline").exists()).toBe(false);
    expect(wrapper.get('[data-lane-id="item:the bucket"] .run-pace-line').classes()).toContain("is-custom");
  });

  test("preserves the projected zero baseline when a recovered graph starts above zero", async () => {
    const wrapper = mountPanel({
      elapsedMs: 60_000,
      enabledStandardMetrics: ["xp"],
      lanes: [timedLane("xp", "XP", [[0, 10], [60_000, 20]])],
    });
    const plot = wrapper.get(".run-pace-plot-surface");
    Object.defineProperty(plot.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        right: 1_000,
        top: 0,
        bottom: 52,
        width: 1_000,
        height: 52,
        toJSON: () => ({}),
      }),
    });

    expect(wrapper.get("svg").attributes("viewBox")).toBe("0 0 1000 160");
    expect(wrapper.get(".run-pace-line").attributes("d")).toContain("M 0 80");
    plot.element.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 0, clientY: 20 }));
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".run-pace-inspection-point").attributes("style")).toContain("top: 50%");
  });

  test("adds freeform exact names and renders no more than eight catalog suggestions", async () => {
    const options = Array.from({ length: 2_000 }, (_, index) => `Ring Item ${String(index).padStart(4, "0")}`);
    const wrapper = mountPanel({ itemNameOptions: options });
    const input = wrapper.get('input[placeholder="Enter an exact item name"]');

    expect(wrapper.get(".run-pace-add").attributes("disabled")).toBeDefined();
    await input.setValue("ring item");
    expect(wrapper.findAll(".run-pace-suggestions button")).toHaveLength(8);
    expect(wrapper.find("datalist").exists()).toBe(false);
    expect(wrapper.findAll("option")).toHaveLength(0);

    await wrapper.findAll(".run-pace-suggestions button")[2]!.trigger("click");
    expect(wrapper.emitted("addCustomItem")?.[0]).toEqual(["Ring Item 0002"]);

    await input.setValue("  My   Freeform   Drop  ");
    await wrapper.get("form.run-pace-tracker-form").trigger("submit");
    expect(wrapper.emitted("addCustomItem")?.[1]).toEqual(["My Freeform Drop"]);
  });

  test("blocks blank, duplicate, and over-limit submissions while emitting named removals", async () => {
    const customItems = ["One", "Two", "Three", "Four"].map(trackedItem);
    const wrapper = mountPanel({
      customItems,
      lanes: standardLanes(),
    });
    const input = wrapper.get('input[placeholder="Enter an exact item name"]');

    await wrapper.get("form.run-pace-tracker-form").trigger("submit");
    expect(wrapper.emitted("addCustomItem")).toBeUndefined();
    await input.setValue("Five");
    expect(wrapper.get(".run-pace-add").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".run-pace-tracker-copy small").text()).toContain("Four custom item lanes");
    await wrapper.get("form.run-pace-tracker-form").trigger("submit");
    expect(wrapper.emitted("addCustomItem")).toBeUndefined();

    const remove = wrapper.get('button[aria-label="Stop tracking Two"]');
    expect(remove.text()).toBe("Remove");
    await remove.trigger("click");
    expect(wrapper.emitted("removeCustomItem")).toEqual([["item:two"]]);

    const duplicateWrapper = mountPanel({
      customItems: [trackedItem("The Bucket")],
      lanes: standardLanes(),
    });
    const duplicateInput = duplicateWrapper.get('input[placeholder="Enter an exact item name"]');
    await duplicateInput.setValue("  THE   BUCKET ");
    expect(duplicateWrapper.get(".run-pace-add").attributes("disabled")).toBeDefined();
    expect(duplicateWrapper.get(".run-pace-tracker-copy small").text()).toContain("Already tracking THE BUCKET");
    await duplicateWrapper.get("form.run-pace-tracker-form").trigger("submit");
    expect(duplicateWrapper.emitted("addCustomItem")).toBeUndefined();

    const diacriticDuplicateWrapper = mountPanel({
      customItems: [trackedItem("Tarethíel Signet")],
      lanes: standardLanes(),
    });
    const diacriticInput = diacriticDuplicateWrapper.get('input[placeholder="Enter an exact item name"]');
    await diacriticInput.setValue("TARETHIEL SIGNET");
    expect(diacriticDuplicateWrapper.get(".run-pace-add").attributes("disabled")).toBeDefined();
  });

  test("lets every built-in lane be disabled without removing custom tracking", async () => {
    const customItem = trackedItem("The Bucket");
    const wrapper = mountPanel({
      customItems: [customItem],
      lanes: [
        ...standardLanes(),
        lane("custom-item", customItem.name, [0, 2], customItem.seriesId, customItem.name),
      ],
    });

    const builtInControls = wrapper.findAll(".run-pace-standard-lanes label");
    expect(builtInControls.map((control) => control.text())).toEqual(["XP", "Gold", "Kills", "Items"]);
    expect(builtInControls.every((control) => (control.get("input").element as HTMLInputElement).checked)).toBe(true);

    await builtInControls[1]!.get("input").setValue(false);
    expect(wrapper.emitted("setStandardMetricEnabled")).toEqual([["gold", false]]);

    await wrapper.setProps({ enabledStandardMetrics: [] });
    expect(wrapper.findAll(".run-pace-lane").map((entry) => entry.attributes("data-lane-id"))).toEqual([
      customItem.seriesId,
    ]);
    expect(wrapper.get(`button[aria-label="Stop tracking ${customItem.name}"]`).exists()).toBe(true);

    await wrapper.setProps({ customItems: [], lanes: standardLanes() });
    expect(wrapper.find(".run-pace-lanes").exists()).toBe(false);
    expect(wrapper.find(".run-pace-time-axis").exists()).toBe(false);
    expect(wrapper.get(".run-pace-no-lanes").text()).toContain("All graph lanes are hidden");

    await wrapper.setProps({
      enabledStandardMetrics: ["gold"],
      lanes: [lane("xp", "XP", [0, 10]), ...standardLanes().slice(1)],
    });
    expect(wrapper.get(".run-pace-status").text()).toBe("Waiting");
    expect(wrapper.get(".run-pace-empty-state").text()).toContain("No activity in the visible lanes yet");
  });

  test("inspects exact step values with synchronized hover and keyboard time controls", async () => {
    const wrapper = mountPanel({
      elapsedMs: 120_000,
      lanes: [
        lane("xp", "XP", [0, 50, 100]),
        lane("gold", "Gold", [0, 500, 1_000]),
        lane("kills", "Kills", [0, 5, 10]),
        lane("items", "Items", [0, 2, 4]),
      ],
    });
    const plot = wrapper.findAll(".run-pace-plot-surface")[0]!;
    Object.defineProperty(plot.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 100,
        y: 100,
        left: 100,
        right: 1_100,
        top: 100,
        bottom: 152,
        width: 1_000,
        height: 52,
        toJSON: () => ({}),
      }),
    });

    plot.element.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 600,
      clientY: 125,
    }));
    await wrapper.vm.$nextTick();
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("1:00 since graph started");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("XP50");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("Gold500");
    expect(wrapper.findAll(".run-pace-crosshair")).toHaveLength(4);
    expect(wrapper.findAll(".run-pace-crosshair")[0]!.attributes("style")).toContain("left: 50%");

    await wrapper.setProps({ elapsedMs: 180_000 });
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("1:30 since graph started");
    expect(wrapper.findAll(".run-pace-crosshair")[0]!.attributes("style")).toContain("left: 50%");
    await wrapper.setProps({ elapsedMs: 120_000 });

    await wrapper.setProps({ enabledStandardMetrics: ["xp", "items"] });
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("XP50");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("Items2");
    expect(wrapper.get("[data-run-pace-inspection]").text()).not.toContain("Gold");

    await wrapper.get(".run-pace-lanes").trigger("pointerleave");
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    expect(wrapper.find("[data-run-pace-inspection]").exists()).toBe(false);

    const range = wrapper.get('.run-pace-time-inspector input[type="range"]');
    await range.trigger("focus");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("2:00 since graph started");
    expect(range.attributes("aria-valuetext")).toContain("XP 100");
    await range.setValue("60");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("1:00 since graph started");
    expect(wrapper.findAll(".run-pace-crosshair")[0]!.attributes("style")).toContain("left: 50%");
    await range.trigger("blur");
    expect(wrapper.find("[data-run-pace-inspection]").exists()).toBe(false);
  });

  test("keeps keyboard inspection on exact seconds as live duration grows and clamps the tooltip onscreen", async () => {
    const wrapper = mountPanel({
      elapsedMs: 2_999,
      lanes: [
        timedLane("xp", "XP", [[0, 0], [1_000, 5], [2_999, 10]]),
        ...standardLanes().slice(1),
      ],
      enabledStandardMetrics: ["xp"],
    });
    const range = wrapper.get('.run-pace-time-inspector input[type="range"]');
    Object.defineProperty(range.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 100,
        y: 500,
        left: 100,
        right: 1_100,
        top: 500,
        bottom: 514,
        width: 1_000,
        height: 14,
        toJSON: () => ({}),
      }),
    });

    expect(range.attributes("max")).toBe("3");
    expect(range.attributes("disabled")).toBeUndefined();
    await range.trigger("focus");
    await range.setValue("1");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("0:01 since graph started");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("XP5");

    await wrapper.setProps({ elapsedMs: 3_999 });
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("0:01 since graph started");
    expect(wrapper.get("[data-run-pace-inspection]").text()).toContain("XP5");
    expect(wrapper.get(".run-pace-crosshair").attributes("style")).toContain("left: 25.006");
    expect(Number.parseFloat(wrapper.get("[data-run-pace-inspection]").attributes("style").match(/left:\s*([\d.]+)/)?.[1] ?? "0"))
      .toBeCloseTo(362, 0);

    await range.trigger("blur");
    const plot = wrapper.get(".run-pace-plot-surface");
    Object.defineProperty(plot.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        right: 1_000,
        top: 0,
        bottom: 160,
        width: 1_000,
        height: 160,
        toJSON: () => ({}),
      }),
    });
    plot.element.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 990,
      clientY: 750,
    }));
    await wrapper.vm.$nextTick();
    const widthSpy = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
    plot.element.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 990,
      clientY: 750,
    }));
    await wrapper.vm.$nextTick();
    const tooltip = wrapper.get<HTMLElement>("[data-run-pace-inspection]");
    expect(tooltip.attributes("style")).toContain("left: 678px");
    expect(tooltip.attributes("style")).toContain("top: 618px");
    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });

  test("labels waiting, paused, and live states and keeps the whole card collapsible", async () => {
    const wrapper = mountPanel({ lanes: standardLanes() });

    expect(wrapper.get(".run-pace-status").text()).toBe("Waiting");
    expect(wrapper.get(".run-pace-empty-state").text()).toContain("No activity in the visible lanes yet");

    await wrapper.setProps({ runStatus: "paused", runPausedLabel: "Paused: capture stopped" });
    expect(wrapper.get(".run-pace-status").text()).toBe("Paused: capture stopped");
    expect(wrapper.get(".run-pace-status").classes()).toContain("is-paused");

    await wrapper.setProps({
      runStatus: "recording",
      lanes: [lane("xp", "XP", [0, 1]), ...standardLanes().slice(1)],
    });
    expect(wrapper.get(".run-pace-status").text()).toBe("Live");
    expect(wrapper.find(".run-pace-empty-state").exists()).toBe(false);

    const toggle = wrapper.get('button[aria-label="Collapse Run Pace"]');
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(wrapper.get("#run-pace-card-body").attributes("style")).toContain("display: none");
  });
});

function mountPanel(overrides: Partial<{
  lanes: readonly LiveRunChartLane[];
  customItems: readonly LiveRunCustomItem[];
  elapsedMs: number;
  runStatus: "recording" | "paused";
  runPausedLabel: string;
  itemNameOptions: readonly string[];
  enabledStandardMetrics: readonly LiveRunStandardMetric[];
}> = {}) {
  return mount(LiveRunGraphPanel, {
    props: {
      lanes: standardLanes(),
      customItems: [],
      enabledStandardMetrics: ["xp", "gold", "kills", "items"],
      elapsedMs: 0,
      runStatus: "recording",
      runPausedLabel: "Paused",
      itemNameOptions: [],
      ...overrides,
    },
    global: {
      stubs: { Teleport: true },
    },
  });
}

function standardLanes(): LiveRunChartLane[] {
  return [
    lane("xp", "XP", [0]),
    lane("gold", "Gold", [0]),
    lane("kills", "Kills", [0]),
    lane("items", "Items", [0]),
  ];
}

function lane(
  metric: LiveRunChartLane["metric"],
  label: string,
  values: number[],
  id = metric,
  itemName: string | null = null,
): LiveRunChartLane {
  const maxValue = Math.max(...values, 0);
  const scaleMax = Math.max(maxValue, 1);
  const points: LiveRunChartPoint[] = values.map((value, index) => ({
    elapsedMs: index * 60_000,
    value,
    x: values.length > 1 ? (index / (values.length - 1)) * 1_000 : 0,
    y: 160 - (value / scaleMax) * 160,
  }));
  return {
    id,
    metric,
    label,
    itemName,
    chartWidth: 1_000,
    chartHeight: 160,
    latestValue: values.at(-1) ?? 0,
    maxValue,
    points,
    svgPoints: points.map((point) => `${point.x},${point.y}`).join(" "),
  };
}

function timedLane(
  metric: LiveRunChartLane["metric"],
  label: string,
  samples: ReadonlyArray<readonly [elapsedMs: number, value: number]>,
): LiveRunChartLane {
  const elapsedEnd = Math.max(samples.at(-1)?.[0] ?? 0, 1);
  const maxValue = Math.max(...samples.map(([, value]) => value), 0);
  const scaleMax = Math.max(maxValue, 1);
  const points = samples.map(([elapsedMs, value]) => ({
    elapsedMs,
    value,
    x: (elapsedMs / elapsedEnd) * 1_000,
    y: 160 - (value / scaleMax) * 160,
  }));
  return {
    id: metric,
    metric,
    label,
    itemName: null,
    chartWidth: 1_000,
    chartHeight: 160,
    latestValue: samples.at(-1)?.[1] ?? 0,
    maxValue,
    points,
    svgPoints: points.map((point) => `${point.x},${point.y}`).join(" "),
  };
}

function trackedItem(name: string): LiveRunCustomItem {
  const key = name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  return { key, name, seriesId: `item:${key}` };
}
