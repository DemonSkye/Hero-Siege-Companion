import { describe, expect, test } from "vitest";

import {
  ACTIVE_ITEM_CATALOG_BUILD,
  activeItemCatalog,
  canonicalItemCatalogKey,
  createItemCatalogResolver,
  requiresItemIdentification,
  type ItemCatalogArtifact,
  type ItemCatalogResolution,
} from "../../src/shared/item-catalog";

const SOURCE_ID = "fixture-constructor";
const ZERO_DEFINITION_SOURCE_ID = "fixture-zero-definition-constructor";
const FIXTURE_PROVENANCE_HASHES = {
  extractorSha256: "1".repeat(64),
  configSha256: "2".repeat(64),
  stringInitializerTsvSha256: "3".repeat(64),
  stringInitializerManifestSha256: "4".repeat(64),
  translationBundleSha256: "5".repeat(64),
};

const FIXTURE_ARTIFACT: ItemCatalogArtifact = {
  schemaVersion: 1,
  catalogId: "catalog-resolver-fixture",
  catalogStatus: "partial",
  provenance: {
    ...ACTIVE_ITEM_CATALOG_BUILD,
    source: "static-binary-analysis",
    extractorRevision: "catalog-resolver-test-v1",
    ...FIXTURE_PROVENANCE_HASHES,
  },
  coverage: {
    activeConstructorCount: 2,
    accountedConstructorCount: 2,
  },
  sources: [
    {
      id: SOURCE_ID,
      definitionFunction: "gml_Script_TestItemCatalog",
      bodySha256: "A".repeat(64),
      definitionCount: 11,
      status: "extracted",
    },
    {
      id: ZERO_DEFINITION_SOURCE_ID,
      definitionFunction: "gml_Script_DefineItemNormalGlyph",
      bodySha256: "B".repeat(64),
      definitionCount: 0,
      status: "zero-definitions-proved",
    },
  ],
  domains: [
    {
      id: "normal-charms",
      repository: "normal",
      type: 10,
      weaponType: 0,
      defaultIdentityMode: "seeded",
      status: "partial",
      sourceRefs: [SOURCE_ID],
      expectedItems: [
        { gameId: 33, identityMode: "seeded" },
        { gameId: 34, identityMode: "fixed" },
        { gameId: 35, identityMode: "seeded" },
        { gameId: 36, identityMode: "fixed" },
        { gameId: 37, identityMode: "seeded" },
        { gameId: 38, identityMode: "fixed" },
      ],
    },
    {
      id: "unique-charms",
      repository: "unique",
      type: 10,
      weaponType: 0,
      defaultIdentityMode: "fixed",
      status: "complete",
      sourceRefs: [SOURCE_ID],
      expectedItems: [{ gameId: 33, identityMode: "fixed" }],
    },
    {
      id: "normal-keys",
      repository: "normal",
      type: 12,
      weaponType: 0,
      defaultIdentityMode: "stack",
      status: "partial",
      sourceRefs: [SOURCE_ID],
      expectedItems: [
        { gameId: 0, identityMode: "stack" },
        { gameId: 1, identityMode: "stack" },
      ],
    },
    {
      id: "sword-runewords",
      repository: "runeword",
      type: 3,
      weaponType: 0,
      defaultIdentityMode: "runeword",
      status: "partial",
      sourceRefs: [SOURCE_ID],
      expectedItems: [
        { gameId: 1, identityMode: "runeword" },
        { gameId: 2, identityMode: "runeword" },
      ],
    },
  ],
  definitions: [
    {
      repository: "normal",
      type: 10,
      gameId: 33,
      weaponType: 0,
      identityMode: "seeded",
      baseLocalizationId: "charms_normal_large_charm",
      baseName: "Large Charm",
      provenanceRef: SOURCE_ID,
    },
    {
      repository: "normal",
      type: 10,
      gameId: 34,
      weaponType: 0,
      identityMode: "fixed",
      localizationId: "charms_normal_fixed_fixture",
      name: "Fixed Normal Charm",
      provenanceRef: SOURCE_ID,
    },
    {
      repository: "unique",
      type: 10,
      gameId: 33,
      weaponType: 0,
      identityMode: "fixed",
      localizationId: "charms_bag_of_unknown_riches",
      name: "Bag of Unknown Riches",
      provenanceRef: SOURCE_ID,
    },
    {
      repository: "normal",
      type: 12,
      gameId: 0,
      weaponType: 0,
      identityMode: "stack",
      localizationId: "stack_basic_key",
      name: "Basic Key",
      provenanceRef: SOURCE_ID,
    },
    {
      repository: "runeword",
      type: 3,
      gameId: 1,
      weaponType: 0,
      identityMode: "runeword",
      localizationId: "runeword_sword_fixture",
      name: "Fixture Runeword",
      provenanceRef: SOURCE_ID,
    },
  ],
  missing: [
    {
      repository: "normal",
      type: 10,
      gameId: 35,
      weaponType: 0,
      expectedIdentityMode: "seeded",
      reason: "seeded base extraction pending",
      sourceRefs: [SOURCE_ID],
    },
    {
      repository: "normal",
      type: 10,
      gameId: 36,
      weaponType: 0,
      expectedIdentityMode: "fixed",
      localizationId: "charms_normal_fixed_fixture_missing_translation",
      reason: "fixed name extraction pending",
      sourceRefs: [SOURCE_ID],
    },
    {
      repository: "normal",
      type: 12,
      gameId: 1,
      weaponType: 0,
      expectedIdentityMode: "stack",
      reason: "stack name extraction pending",
      sourceRefs: [SOURCE_ID],
    },
    {
      repository: "runeword",
      type: 3,
      gameId: 2,
      weaponType: 0,
      expectedIdentityMode: "runeword",
      reason: "runeword name extraction pending",
      sourceRefs: [SOURCE_ID],
    },
  ],
  quarantine: [
    {
      repository: "normal",
      type: 10,
      gameId: 37,
      weaponType: 0,
      expectedIdentityMode: "seeded",
      reason: "two same-mode base candidates",
      candidates: [
        {
          identityMode: "seeded",
          baseLocalizationId: "charms_normal_large_charm",
          baseName: "Large Charm",
          provenanceRef: SOURCE_ID,
        },
        {
          identityMode: "seeded",
          baseLocalizationId: "charms_normal_grand_charm",
          baseName: "Grand Charm",
          provenanceRef: SOURCE_ID,
        },
      ],
    },
    {
      repository: "normal",
      type: 10,
      gameId: 38,
      weaponType: 0,
      expectedIdentityMode: "fixed",
      reason: "two same-mode fixed candidates",
      candidates: [
        {
          identityMode: "fixed",
          localizationId: "fixture_fixed_a",
          name: "Fixture Fixed A",
          provenanceRef: SOURCE_ID,
        },
        {
          identityMode: "fixed",
          localizationId: "fixture_fixed_b",
          name: "Fixture Fixed B",
          provenanceRef: SOURCE_ID,
        },
      ],
    },
  ],
};

