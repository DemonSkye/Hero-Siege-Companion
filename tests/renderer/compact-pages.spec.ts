import { ref } from "vue";
import { describe, expect, test } from "vitest";
import {
  COMPACT_PAGE_LIMIT,
  defaultCompactNavigation,
  defaultCompactPages,
  normalizeCompactNavigation,
  normalizeCompactPages,
} from "../../src/renderer/src/lib/compact-pages";
import { useCompactPager } from "../../src/renderer/src/lib/compact-pager";
import { defaultCompactRunTiles } from "../../src/renderer/src/lib/compact-tiles";

const kinds = (pages: ReturnType<typeof normalizeCompactPages>) => pages.map((page) => [page.name, page.kind, page.tiles.map((tile) => tile.kind)]);

describe("compact pages", () => {
  test("migrates the old default tile list to the default pages and custom lists to Run pages plus a zone page", () => {
    expect(normalizeCompactPages(undefined, defaultCompactRunTiles)).toEqual(defaultCompactPages);
    expect(normalizeCompactPages(undefined, undefined)).toEqual(defaultCompactPages);
    const legacy = ["duration", "gold", "keys", "ores", "materials", "set"].map((kind) => ({ id: kind, kind }));
    expect(kinds(normalizeCompactPages(undefined, legacy))).toEqual([
      ["Run", "tiles", ["duration", "gold", "keys", "ores"]],
      ["Run 2", "tiles", ["materials", "set"]],
      ["Satanic Zone", "zone", []],
    ]);
  });

  test("bounds pages and tiles, drops duplicate standard tiles in a page, and fixes names and ids", () => {
    const tile = (kind: string) => ({ id: kind, kind });
    const pages = normalizeCompactPages([
      { id: "a", name: "  Very   long page name that keeps going ", kind: "tiles", tiles: ["gold", "gold", "xp", "kills", "keys", "ores"].map(tile) },
      { id: "a", name: "", kind: "zone", tiles: [tile("gold")] },
      { id: "c", name: "Bad", kind: "tiles", tiles: [tile("unknown"), { kind: "custom", source: "item", itemName: " Mystic  Soles ", label: "Soles" }] },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `x${index}`, name: `Extra ${index}`, kind: "tiles", tiles: [] })),
    ]);
    expect(pages).toHaveLength(COMPACT_PAGE_LIMIT);
    expect(pages[0]).toMatchObject({ id: "a", name: "Very long page name", kind: "tiles" });
    expect(pages[0].tiles.map((item) => item.kind)).toEqual(["gold", "xp", "kills", "keys"]);
    expect(pages[1]).toMatchObject({ id: "zone", name: "Satanic Zone", kind: "zone", tiles: [] });
    expect(pages[2].tiles).toEqual([expect.objectContaining({ kind: "custom", source: "item", itemName: "Mystic Soles" })]);
    expect(normalizeCompactPages([])).toEqual(defaultCompactPages);
  });

  test("navigation defaults to every input and keeps saved choices", () => {
    expect(normalizeCompactNavigation(null)).toEqual(defaultCompactNavigation);
    expect(normalizeCompactNavigation({ wheel: false, wrap: "yes" })).toEqual({ ...defaultCompactNavigation, wheel: false });
  });
});

describe("compact pager", () => {
  const key = (value: string, target: EventTarget | null = null) => ({ key: value, target, preventDefault: () => undefined });
  const wheel = (deltaY: number) => ({ deltaY, target: null, currentTarget: null, preventDefault: () => undefined });

  test("steps, wraps and respects disabled inputs", () => {
    const navigation = ref({ ...defaultCompactNavigation });
    const pager = useCompactPager(ref(3), navigation);
    pager.onKeydown(key("PageDown"));
    pager.onKeydown(key("ArrowDown"));
    expect(pager.index.value).toBe(2);
    pager.onKeydown(key("ArrowRight"));
    expect(pager.index.value).toBe(0);
    expect(pager.direction.value).toBe(1);
    pager.onKeydown(key("End"));
    expect(pager.index.value).toBe(2);
    navigation.value = { ...navigation.value, wrap: false, pageKeys: false };
    pager.onKeydown(key("ArrowDown"));
    pager.onKeydown(key("PageUp"));
    expect(pager.index.value).toBe(2);
    const input = document.createElement("input");
    pager.onKeydown(key("ArrowUp", input));
    expect(pager.index.value).toBe(2);
  });

  test("turns one page per wheel gesture and ignores small trackpad deltas until they add up", () => {
    let now = 1_000;
    const pager = useCompactPager(ref(3), ref({ ...defaultCompactNavigation }), () => now);
    pager.onWheel(wheel(15));
    expect(pager.index.value).toBe(0);
    now += 20; pager.onWheel(wheel(30));
    expect(pager.index.value).toBe(1);
    now += 50; pager.onWheel(wheel(120));
    expect(pager.index.value).toBe(1);
    now += 400; pager.onWheel(wheel(-120));
    expect(pager.index.value).toBe(0);
    expect(pager.direction.value).toBe(-1);
  });

  test("clamps when pages are removed", async () => {
    const count = ref(3);
    const pager = useCompactPager(count, ref({ ...defaultCompactNavigation }));
    pager.go(2);
    count.value = 1;
    expect(pager.index.value).toBe(0);
  });
});
