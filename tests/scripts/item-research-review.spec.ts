import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  ACTIVE_ITEM_CATALOG_BUILD,
  createItemCatalogResolver,
  type ItemCatalogArtifact,
} from "../../src/shared/item-catalog";

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
        researchEntry({ repository: "unique", type: 4, id: 901, label: "Gloves #901", resolvedName: "Sunbite", localizationId: "gloves_sunbite", count: 2 }),
        researchEntry({ repository: "unique", type: 3, id: 0, weaponType: 1, label: "Sword #0", resolvedName: "Buriza-ko-nu" }),
        researchEntry({ repository: "unique", type: 3, id: 0, weaponType: 13, label: "Bow #0", resolvedName: "Buriza-ko-nu" }),
        researchEntry({ repository: "unique", type: 3, id: 902, weaponType: 1, label: "Sword #902", resolvedName: "First Name" }),
        researchEntry({ type: 3, id: 906, label: "Weapon #906", resolvedName: "Ambiguous Blade" }),
        researchEntry({ repository: "unique", type: 3, id: 907, weaponType: 7, label: "Chainsaw #907", resolvedName: "Safe Saw" }),
        researchEntry({ repository: "unique", type: 3, id: 908, weaponType: 1, label: "Sword #908", resolvedName: "Split Sword" }),
        researchEntry({ repository: "unique", type: 4, id: 910, label: "Gloves #910", resolvedName: "Unique Grip" }),
        researchEntry({ repository: "normal", type: 12, id: 0, label: "Key #0", resolvedName: "Basic Key" }),
        researchEntry({ repository: "normal", type: 4, id: 50, label: "Gloves #50", resolvedName: "Ali's Boxing Gloves" }),
        researchEntry({ repository: "normal", type: 1, id: 17, label: "Pirate Captain's Shirt", classification: "known-missing-icon" }),
        researchEntry({ repository: "normal", type: 13, id: 903, label: "Collectible #903", resolvedName: "" }),
        researchEntry({ repository: "unique", type: 1, id: 100, label: "Sharpshooter's Cloak", classification: "known-missing-icon" }),
      ],
    }), "utf8");
    fs.writeFileSync(secondPayload, JSON.stringify({
      app: "hero-siege-companion",
      kind: "item-research",
      version: 1,
      entries: [
        researchEntry({ repository: "unique", type: 4, id: 901, label: "Gloves #901", resolvedName: "Sunbite", localizationId: "gloves_sunbite", count: 1 }),
        researchEntry({ repository: "unique", type: 3, id: 902, weaponType: 1, label: "Sword #902", resolvedName: "Second Name" }),
        researchEntry({ repository: "unique", type: 3, id: 908, weaponType: 7, label: "Chainsaw #908", resolvedName: "Split Saw" }),
        researchEntry({ repository: "normal", type: 13, id: 904, label: "Collectible #904", resolvedName: "Material #904" }),
        researchEntry({ repository: "normal", type: 16, id: 909, label: "Relic #909", resolvedName: "Relic #909" }),
        researchEntry({ repository: "unique", type: 3, id: 0, label: "Weapon - Seed 123456", resolvedName: "Maybe Generated", classification: "generated-placeholder" }),
        researchEntry({ repository: "normal", type: 13, id: 905, label: "Collectible #905", resolvedName: "Hidden Fragment", ignored: true }),
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
      expect(markdown).toContain("Safe Saw");
      expect(markdown).toContain("Split Sword");
      expect(markdown).toContain("Split Saw");
      expect(markdown).toContain("Weapon subtype: 7");
      expect(markdown).toContain("## Already Known");
      expect(markdown).toContain("`unique:3:0:13:0`");
      expect(markdown).toContain("`normal:12:0:0:0`");
      expect(markdown).toContain("`normal:4:50:0:0`");
      expect(markdown).toContain("## Known Missing Icons");
      expect(markdown).toContain("Sharpshooter's Cloak");
      expect(markdown).toContain("Pirate Captain's Shirt");
      expect(markdown).toContain("resolved name still looks generic");
      expect(markdown).toContain("Relic #909");
      expect(markdown).toContain("generated placeholder");
      expect(markdown).toContain("ignored");
      expect(suggestions.suggestions.map((suggestion: { key: string }) => suggestion.key)).toEqual([
        "unique:3:907:7:0",
        "unique:3:908:1:0",
        "unique:3:908:7:0",
        "unique:4:901:0:0",
        "unique:4:910:0:0",
      ]);
      expect(suggestions.suggestions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: "unique:3:907:7:0",
          repository: "unique",
          weaponType: 7,
          resolvedName: "Safe Saw",
          suggestedLine: expect.stringContaining('repository: "unique"'),
        }),
        expect.objectContaining({
          key: "unique:4:910:0:0",
          repository: "unique",
          resolvedName: "Unique Grip",
          suggestedLine: expect.stringContaining('repository: "unique"'),
        }),
        expect.objectContaining({
          key: "unique:4:901:0:0",
          repository: "unique",
          weaponType: 0,
          resolvedName: "Sunbite",
          localizationIds: ["gloves_sunbite"],
          count: 3,
          target: "src/shared/item-lookup.ts",
          suggestedLine: expect.stringContaining('localizationId: "gloves_sunbite"'),
        }),
      ]));
      expect(suggestions.suggestions.filter((suggestion: { id: number }) => suggestion.id === 908)).toHaveLength(2);
      expect(markdown).toContain("`unknown:3:906:0:0`");
      expect(markdown).toMatch(/resolved name conflicts with (?:existing )?catalog identity: Godfather/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("models resolvable overrides and keeps non-normal stack research in manual review", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-research-review-resolvable-"));
    const payloadPath = path.join(tmpDir, "resolvable.json");
    fs.writeFileSync(payloadPath, JSON.stringify({
      app: "hero-siege-companion",
      kind: "item-research",
      version: 2,
      entries: [
        researchEntry({ repository: "unique", type: 7, id: 48, label: "Ring #48", resolvedName: "Dragon's Blessing" }),
        researchEntry({ repository: "unique", type: 7, id: 47, label: "Ring #47", resolvedName: "Scourge Loop" }),
        researchEntry({ repository: "unique", type: 7, id: 48, dropQuality: 1, label: "Ring #48", resolvedName: "Scourge Loop" }),
        researchEntry({ repository: "unique", type: 12, id: 999, label: "Key #999", resolvedName: "Unique Test Key" }),
        researchEntry({ repository: "normal", type: 17, id: 999, label: "Type 17 #999", resolvedName: "Type 17 #999" }),
        researchEntry({ repository: "unique", type: 3, id: 0, weaponType: 99, label: "Weapon Type 99 #0", resolvedName: "Weapon Type 99 #0" }),
      ],
    }), "utf8");

    try {
      const { buildResearchReview, readResearchFile, renderReviewMarkdown } = loadResearchReviewer();
      const review = buildResearchReview([readResearchFile(payloadPath)], {
        catalogResolver: itemResearchCatalogFixture(),
      });
      const markdown = renderReviewMarkdown(review);
      const suggestions = { suggestions: review.suggestions };

      expect(suggestions.suggestions).toEqual([
        expect.objectContaining({
          key: "unique:7:47:0:0",
          resolvedName: "Scourge Loop",
          existingNames: [],
          target: "src/shared/item-lookup.ts",
        }),
      ]);
      expect(markdown).toContain("`unique:7:48:0:0`");
      expect(markdown).toContain("Dragon's Blessing | Scourge Loop");
      expect(markdown).toContain("drop qualities resolve to conflicting names for one catalog identity");
      expect(markdown).toContain("Scourge Loop");
      expect(markdown).toContain("`unique:12:999:0:0`");
      expect(markdown).toContain("stack item repository requires manual review");
      expect(markdown).not.toContain("stack_unique_test_key");
      expect(markdown).toContain("resolved name still looks generic: `normal:17:999:0:0` Type 17 #999 -> Type 17 #999");
      expect(markdown).toContain("resolved name still looks generic: `unique:3:0:99:0` Weapon Type 99 #0 -> Weapon Type 99 #0");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("preserves manual-review boundaries for unresolved catalog candidates", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-research-review-quality-"));
    const payloadPath = path.join(tmpDir, "quality.json");
    fs.writeFileSync(payloadPath, JSON.stringify({
      app: "hero-siege-companion",
      kind: "item-research",
      version: 2,
      entries: [
        researchEntry({ repository: "normal", type: 12, id: 997, weaponType: 1, label: "Key #997", resolvedName: "Alpha Key" }),
        researchEntry({ repository: "normal", type: 12, id: 997, weaponType: 2, label: "Key #997", resolvedName: "Beta Key" }),
        researchEntry({ repository: "runeword", type: 4, id: 996, label: "Gloves #996", resolvedName: "Runic Grip" }),
        researchEntry({ repository: "unique", type: 4, id: 995, weaponType: 7, label: "Gloves #995", resolvedName: "Subtype Grip" }),
        researchEntry({ repository: "normal", type: 12, id: 1, label: "Key #1", resolvedName: "Replacement Crystal Key" }),
      ],
    }), "utf8");

    try {
      const { buildResearchReview, readResearchFile, renderReviewMarkdown } = loadResearchReviewer();
      const review = buildResearchReview([readResearchFile(payloadPath)], {
        catalogResolver: itemResearchCatalogFixture(),
      });
      const markdown = renderReviewMarkdown(review);
      const suggestions = { suggestions: review.suggestions };

      expect(suggestions.suggestions).toEqual([]);
      expect(markdown).toContain("stack item weapon subtype requires manual review");
      expect(markdown).toContain("runeword packet selector requires manual review");
      expect(markdown).toContain("non-weapon item subtype requires manual review");
      expect(markdown).toContain("resolved name conflicts with existing catalog identity: Crystal Key");
      expect(markdown).not.toContain("stack_alpha_key");
      expect(markdown).not.toContain("stack_beta_key");
      expect(markdown).not.toContain("research_runic_grip");
      expect(markdown).not.toContain("research_subtype_grip");
      expect(markdown).not.toContain("stack_replacement_crystal_key");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("uses catalog identity modes and never promotes rolled seeded names", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-research-review-catalog-"));
    const payloadPath = path.join(tmpDir, "catalog.json");
    fs.writeFileSync(payloadPath, JSON.stringify({
      app: "hero-siege-companion",
      kind: "item-research",
      version: 2,
      entries: [
        researchEntry({ repository: "normal", type: 10, id: 33, label: "Charm #33", resolvedName: "Mammoth Large Charm" }),
        researchEntry({ repository: "normal", type: 10, id: 34, label: "Charm #34", resolvedName: "Vigorous Large Charm" }),
        researchEntry({ repository: "normal", type: 10, id: 35, label: "Charm #35", resolvedName: "Titanic Large Charm" }),
        researchEntry({ repository: "normal", type: 10, id: 999, label: "Charm #999", resolvedName: "User Entered Rolled Name" }),
        researchEntry({ repository: "unique", type: 10, id: 90, label: "Charm #90", resolvedName: "Unknown Fixed Charm" }),
        researchEntry({ repository: "normal", type: 12, id: 777777, label: "Key #777777", resolvedName: "Unknown Stack Key" }),
        researchEntry({ repository: "runeword", type: 4, id: 888888, label: "Gloves #888888", resolvedName: "Unknown Runeword Gloves" }),
      ],
    }), "utf8");

    try {
      const { buildResearchReview, readResearchFile } = loadResearchReviewer();
      const review = buildResearchReview([readResearchFile(payloadPath)], {
        catalogResolver: itemResearchCatalogFixture(),
      });

      expect(review.suggestions).toHaveLength(2);
      expect(review.suggestions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          repository: "unique",
          type: 10,
          id: 90,
          resolvedName: "Unknown Fixed Charm",
        }),
        expect.objectContaining({
          repository: "normal",
          type: 12,
          id: 777777,
          resolvedName: "Unknown Stack Key",
        }),
      ]));
      expect(review.suggestions).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ repository: "normal", type: 10 }),
      ]));
      expect(review.noisyEntries.map((item) => item.entry.resolvedName)).toEqual(expect.arrayContaining([
        "Mammoth Large Charm",
        "Vigorous Large Charm",
        "Titanic Large Charm",
        "User Entered Rolled Name",
      ]));
      expect(review.noisyEntries.map((item) => item.reason).join(" | ")).toContain("seeded catalog");
      expect(review.conflicts.map((item) => item.reason)).toContain(
        "runeword packet selector requires manual review",
      );
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