function fixtureResolver() {
  return createItemCatalogResolver(structuredClone(FIXTURE_ARTIFACT));
}

function resolution(
  repository: "normal" | "unique" | "runeword",
  type: number,
  gameId: number,
  weaponType = 0,
): ItemCatalogResolution {
  return fixtureResolver().resolve({ repository, type, gameId, weaponType });
}

describe("build-versioned item catalog resolver", () => {
  test("ships the fully accounted build catalog while retaining explicit untranslated fixed rows", () => {
    expect(activeItemCatalog.artifact.catalogStatus).toBe("partial");
    expect(activeItemCatalog.artifact.provenance).toEqual(expect.objectContaining(ACTIVE_ITEM_CATALOG_BUILD));
    expect(activeItemCatalog.artifact.coverage).toEqual({
      activeConstructorCount: 63,
      accountedConstructorCount: 63,
    });
    expect(activeItemCatalog.allDefinitions()).toHaveLength(2011);
    expect(activeItemCatalog.artifact.missing).toHaveLength(24);
    expect(activeItemCatalog.resolve({ repository: "normal", type: 10, gameId: 33 })).toEqual(
      expect.objectContaining({
        status: "resolved",
        definition: expect.objectContaining({ identityMode: "seeded", baseName: "Large Charm" }),
      }),
    );
  });

  test("keeps every seeded definition and seeded out-of-range key out of Identify across all seeded domains", () => {
    const seededDefinitions = activeItemCatalog.artifact.definitions.filter(
      (definition) => definition.identityMode === "seeded",
    );
    expect(seededDefinitions).toHaveLength(423);
    for (const definition of seededDefinitions) {
      expect(requiresItemIdentification(activeItemCatalog.resolve(definition))).toBe(false);
    }
    const seededDomains = activeItemCatalog.artifact.domains.filter(
      (domain) => domain.defaultIdentityMode === "seeded",
    );
    expect(seededDomains.length).toBeGreaterThan(1);
    for (const domain of seededDomains) {
      const outOfRange = Math.max(-1, ...domain.expectedItems.map((item) => item.gameId)) + 1_000_000;
      const resolution = activeItemCatalog.resolve({
        repository: domain.repository,
        type: domain.type,
        gameId: outOfRange,
        weaponType: domain.weaponType,
      });
      expect(resolution.status).toBe("out-of-range");
      expect(requiresItemIdentification(resolution)).toBe(false);
    }
  });

  test("canonicalizes non-weapons and global runeword ordinals while preserving ordinary weapon subtype", () => {
    expect(canonicalItemCatalogKey({ repository: "normal", type: 10, gameId: 33, weaponType: 7 })).toEqual({
      repository: "normal",
      type: 10,
      gameId: 33,
      weaponType: 0,
    });
    expect(canonicalItemCatalogKey({ repository: "runeword", type: 0, gameId: 1, weaponType: 7 })).toEqual({
      repository: "runeword",
      type: 3,
      gameId: 1,
      weaponType: 0,
    });
    expect(canonicalItemCatalogKey({ repository: "normal", type: 3, gameId: 1, weaponType: 7 })?.weaponType).toBe(7);
  });

  test("separates the c0 seeded charm from the same-ordinal c1 fixed charm", () => {
    const normal = resolution("normal", 10, 33);
    const unique = resolution("unique", 10, 33);

    expect(normal).toEqual(expect.objectContaining({
      status: "resolved",
      definition: expect.objectContaining({ identityMode: "seeded", baseName: "Large Charm" }),
    }));
    expect(unique).toEqual(expect.objectContaining({
      status: "resolved",
      definition: expect.objectContaining({ identityMode: "fixed", name: "Bag of Unknown Riches" }),
    }));
  });

  test("never requests identification for any resolved identity mode", () => {
    const resolved = [
      resolution("normal", 10, 33),
      resolution("normal", 10, 34),
      resolution("normal", 12, 0),
      resolution("runeword", 3, 1, 7),
    ];
    expect(resolved.map(requiresItemIdentification)).toEqual([false, false, false, false]);
  });

  test("uses each missing key's expected mode instead of the mixed-domain default", () => {
    const seeded = resolution("normal", 10, 35);
    const fixed = resolution("normal", 10, 36);
    const stack = resolution("normal", 12, 1);
    const runeword = resolution("runeword", 1, 2, 0);

    expect([seeded.status, fixed.status, stack.status, runeword.status]).toEqual(["missing", "missing", "missing", "missing"]);
    expect(fixed).toEqual(expect.objectContaining({
      missing: expect.objectContaining({
        localizationId: "charms_normal_fixed_fixture_missing_translation",
      }),
    }));
    expect([seeded, fixed, stack, runeword].map(requiresItemIdentification)).toEqual([false, true, true, true]);
  });

  test("uses each quarantined key's expected mode and keeps cross-name collisions explicit", () => {
    const seeded = resolution("normal", 10, 37);
    const fixed = resolution("normal", 10, 38);

    expect(seeded).toEqual(expect.objectContaining({ status: "quarantined", expectedIdentityMode: "seeded" }));
    expect(fixed).toEqual(expect.objectContaining({ status: "quarantined", expectedIdentityMode: "fixed" }));
    expect(requiresItemIdentification(seeded)).toBe(false);
    expect(requiresItemIdentification(fixed)).toBe(true);
  });

  test("uses the domain default only for out-of-range keys", () => {
    const seeded = resolution("normal", 10, 99);
    const fixed = resolution("unique", 10, 99);
    const stack = resolution("normal", 12, 99);
    const runeword = resolution("runeword", 2, 99, 0);

    expect([seeded.status, fixed.status, stack.status, runeword.status]).toEqual([
      "out-of-range",
      "out-of-range",
      "out-of-range",
      "out-of-range",
    ]);
    expect([seeded, fixed, stack, runeword].map(requiresItemIdentification)).toEqual([false, true, true, true]);
  });

  test("keeps unclassified identities researchable and ordinary weapon subtype strict", () => {
    const unknownDomain = resolution("normal", 16, 0);
    const wrongWeaponSubtype = resolution("normal", 3, 1, 2);
    expect(unknownDomain).toEqual(expect.objectContaining({ status: "unclassified", reason: "no-domain" }));
    expect(wrongWeaponSubtype).toEqual(expect.objectContaining({ status: "unclassified", reason: "no-domain" }));
    expect(requiresItemIdentification(unknownDomain)).toBe(true);
    expect(requiresItemIdentification(wrongWeaponSubtype)).toBe(true);
  });

  test("rejects an artifact for any executable build or SHA mismatch", () => {
    const invalid = structuredClone(FIXTURE_ARTIFACT);
    invalid.provenance.executableSha256 = "B".repeat(64);
    expect(() => createItemCatalogResolver(invalid)).toThrow(/provenance\.executableSha256 does not match/);
  });

  test("requires structured SHA-256 provenance and reserves zero placeholders for the empty shell", () => {
    for (const field of [
      "extractorSha256",
      "configSha256",
      "stringInitializerTsvSha256",
      "stringInitializerManifestSha256",
      "translationBundleSha256",
    ] as const) {
      const invalid = structuredClone(FIXTURE_ARTIFACT);
      invalid.provenance[field] = "not-a-sha";
      expect(() => createItemCatalogResolver(invalid)).toThrow(
        new RegExp(`provenance\\.${field} must be a 64-character SHA-256`),
      );
    }

    const populatedWithPlaceholder = structuredClone(FIXTURE_ARTIFACT);
    populatedWithPlaceholder.provenance.extractorSha256 = "0".repeat(64);
    expect(() => createItemCatalogResolver(populatedWithPlaceholder)).toThrow(
      /zero SHA-256 provenance placeholders are allowed only for the empty partial catalog shell/,
    );
  });

  test("accounts for extracted and active zero-definition constructor sources", () => {
    const artifact = fixtureResolver().artifact;
    expect(artifact.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: SOURCE_ID,
        definitionCount: 11,
        status: "extracted",
      }),
      expect.objectContaining({
        id: ZERO_DEFINITION_SOURCE_ID,
        definitionFunction: "gml_Script_DefineItemNormalGlyph",
        definitionCount: 0,
        status: "zero-definitions-proved",
      }),
    ]));
    expect(artifact.domains.flatMap((domain) => domain.sourceRefs)).not.toContain(ZERO_DEFINITION_SOURCE_ID);
  });

  test("rejects unreconciled constructor source coverage", () => {
    const wrongSourceCount = structuredClone(FIXTURE_ARTIFACT);
    wrongSourceCount.coverage.accountedConstructorCount = 1;
    expect(() => createItemCatalogResolver(wrongSourceCount)).toThrow(
      /sources length must equal coverage\.accountedConstructorCount/,
    );

    const wrongDefinitionTotal = structuredClone(FIXTURE_ARTIFACT);
    wrongDefinitionTotal.sources[0].definitionCount = 10;
    expect(() => createItemCatalogResolver(wrongDefinitionTotal)).toThrow(
      /summed source definitionCount must equal total declared domain expectedItems/,
    );

    const referencedZeroDefinition = structuredClone(FIXTURE_ARTIFACT);
    referencedZeroDefinition.domains[0].sourceRefs = [SOURCE_ID, ZERO_DEFINITION_SOURCE_ID];
    expect(() => createItemCatalogResolver(referencedZeroDefinition)).toThrow(
      /zero-definitions-proved source cannot be referenced by a domain/,
    );

    const unreferencedExtracted = structuredClone(FIXTURE_ARTIFACT);
    unreferencedExtracted.sources[1].status = "extracted";
    unreferencedExtracted.sources[1].definitionCount = 1;
    expect(() => createItemCatalogResolver(unreferencedExtracted)).toThrow(
      /extracted source must be referenced by a domain/,
    );
  });

  test("validates source status/count shape and optional missing localization IDs", () => {
    const invalidZeroSource = structuredClone(FIXTURE_ARTIFACT);
    invalidZeroSource.sources[1].definitionCount = 1;
    expect(() => createItemCatalogResolver(invalidZeroSource)).toThrow(
      /zero-definitions-proved source must have definitionCount 0/,
    );

    const invalidExtractedSource = structuredClone(FIXTURE_ARTIFACT);
    invalidExtractedSource.sources[0].definitionCount = 0;
    expect(() => createItemCatalogResolver(invalidExtractedSource)).toThrow(
      /extracted source must have a positive definitionCount/,
    );

    const invalidLocalization = structuredClone(FIXTURE_ARTIFACT);
    invalidLocalization.missing[1].localizationId = "";
    expect(() => createItemCatalogResolver(invalidLocalization)).toThrow(
      /missing\[1\]\.localizationId must be a non-empty string when present/,
    );
  });

  test("requires every expected key to resolve, be missing, or be quarantined", () => {
    const invalid = structuredClone(FIXTURE_ARTIFACT);
    invalid.missing = invalid.missing.filter((entry) => entry.gameId !== 35);
    expect(() => createItemCatalogResolver(invalid)).toThrow(/normal:10:0:35 must appear in exactly one resolution set/);
  });

  test("hard-fails same-key definitions with conflicting identity modes", () => {
    const invalid = structuredClone(FIXTURE_ARTIFACT);
    invalid.definitions.push({
      repository: "normal",
      type: 10,
      gameId: 33,
      weaponType: 0,
      identityMode: "fixed",
      localizationId: "bad_cross_mode",
      name: "Bad Cross Mode",
      provenanceRef: SOURCE_ID,
    });
    expect(() => createItemCatalogResolver(invalid)).toThrow(/cross-mode duplicate definition key normal:10:0:33/);
  });

  test("hard-fails a quarantine that mixes fixed and seeded interpretations", () => {
    const invalid = structuredClone(FIXTURE_ARTIFACT);
    invalid.quarantine[0].candidates[1] = {
      identityMode: "fixed",
      localizationId: "bad_cross_mode",
      name: "Bad Cross Mode",
      provenanceRef: SOURCE_ID,
    };
    expect(() => createItemCatalogResolver(invalid)).toThrow(/forbidden cross-mode quarantine/);
  });

  test("rejects a complete-catalog claim while constructor or identity gaps remain", () => {
    const invalid = structuredClone(FIXTURE_ARTIFACT);
    invalid.catalogStatus = "complete";
    expect(() => createItemCatalogResolver(invalid)).toThrow(/complete catalog cannot contain partial domains/);
    expect(() => createItemCatalogResolver(invalid)).toThrow(/complete catalog cannot contain missing or quarantined identities/);
  });
});
