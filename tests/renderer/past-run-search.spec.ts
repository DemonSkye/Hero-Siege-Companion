import { describe, expect, test } from "vitest";
import { addTag, appendSearchTag, availableTagOptions, canCreateTag, filterPastRunsBySearch, removeTag, searchTerms, uniquePastRunTags } from "../../src/renderer/src/lib/past-run-search";
import {
  TRACKED_RARITY_ORDER,
  aggregatePastRuns,
  aggregateReportItemRows,
  createPastRunDiscordSummary,
  createPastRunsAggregateCsv,
  createPastRunsDiscordSummary,
  createPastRunsExportPayload,
  runReportItemRows,
} from "../../src/renderer/src/lib/past-runs";
import { defaultPostRunReportConfig, withPostRunReportSummaryItems } from "../../src/renderer/src/lib/report-config";
import { itemFilterGroup, pastRun } from "./fixtures";

describe("past run search helpers", () => {
  test("searches tags, drops, resources, character, and stats", () => {
    const focused = pastRun({
      id: "focused",
      accountName: "NomadFarmer",
      tags: ["keys", "season start"],
    });
    const other = pastRun({
      id: "other",
      accountName: "OtherHero",
      tags: ["bossing"],
      itemBreakdown: { Set: {}, Satanic: {}, Heroic: {}, Angelic: {} },
      keys: [],
      ores: [],
      materials: [],
      totalGoldGained: 0,
      totalXpGained: 0,
      totalKillsGained: 0,
    });

    expect(filterPastRunsBySearch([focused, other], searchTerms("nomad keys crystal"))).toEqual([focused]);
    expect(filterPastRunsBySearch([focused, other], searchTerms("battle fragment 25 kills"))).toEqual([focused]);
    expect(filterPastRunsBySearch([focused, other], [])).toEqual([focused, other]);
  });

  test("normalizes tag choices and query appends", () => {
    const run = pastRun({ tags: ["Keys", "bossing", "keys"] });
    const allTags = uniquePastRunTags([run, pastRun({ id: "run-2", tags: ["materials", "Bossing"] })]);

    expect(allTags).toEqual(["Bossing", "Keys", "materials"]);
    expect(availableTagOptions(allTags, run, "mat")).toEqual(["materials"]);
    expect(appendSearchTag("keys", "Keys")).toBe("keys");
    expect(appendSearchTag("gold", "season start")).toBe("gold season start");
    expect(appendSearchTag("gold season start", "season start")).toBe("gold season start");
  });

  test("adds and removes run tags without duplicates", () => {
    const run = pastRun({ tags: ["keys"] });

    expect(canCreateTag(run, "materials")).toBe(true);
    expect(canCreateTag(run, "KEYS")).toBe(false);
    expect(addTag(run, "materials")).toEqual(["keys", "materials"]);
    expect(addTag(run, "KEYS")).toEqual(["keys"]);
    expect(removeTag({ ...run, tags: ["keys", "materials"] }, "KEYS")).toEqual(["materials"]);
  });

  test("builds export payloads for matching runs", () => {
    const runs = [
      pastRun({ id: "fast", totalGoldGained: 120_000, durationMs: 600_000 }),
      pastRun({ id: "slow", totalGoldGained: 80_000, durationMs: 1_200_000 }),
    ];
    const all = aggregatePastRuns(runs);
    const payload = createPastRunsExportPayload(runs, "keys", all);

    expect(payload).toMatchObject({
      app: "hero-siege-companion",
      kind: "past-runs",
      filter: { query: "keys", runCount: 2 },
      runs: [expect.objectContaining({ id: "fast" }), expect.objectContaining({ id: "slow" })],
    });
  });

  test("builds CSV exports and Discord-friendly summaries for sharing", () => {
    const run = pastRun({ accountName: "ShareHero", tags: ["Dungeons"] });
    const aggregate = aggregatePastRuns([run]);
    const csv = createPastRunsAggregateCsv({
      title: "Matching Runs",
      query: "dungeons",
      aggregate,
      summaryMetrics: ["gold", "mfDrops"],
    });
    const aggregateSummary = createPastRunsDiscordSummary({
      title: "Matching Runs",
      query: "dungeons",
      aggregate,
      summaryMetrics: ["gold", "mfDrops"],
    });
    const runSummary = createPastRunDiscordSummary(run, {
      summaryMetrics: ["gold", "mfDrops"],
      dropRarities: TRACKED_RARITY_ORDER,
      topDropLimit: 3,
      activeReportGroups: [],
    });

    expect(csv.split("\n")[0]).toBe("section,label,value,mf_flagged,unique,detail");
    expect(csv).toContain("summary,Title,Matching Runs,,,query: dungeons; runs: 1");
    expect(csv).toContain("metric,Gold/h,600000,,,\"Best per hour 600,000\"");
    expect(csv).toContain("rarity,Satanic,2,1,1,tracked drops");
    expect(aggregateSummary).toContain("**Hero Siege Past Runs - Matching Runs**");
    expect(aggregateSummary).toContain("Drops: Set 1 (0 MF flagged, 1 unique)");
    expect(aggregateSummary).toContain("Filter: dungeons");
    expect(runSummary).toContain("**Hero Siege Run - ShareHero**");
    expect(runSummary).toContain("Stats: Gold: 100,000 (600,000/h)");
    expect(runSummary).toContain("Resources: 2 keys | 5 ore | 3 materials");
    expect(runSummary).toContain("Tags: #Dungeons");
  });

  test("builds report-aware rows and share text for custom and linked filter groups", () => {
    const run = pastRun({ accountName: "ReportHero" });
    const filterGroup = itemFilterGroup({
      id: "ring-alerts",
      name: "Ring Alerts",
      rarities: ["Heroic"],
      types: [7],
      items: [],
    });
    const reportConfig = withPostRunReportSummaryItems(
      {
        ...defaultPostRunReportConfig,
        topDropLimit: 1,
        itemGroups: [{
          id: "sashes",
          name: "Sash Drops",
          enabled: true,
          rarities: ["Satanic"],
          types: [],
          items: ["Sash of the Magi"],
        }],
      },
      ["metric:gold", "group:sashes", "filter:ring-alerts"],
    );
    const activeReportGroups = [
      { enabled: true, rarities: ["Satanic"], types: [], items: ["Sash of the Magi"], emptyCriteriaMatchesAll: true },
      { enabled: true, rarities: filterGroup.rarities, types: filterGroup.types, items: filterGroup.items, emptyCriteriaMatchesAll: false },
    ];
    const aggregate = aggregatePastRuns([run], reportConfig.dropRarities, reportConfig.topDropLimit, [], activeReportGroups);

    const runRows = runReportItemRows(run, reportConfig, [filterGroup]);
    const aggregateRows = aggregateReportItemRows([run], aggregate, reportConfig, [filterGroup]);
    const csv = createPastRunsAggregateCsv({ title: "Report Runs", query: "", runs: [run], aggregate, reportConfig, itemFilterGroups: [filterGroup] });
    const aggregateSummary = createPastRunsDiscordSummary({ title: "Report Runs", query: "", runs: [run], aggregate, reportConfig, itemFilterGroups: [filterGroup] });
    const runSummary = createPastRunDiscordSummary(run, {
      reportConfig,
      itemFilterGroups: [filterGroup],
      dropRarities: reportConfig.dropRarities,
      topDropLimit: 1,
      activeReportGroups,
    });

    expect(runRows.map((row) => row.label)).toEqual(["Gold", "Sash Drops", "Ring Alerts"]);
    expect(runRows.find((row) => row.label === "Sash Drops")?.detailPanel).toMatchObject({ kind: "drops", drops: [{ name: "Sash of the Magi", total: 2, mf: 1 }] });
    expect(aggregateRows.find((row) => row.label === "Ring Alerts")?.detailPanel).toMatchObject({ kind: "drops", drops: [{ name: "Scourge Loop", total: 1, mf: 1 }] });
    expect(csv).toContain("report_item,Sash Drops,2,1,1,1 MF flagged - 1 unique");
    expect(aggregateSummary).toContain("Report: Gold/h: 600,000");
    expect(aggregateSummary.split("\n")).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Drops:/)]));
    expect(runSummary).toContain("Report: Gold: 100,000");
    expect(runSummary).toContain("Top drops: Sash of the Magi x2, +1 more");
  });

  test("applies item-filter-style rarity, type, and exact item rules to drop recaps", () => {
    const run = pastRun();
    const ringFilter = itemFilterGroup({
      rarities: ["Heroic"],
      types: [7],
      items: [],
    });
    const exactItemFilter = itemFilterGroup({
      rarities: ["Heroic"],
      types: [7],
      items: [{ name: "Sash of the Magi", soundId: "", typeLabel: "Belt" }],
    });

    const ringAggregate = aggregatePastRuns([run], TRACKED_RARITY_ORDER, 8, [], [{ ...ringFilter, emptyCriteriaMatchesAll: false }]);
    const exactAggregate = aggregatePastRuns([run], TRACKED_RARITY_ORDER, 8, [], [{ ...exactItemFilter, emptyCriteriaMatchesAll: false }]);

    expect(ringAggregate.drops).toEqual([
      { rarity: "Heroic", total: 1, mf: 1, unique: 1 },
    ]);
    expect(ringAggregate.topDrops).toEqual([{ name: "Scourge Loop", total: 1, mf: 1 }]);
    expect(exactAggregate.topDrops.map((drop) => drop.name)).toEqual(["Sash of the Magi", "Scourge Loop"]);
  });
});
