// @vitest-environment node
import { createRequire } from "node:module";
import https from "node:https";
import { expect, test, vi } from "vitest";

test("icon sync reads the unchanged rarity targets from JSON without network I/O", () => {
  const network = vi.spyOn(https, "get").mockImplementation(() => { throw new Error("Unexpected network request"); });
  const { readLocalTargetItems } = createRequire(import.meta.url)("../../scripts/sync-item-icons.js") as {
    readLocalTargetItems(): Map<string, string>;
  };
  const targets = readLocalTargetItems();
  // Literal counts from the original dev script's regex projection, before migration.
  expect(targets.size).toBe(922);
  expect([...targets.values()].reduce((counts, rarity) => {
    counts[rarity] = (counts[rarity] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>)).toEqual({ Set: 254, Satanic: 422, Heroic: 196, Angelic: 31, Unholy: 19 });
  expect(targets.get("death knight's gauntlets")).toBe("Heroic");
  expect(network).not.toHaveBeenCalled();
});
