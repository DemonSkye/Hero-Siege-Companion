import { describe, expect, test } from "vitest";
import { addTag, appendSearchTag, availableTagOptions, canCreateTag, filterPastRunsBySearch, removeTag, searchTerms, uniquePastRunTags } from "../../src/renderer/src/lib/past-run-search";
import { TRACKED_RARITY_ORDER, aggregatePastRuns, comparePastRunAggregates, createPastRunsExportPayload } from "../../src/renderer/src/lib/past-runs";
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

  test("builds export payloads and aggregate comparisons for matching runs", () => {
    const runs = [
      pastRun({ id: "fast", totalGoldGained: 120_000, durationMs: 600_000 }),
      pastRun({ id: "slow", totalGoldGained: 80_000, durationMs: 1_200_000 }),
    ];
    const all = aggregatePastRuns(runs);
    const recent = aggregatePastRuns(runs.slice(0, 1));
    const payload = createPastRunsExportPayload(runs, "keys", all);
    const comparison = comparePastRunAggregates(recent, all);

    expect(payload).toMatchObject({
      app: "hero-siege-companion",
      kind: "past-runs",
      filter: { query: "keys", runCount: 2 },
      runs: [expect.objectContaining({ id: "fast" }), expect.objectContaining({ id: "slow" })],
    });
    expect(comparison.find((row) => row.id === "goldPerHour")).toMatchObject({
      label: "Gold/h",
      direction: "up",
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
