import { describe, expect, test } from "vitest";
import { addTag, appendSearchTag, availableTagOptions, canCreateTag, filterPastRunsBySearch, removeTag, searchTerms, uniquePastRunTags } from "../../src/renderer/src/lib/past-run-search";
import { pastRun } from "./fixtures";

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
});
