import { expect, test } from "vitest";
import { itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { marketCatalogStatRows } from "../../src/renderer/src/lib/market-stat-display";

// Literal expected phrases from the supplied Gryphon tooltip; constructor
// values and item-stat namespace are independently frozen in retained v8 data.
test("Gryphon's Claw combines its scoped Execute bonus and displays Open Wounds as a percentage", () => {
  const rows = marketCatalogStatRows(itemBaseStatDefinition("unique:5:0:65")!.stats, "unique:5:0:65");
  expect(rows).toHaveLength(5);
  expect(rows.find(row => row.key === 202)).toEqual({ key: 202, label: "+[12\u201318] to [Execute]" });
  expect(rows.find(row => row.key === 99)).toEqual({ key: 99, label: "+[15\u201325]% Chance to Open Wounds" });
  expect(rows.map(row => row.key)).toEqual([72,73,99,51,202]);
  expect(JSON.stringify(rows)).not.toMatch(/Identifier:|Talent identifier|184/);
});

test("a numeric 184 is not a global Execute mapping, and incomplete pairs do not acquire a talent name", () => {
  const pair = [{ statId:202,kind:"scalar" as const,minimum:184,maximum:184 },
    { statId:203,kind:"range" as const,minimum:12,maximum:18 }];
  expect(marketCatalogStatRows(pair, "unique:5:0:66")).toEqual([
    { key:202,label:"Selected talent bonus",value:"[12\u201318] \u00b7 Talent name unavailable" },
  ]);
  expect(marketCatalogStatRows(pair.slice(0,1), "unique:5:0:65")[0]).toMatchObject({
    label:"Selected talent",value:"Talent name unavailable",
  });
});

test.each([[202,203],[205,206],[208,209],[211,212],[214,215],[217,218],[462,463],[444,445]])(
  "the retained selected-talent pair %i/%i composes without guessing its name or modifier unit", (selector, modifier) => {
    expect(marketCatalogStatRows([{statId:selector,kind:"scalar",minimum:184,maximum:184},
      {statId:modifier,kind:"scalar",minimum:.5,maximum:.5}], null)).toEqual([
      {key:selector,label:"Selected talent bonus",value:"[0.5] \u00b7 Talent name unavailable"},
    ]);
  });

test.each([[113,114,115],[116,117,118],[119,120,121],[122,123,124],[125,126,127],[185,186,187],[188,189,190]])(
  "proc fields %i/%i/%i compose but do not invent a percent conversion or talent name", (selector, level, chance) => {
    const rows = marketCatalogStatRows([{statId:selector,kind:"scalar",minimum:555,maximum:555},
      {statId:level,kind:"range",minimum:12,maximum:20},{statId:chance,kind:"range",minimum:3,maximum:6}], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("Chance [3\u20136]; level [12\u201320] \u00b7 Talent name unavailable");
    expect(rows[0].value).not.toContain("%");
    expect(JSON.stringify(rows)).not.toContain("555");
  });

test("conditional and table modifiers keep their distinct retained representations", () => {
  const rows = marketCatalogStatRows([{statId:202,kind:"series",minimum:1,maximum:2,values:[1,2]},
    {statId:203,kind:"series",minimum:4,maximum:8,values:[4,8]}], null);
  expect(rows[0].value).toBe("[Table: 4, 8] \u00b7 Talent name unavailable");
  expect(marketCatalogStatRows([{statId:99,kind:"dynamic",description:"Conditional amount"}],null)[0].value).toBe("[Conditional amount]");
  expect(marketCatalogStatRows([{statId:21,kind:"scalar",minimum:4,maximum:4}],null)[0]).toMatchObject({
    label:"Class selection",value:"Class name unavailable",
  });
});
