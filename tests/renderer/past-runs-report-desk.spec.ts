import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test } from "vitest";

import PastRunsView from "../../src/renderer/src/components/PastRunsView.vue";
import { defaultPostRunReportConfig } from "../../src/renderer/src/lib/report-config";
import { itemFilterGroup, pastRun } from "./fixtures";

const mountedWrappers: VueWrapper[] = [];

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
});

function mountReportDesk(pastRuns = [
  pastRun({ id: "run-alpha", accountName: "Run Alpha", tags: ["Dungeons"] }),
  pastRun({ id: "run-beta", accountName: "Run Beta", tags: ["Codex"], totalGoldGained: 50_000 }),
]) {
  const wrapper = mount(PastRunsView, {
    attachTo: document.body,
    props: {
      pastRuns,
      reportConfig: defaultPostRunReportConfig,
      itemFilterGroups: [itemFilterGroup()],
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe("Past Runs Report Desk", () => {
  test("keeps the run library beside one aggregate or selected-run report", async () => {
    const wrapper = mountReportDesk();
    const report = wrapper.get(".past-run-report-paper");

    expect(wrapper.get(".past-run-library").exists()).toBe(true);
    expect(report.text()).toContain("All Runs");
    expect(wrapper.text()).not.toContain("View report");
    expect(wrapper.findAll(".past-run-card-primary-action")).toHaveLength(2);
    expect(wrapper.get(".past-run-library-aggregate").attributes("aria-current")).toBe("page");

    await wrapper.findAll(".past-run-card-primary-action")[1].trigger("click");

    expect(report.text()).toContain("Run Beta");
    expect(report.text()).not.toContain("Filtered run report");
    expect(wrapper.findAll(".past-run-card-primary-action")[1].attributes("aria-current")).toBe("page");
    expect(document.activeElement).toBe(report.get("[data-past-run-report-heading]").element);

    await wrapper.get(".past-run-mobile-back").trigger("click");
    expect(wrapper.get(".past-run-report-desk").classes()).not.toContain("mobile-report-open");
    expect(document.activeElement).toBe(wrapper.get(".past-run-library-aggregate").element);

    await wrapper.get(".past-run-library-aggregate").trigger("click");
    expect(wrapper.get(".past-run-report-desk").classes()).toContain("mobile-report-open");
    expect(report.text()).toContain("All Runs");
  });

  test("puts secondary run actions in an accessible overflow menu", async () => {
    const wrapper = mountReportDesk();
    const firstMoreButton = wrapper.findAll(".past-run-more-actions")[0];

    expect(wrapper.get(".past-run-card-primary-action").attributes("aria-label")).toContain("Open report for Run Alpha,");
    expect(wrapper.get(".past-run-card-primary-action").element.tagName).toBe("BUTTON");

    firstMoreButton.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await nextTick();
    await nextTick();
    const menu = wrapper.get('[role="menu"]');
    expect(firstMoreButton.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".past-run-library-aggregate").attributes("aria-current")).toBe("page");
    expect(wrapper.find(".past-run-card-primary-action[aria-current]").exists()).toBe(false);
    expect(menu.text()).toContain("Copy Summary");
    expect(menu.text()).toContain("Edit Tags");
    expect(menu.text()).toContain("Export Run");
    expect(menu.text()).toContain("Delete");
    expect(document.activeElement).toBe(menu.get(".past-run-copy-summary").element);

    await menu.get(".past-run-copy-summary").trigger("click");
    expect(wrapper.emitted("copy-summary")?.[0]?.[0]).toContain("Hero Siege Run - Run Alpha");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    await firstMoreButton.trigger("click");
    await wrapper.get(".past-run-export-single").trigger("click");
    expect(wrapper.emitted("export-runs-json")?.[0]?.[0]).toMatchObject({
      kind: "past-runs",
      filter: { runCount: 1 },
      runs: [{ id: "run-alpha" }],
    });

    await firstMoreButton.trigger("click");
    await wrapper.get('[role="menu"] button:nth-child(2)').trigger("click");
    await nextTick();
    expect(wrapper.get(".run-tag-menu").exists()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get(".run-tag-search input").element);

    await wrapper.get(".run-tag-menu").trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(wrapper.find(".run-tag-menu").exists()).toBe(false);
    expect(document.activeElement).toBe(firstMoreButton.element);

    await firstMoreButton.trigger("click");
    await wrapper.get(".past-run-delete").trigger("click");
    expect(wrapper.get('[aria-label="Confirm delete Run Alpha"]').text()).toContain("Delete this run?");
    await wrapper.get(".past-run-confirm-delete").trigger("click");
    expect(wrapper.emitted("delete-run")).toEqual([["run-alpha"]]);
  });

  test("keeps aggregate exports scoped to the current search", async () => {
    const wrapper = mountReportDesk();

    await wrapper.get(".past-run-search input").setValue("dungeons");
    expect(wrapper.text()).toContain("1/2 shown");
    expect(wrapper.findAll(".past-run-library-card")).toHaveLength(1);

    await wrapper.get(".past-run-export-csv").trigger("click");
    await wrapper.get(".past-run-export-json").trigger("click");
    await wrapper.get(".past-run-copy-filtered-summary").trigger("click");

    expect(wrapper.emitted("export-runs-csv")?.[0]?.[0]).toContain("section,label,value,mf_flagged,unique,detail");
    expect(wrapper.emitted("export-runs-json")?.[0]?.[0]).toMatchObject({
      filter: { query: "dungeons", runCount: 1 },
      runs: [{ id: "run-alpha" }],
    });
    expect(wrapper.emitted("copy-summary")?.[0]?.[0]).toContain("Hero Siege Past Runs - Matching Runs");
  });

  test("shows a matching drop as a native report row when report configuration omits it", async () => {
    const wrapper = mountReportDesk([
      pastRun({
        id: "run-girdle",
        accountName: "Farm Run",
        itemBreakdown: {
          Set: {},
          Satanic: { "Hatshesput's Girdle": { name: "Hatshesput's Girdle", total: 1, mf: 1 } },
          Heroic: {},
          Angelic: {},
        },
      }),
      pastRun({ id: "run-other", accountName: "Other Run", itemBreakdown: { Set: {}, Satanic: {}, Heroic: {}, Angelic: {} } }),
    ]);

    await wrapper.get(".past-run-search input").setValue("girdle");
    await wrapper.get(".past-run-card-primary-action").trigger("click");

    expect(wrapper.find(".past-run-search-match-context").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Why this run is shown");
    expect(wrapper.get(".past-run-search-results-label").text()).toContain("Search results for “girdle”");

    const resultPanel = wrapper.get('[data-report-detail-id="group:search-match-0"]');
    expect(resultPanel.get(".drop-breakdown-head").text()).toContain("Satanic");
    expect(resultPanel.classes()).toContain("is-search-match");
    expect(resultPanel.get(".drop-breakdown-row").text()).toContain("Hatshesput's Girdle");
    expect(resultPanel.get(".drop-breakdown-row").classes()).toContain("is-search-match");
    expect(resultPanel.get(".drop-breakdown-row .sr-only").text()).toBe("Matches search.");
  });

  test("shows every matching drop even when a projected search row exceeds the normal top-drop limit", async () => {
    const matchingDrops = Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
      const name = `Search Ring ${index + 1}`;
      return [name, { name, total: index + 1, mf: 0 }];
    }));
    const wrapper = mountReportDesk([
      pastRun({
        id: "run-many-rings",
        accountName: "Ring Run",
        itemBreakdown: { Set: {}, Satanic: matchingDrops, Heroic: {}, Angelic: {} },
      }),
    ]);

    await wrapper.get(".past-run-search input").setValue("search ring");
    await wrapper.get(".past-run-card-primary-action").trigger("click");

    const resultPanel = wrapper.get('[data-report-detail-id="group:search-match-0"]');
    expect(resultPanel.findAll(".drop-breakdown-row")).toHaveLength(9);
    expect(resultPanel.findAll(".drop-breakdown-row.is-search-match")).toHaveLength(9);
  });

  test("highlights matching report fields and reveals matching hidden resources", async () => {
    const wrapper = mountReportDesk([
      pastRun({ id: "run-farm", accountName: "Farm Hero" }),
      pastRun({ id: "run-other", accountName: "Other Run", keys: [], ores: [], materials: [] }),
    ]);

    await wrapper.get(".past-run-search input").setValue("farm");
    await wrapper.get(".past-run-card-primary-action").trigger("click");
    expect(wrapper.get("[data-past-run-report-heading]").classes()).toContain("is-search-match");

    await wrapper.get(".past-run-search input").setValue("gold");
    await nextTick();
    expect(wrapper.get('[data-report-item-id="metric:gold"]').classes()).toContain("is-search-match");

    await wrapper.get(".past-run-search input").setValue("crystal");
    await nextTick();
    const keysPanel = wrapper.get('[data-report-detail-id="metric:keys"]');
    expect(keysPanel.get(".drop-breakdown-head").text()).toContain("Keys");
    expect(keysPanel.get(".resource-chip").text()).toContain("Crystal Key");
    expect(keysPanel.get(".resource-chip").classes()).toContain("is-search-match");
    expect(keysPanel.get(".resource-chip .sr-only").text()).toBe("Matches search.");
  });

  test("returns to the aggregate report when the current search excludes the selected run", async () => {
    const wrapper = mountReportDesk();
    const report = wrapper.get(".past-run-report-paper");

    await wrapper.findAll(".past-run-card-primary-action")[1].trigger("click");
    expect(report.text()).toContain("Run Beta");

    await wrapper.get(".past-run-search input").setValue("dungeons");
    await nextTick();

    expect(wrapper.get(".past-run-library-aggregate").attributes("aria-current")).toBe("page");
    expect(report.text()).toContain("Matching Runs");
    expect(report.text()).not.toContain("Run Beta");
  });
});