interface ResearchReviewForTest {
  suggestions: Array<{
    key: string;
    repository: string;
    type: number;
    id: number;
    resolvedName: string;
    [field: string]: unknown;
  }>;
  noisyEntries: Array<{ entry: { resolvedName: string }; reason: string }>;
  conflicts: Array<{ reason: string }>;
  [field: string]: unknown;
}

function loadResearchReviewer() {
  const require = createRequire(import.meta.url);
  return require("../../scripts/review-item-research.js") as {
    buildResearchReview: (files: unknown[], options?: Record<string, unknown>) => ResearchReviewForTest;
    readResearchFile: (filePath: string) => unknown;
    renderReviewMarkdown: (review: ResearchReviewForTest) => string;
  };
}

function itemResearchCatalogFixture() {
  const sourceRef = "fixture-catalog-source";
  const artifact: ItemCatalogArtifact = {
    schemaVersion: 1,
    catalogId: "reviewer-policy-fixture",
    catalogStatus: "partial",
    provenance: {
      ...ACTIVE_ITEM_CATALOG_BUILD,
      source: "static-binary-analysis",
      extractorRevision: "reviewer-test-v1",
      extractorSha256: "1".repeat(64),
      configSha256: "2".repeat(64),
      stringInitializerTsvSha256: "3".repeat(64),
      stringInitializerManifestSha256: "4".repeat(64),
      translationBundleSha256: "5".repeat(64),
    },
    coverage: { activeConstructorCount: 1, accountedConstructorCount: 1 },
    sources: [{
      id: sourceRef,
      definitionFunction: "fixture_item_catalog",
      bodySha256: "B".repeat(64),
      definitionCount: 6,
      status: "extracted",
    }],
    domains: [
      {
        id: "normal-charms",
        repository: "normal",
        type: 10,
        weaponType: 0,
        defaultIdentityMode: "seeded",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [
          { gameId: 33, identityMode: "seeded" },
          { gameId: 34, identityMode: "seeded" },
          { gameId: 35, identityMode: "seeded" },
        ],
      },
      {
        id: "unique-charms",
        repository: "unique",
        type: 10,
        weaponType: 0,
        defaultIdentityMode: "fixed",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [{ gameId: 90, identityMode: "fixed" }],
      },
      {
        id: "normal-keys",
        repository: "normal",
        type: 12,
        weaponType: 0,
        defaultIdentityMode: "stack",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [{ gameId: 777777, identityMode: "stack" }],
      },
      {
        id: "runewords",
        repository: "runeword",
        type: 3,
        weaponType: 0,
        defaultIdentityMode: "runeword",
        status: "partial",
        sourceRefs: [sourceRef],
        expectedItems: [{ gameId: 888888, identityMode: "runeword" }],
      },
    ],
    definitions: [{
      repository: "normal",
      type: 10,
      gameId: 33,
      weaponType: 0,
      identityMode: "seeded",
      baseLocalizationId: "large_charm",
      baseName: "Large Charm",
      provenanceRef: sourceRef,
    }],
    missing: [
      {
        repository: "normal",
        type: 10,
        gameId: 34,
        weaponType: 0,
        expectedIdentityMode: "seeded",
        reason: "fixture missing seeded row",
        sourceRefs: [sourceRef],
      },
      {
        repository: "unique",
        type: 10,
        gameId: 90,
        weaponType: 0,
        expectedIdentityMode: "fixed",
        reason: "fixture missing fixed row",
        sourceRefs: [sourceRef],
      },
      {
        repository: "normal",
        type: 12,
        gameId: 777777,
        weaponType: 0,
        expectedIdentityMode: "stack",
        reason: "fixture missing stack row",
        sourceRefs: [sourceRef],
      },
      {
        repository: "runeword",
        type: 3,
        gameId: 888888,
        weaponType: 0,
        expectedIdentityMode: "runeword",
        reason: "fixture missing runeword row",
        sourceRefs: [sourceRef],
      },
    ],
    quarantine: [{
      repository: "normal",
      type: 10,
      gameId: 35,
      weaponType: 0,
      expectedIdentityMode: "seeded",
      reason: "fixture same-mode collision",
      candidates: [
        { identityMode: "seeded", provenanceRef: sourceRef, baseLocalizationId: "large_charm_a", baseName: "Large Charm A" },
        { identityMode: "seeded", provenanceRef: sourceRef, baseLocalizationId: "large_charm_b", baseName: "Large Charm B" },
      ],
    }],
  };
  return createItemCatalogResolver(artifact);
}
