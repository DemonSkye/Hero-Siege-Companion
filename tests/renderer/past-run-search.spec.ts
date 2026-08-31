import { describe, expect, test } from "vitest";
import {
  addTag,
  appendSearchTag,
  availableTagOptions,
  canCreateTag,
  filterPastRunsBySearch,
  pastRunSearchMatches,
  removeTag,
  searchTerms,
  uniquePastRunTags,
} from "../../src/renderer/src/lib/past-run-search";
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

  test("searches schema-v2 ordinary item totals without duplicating archived rarity or resource names", () => {
    const run = pastRun({
      id: "ordinary-item-search",
      itemTotals: [
        { name: "Heavy Gloves", total: 2, mf: 1 },
        { name: "Sash of the Magi", total: 2, mf: 1 },
        { name: "Copper Ore", total: 5, mf: 0 },
      ],
    });

    expect(filterPastRunsBySearch([run], searchTerms("heavy gloves"))).toEqual([run]);
    expect(pastRunSearchMatches(run, searchTerms("heavy gloves"))).toEqual([
      expect.objectContaining({
        kind: "drop",
        label: "Heavy Gloves",
        detail: "2 saved drops · 1 MF flagged",
        reportItemId: "exact:heavy%20gloves",
      }),
    ]);
    expect(pastRunSearchMatches(run, searchTerms("sash of the magi")).filter((match) => match.label === "Sash of the Magi")).toHaveLength(1);
    expect(pastRunSearchMatches(run, searchTerms("copper ore")).filter((match) => match.label === "Copper Ore")).toHaveLength(1);

    const collisionRun = pastRun({
      id: "ruby-collision-search",
      itemTotals: [
        { name: "Ruby", total: 5, mf: 1 },
        { name: "Ruby Ore", total: 3, mf: 0 },
      ],
      ores: [{ id: 30, name: "Ruby", total: 3 }],
    });
    expect(pastRunSearchMatches(collisionRun, searchTerms("ruby")).filter((match) => match.label === "Ruby")).toEqual([
      expect.objectContaining({ reportItemId: "exact:ruby", detail: "5 saved drops · 1 MF flagged" }),
    ]);
    expect(filterPastRunsBySearch([collisionRun], searchTerms("ruby ore"))).toEqual([collisionRun]);
    expect(pastRunSearchMatches(collisionRun, searchTerms("ruby ore")).filter((match) => match.label === "Ruby Ore")).toHaveLength(1);
  });

  test("returns stable report targets for matching fields and saved items", () => {
    const run = pastRun({
      accountName: "NomadFarmer",
      tags: ["season start"],
      itemBreakdown: {
        Set: {},
        Satanic: { "Hatshesput's Girdle": { name: "Hatshesput's Girdle", total: 1, mf: 1 } },
        Heroic: {},
        Angelic: {},
      },
    });

    expect(pastRunSearchMatches(run, searchTerms("girdle"))).toEqual([
      expect.objectContaining({
        kind: "drop",
        label: "Hatshesput's Girdle",
        detail: "Satanic · 1 drop · 1 MF flagged",
        matchedTerms: ["girdle"],
        rarity: "Satanic",
        itemName: "Hatshesput's Girdle",
      }),
    ]);

    expect(pastRunSearchMatches(run, searchTerms("season crystal 25 kills"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tag", label: "#season start", matchedTerms: ["season"] }),
      expect.objectContaining({ kind: "key", label: "Crystal Key", matchedTerms: ["crystal"], reportItemId: "metric:keys", resourceKind: "key", resourceName: "Crystal Key" }),
      expect.objectContaining({ kind: "stat", label: "Kills", detail: "25 total", matchedTerms: ["25", "kills"], reportItemId: "metric:kills" }),
    ]));
    expect(pastRunSearchMatches(run, searchTerms("girdle missing"))).toEqual([]);
  });

  test("does not match materialized empty rarity buckets but keeps legacy explicit rarity totals searchable", () => {
    const run = pastRun({
      setDrops: 0,
      satanicDrops: 2,
      heroicDrops: 0,
      angelicDrops: 0,
      itemBreakdown: { Set: {}, Satanic: {}, Heroic: {}, Angelic: {} },
    });

    expect(filterPastRunsBySearch([run], searchTerms("angelic"))).toEqual([]);
    expect(pastRunSearchMatches(run, searchTerms("angelic"))).toEqual([]);
    expect(pastRunSearchMatches(run, searchTerms("satanic"))).toEqual([
      expect.objectContaining({ label: "Satanic drops", detail: "2 tracked", reportItemId: "rarity:Satanic", rarity: "Satanic" }),
    ]);
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

  test("adds exact item totals without filtering the aggregate and matches saved drops and resources", () => {
    const shortRun = pastRun({
      id: "short",
      durationMs: 30 * 60_000,
      itemTotals: [
        { name: "Tarethíel Signet", total: 4, mf: 1 },
        { name: "Tarethiel Signet Replica", total: 50, mf: 0 },
        { name: "Copper Ore", total: 7, mf: 0 },
        { name: "Ruby", total: 4, mf: 1 },
        { name: "Ruby Ore", total: 2, mf: 0 },
      ],
      ores: [
        { id: 27, name: "Copper Ore", total: 7 },
        { id: 30, name: "Ruby", total: 2 },
      ],
    });
    const longRun = pastRun({
      id: "long",
      durationMs: 90 * 60_000,
      itemTotals: [
        { name: "Tarethiel Signet", total: 2, mf: 0 },
        { name: "Tarethiel Signet Replica", total: 50, mf: 0 },
        { name: "Copper Ore", total: 5, mf: 0 },
      ],
      ores: [{ id: 27, name: "Copper Ore", total: 5 }],
    });
    const reportConfig = {
      ...defaultPostRunReportConfig,
      exactTrackedItems: ["Tarethiel Signet", "Copper Ore", "Never Seen", "Ruby Ore"],
    };
    const aggregate = aggregatePastRuns([shortRun, longRun]);
    const rows = aggregateReportItemRows([shortRun, longRun], aggregate, reportConfig);

    expect(aggregate.runCount).toBe(2);
    expect(aggregate.totalGold).toBe(shortRun.totalGoldGained + longRun.totalGoldGained);
    expect(rows.find((row) => row.label === "Tarethiel Signet")).toMatchObject({
      value: 6,
      detail: "3/h - 3/run - 1 MF flagged",
    });
    expect(rows.find((row) => row.label === "Copper Ore")).toMatchObject({
      value: 12,
      detail: "6/h - 6/run - Saved resource",
    });
    expect(rows.find((row) => row.label === "Never Seen")).toMatchObject({ value: 0, detail: "No saved matches" });
    expect(rows.find((row) => row.label === "Ruby Ore")).toMatchObject({
      value: 2,
      detail: "1/h - 1/run - Saved resource",
    });

    const identityRows = aggregateReportItemRows([shortRun, longRun], aggregate, {
      ...defaultPostRunReportConfig,
      exactTrackedItems: ["Ruby", "Ruby Ore"],
    });
    expect(identityRows.find((row) => row.label === "Ruby")).toMatchObject({ value: 4, mf: 1 });
    expect(identityRows.find((row) => row.label === "Ruby Ore")).toMatchObject({ value: 2 });

    const shortRows = runReportItemRows(shortRun, reportConfig);
    expect(shortRows.find((row) => row.label === "Tarethiel Signet")).toMatchObject({ value: 4, detail: "8/h - 1 MF flagged" });
    expect(shortRows.find((row) => row.label === "Copper Ore")).toMatchObject({ value: 7, detail: "14/h - Saved resource" });

    const csv = createPastRunsAggregateCsv({ title: "Tracked Runs", query: "", runs: [shortRun, longRun], aggregate, reportConfig });
    const summary = createPastRunsDiscordSummary({ title: "Tracked Runs", query: "", runs: [shortRun, longRun], aggregate, reportConfig });
    expect(csv).toContain("report_item,Tarethiel Signet,6,1,,3/h - 3/run - 1 MF flagged");
    expect(summary).toContain("Tarethiel Signet: 6 (3/h - 3/run - 1 MF flagged)");

    const zeroDurationRun = pastRun({ durationMs: 0, itemTotals: [{ name: "Tarethiel Signet", total: 2, mf: 0 }] });
    const zeroDurationRow = runReportItemRows(zeroDurationRun, reportConfig).find((row) => row.label === "Tarethiel Signet");
    expect(zeroDurationRow?.detail).toBe("0/h - 0 MF flagged");

    const legacyAliasRun = pastRun({
      itemTotals: [],
      ores: [{ id: 31, name: "Jade", total: 3 }],
    });
    const aliasRows = runReportItemRows(legacyAliasRun, {
      ...defaultPostRunReportConfig,
      exactTrackedItems: ["Jade Ore"],
    });
    expect(aliasRows.find((row) => row.label === "Jade Ore")).toMatchObject({
      value: 3,
      detail: "18/h - Saved resource",
    });
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
