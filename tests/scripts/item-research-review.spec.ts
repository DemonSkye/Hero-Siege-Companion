import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("item research review script", () => {
  test("groups exports, flags conflicts/noise, and writes suggestions", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-research-review-"));
    const firstPayload = path.join(tmpDir, "first.json");
    const secondPayload = path.join(tmpDir, "second.json");
    const outDir = path.join(tmpDir, "out");
    fs.writeFileSync(firstPayload, JSON.stringify({
      app: "hero-siege-companion",
      kind: "item-research",
      version: 1,
      entries: [
        researchEntry({ type: 4, id: 901, label: "Gloves #901", resolvedName: "Sunbite", count: 2 }),
        researchEntry({ type: 3, id: 902, label: "Weapon #902", resolvedName: "First Name" }),
        researchEntry({ type: 3, id: 906, label: "Weapon #906", resolvedName: "Ambiguous Blade" }),
        researchEntry({ type: 13, id: 903, label: "Collectible #903", resolvedName: "" }),
        researchEntry({ type: 1, id: 100, label: "Sharpshooter's Cloak", classification: "known-missing-icon" }),
      ],
    }), "utf8");
    fs.writeFileSync(secondPayload, JSON.stringify({
      app: "hero-siege-companion",
      kind: "item-research",
      version: 1,
      entries: [
        researchEntry({ type: 4, id: 901, label: "Gloves #901", resolvedName: "Sunbite", count: 1 }),
        researchEntry({ type: 3, id: 902, label: "Weapon #902", resolvedName: "Second Name" }),
        researchEntry({ type: 13, id: 904, label: "Collectible #904", resolvedName: "Material #904" }),
        researchEntry({ type: 3, id: 0, label: "Weapon - Seed 123456", resolvedName: "Maybe Generated", classification: "generated-placeholder" }),
        researchEntry({ type: 13, id: 905, label: "Collectible #905", resolvedName: "Hidden Fragment", ignored: true }),
      ],
    }), "utf8");

    try {
      const scriptPath = path.resolve(process.cwd(), "scripts", "review-item-research.js");
      const output = execFileSync(process.execPath, [scriptPath, "--out-dir", outDir, firstPayload, secondPayload], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const markdown = fs.readFileSync(path.join(outDir, "item-research-review.md"), "utf8");
      const suggestions = JSON.parse(fs.readFileSync(path.join(outDir, "item-research-suggestions.json"), "utf8"));

      expect(output).toContain("item-research-review.md");
      expect(markdown).toContain("## Suggested Lookup Changes");
      expect(markdown).toContain("Sunbite");
      expect(markdown).toContain("## Conflicts");
      expect(markdown).toContain("First Name | Second Name");
      expect(markdown).toContain("weapon type requires manual review");
      expect(markdown).toContain("Ambiguous Blade");
      expect(markdown).toContain("## Known Missing Icons");
      expect(markdown).toContain("Sharpshooter's Cloak");
      expect(markdown).toContain("resolved name still looks generic");
      expect(markdown).toContain("generated placeholder");
      expect(markdown).toContain("ignored");
      expect(suggestions.suggestions).toEqual([
        expect.objectContaining({
          key: "4:901:0",
          resolvedName: "Sunbite",
          count: 3,
          target: "src/shared/item-lookup.ts",
        }),
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function researchEntry(overrides: Record<string, unknown>) {
  return {
    signature: `${overrides.type}:${overrides.id}:0:${String(overrides.label).toLowerCase()}`,
    label: "Item #0",
    resolvedName: "",
    rarity: "Satanic",
    type: 0,
    id: 0,
    dropQuality: 0,
    count: 1,
    firstSeenAt: "2026-05-23T12:00:00.000Z",
    lastSeenAt: "2026-05-23T12:05:00.000Z",
    notes: "",
    ...overrides,
  };
}
