import { ITEM_CATALOG_BUILD_24868792_DATA } from "./data/item-catalog-build-24868792";

export const ITEM_CATALOG_SCHEMA_VERSION = 1 as const;

export const ACTIVE_ITEM_CATALOG_BUILD = {
  steamAppId: 269_210,
  steamBuild: 24_868_792,
  executableVersion: "7.0.0.0",
  executableSha256: "BA72B95AC10785D0ECDCC2B3D1925D6CB3439EFAF4CEF9DE2EA1F67D6CFDD4DF",
} as const;

const EMPTY_SHA256 = "0".repeat(64);
const PROVENANCE_INPUT_HASH_FIELDS = [
  "extractorSha256",
  "configSha256",
  "stringInitializerTsvSha256",
  "stringInitializerManifestSha256",
  "translationBundleSha256",
] as const;

export type ItemRepository = "normal" | "unique" | "runeword";

// Identity mode describes whether the display name is deterministic. It does
// not claim that stats, sockets, tiers, or other instance fields are fixed.
export type ItemIdentityMode = "fixed" | "seeded" | "stack" | "runeword";
export type ItemCatalogStatus = "partial" | "complete";
export type ItemCatalogDomainStatus = "partial" | "complete";

export interface ItemCatalogKeyInput {
  repository: ItemRepository;
  type: number;
  // `gameId` is the serialized definition ordinal `b`.
  gameId: number;
  weaponType?: number;
}

export interface ItemCatalogKey {
  repository: ItemRepository;
  type: number;
  gameId: number;
  weaponType: number;
}

export interface ItemCatalogBuildProvenance {
  steamAppId: number;
  steamBuild: number;
  executableVersion: string;
  executableSha256: string;
  source: "static-binary-analysis";
  extractorRevision: string;
  extractorSha256: string;
  configSha256: string;
  stringInitializerTsvSha256: string;
  stringInitializerManifestSha256: string;
  translationBundleSha256: string;
}

export type ItemCatalogSourceStatus = "extracted" | "zero-definitions-proved";

export interface ItemCatalogSource {
  id: string;
  definitionFunction: string;
  bodySha256: string;
  definitionCount: number;
  status: ItemCatalogSourceStatus;
}

export interface ItemCatalogExpectedItem {
  gameId: number;
  identityMode: ItemIdentityMode;
}

export interface ItemCatalogDomain {
  id: string;
  repository: ItemRepository;
  type: number;
  weaponType: number;
  defaultIdentityMode: ItemIdentityMode;
  status: ItemCatalogDomainStatus;
  sourceRefs: readonly string[];
  expectedItems: readonly ItemCatalogExpectedItem[];
}

interface ItemCatalogDefinitionBase extends ItemCatalogKey {
  provenanceRef: string;
}

export interface FixedItemCatalogDefinition extends ItemCatalogDefinitionBase {
  identityMode: "fixed";
  localizationId: string;
  name: string;
}

export interface SeededItemCatalogDefinition extends ItemCatalogDefinitionBase {
  identityMode: "seeded";
  baseLocalizationId: string;
  baseName: string;
}

export interface StackItemCatalogDefinition extends ItemCatalogDefinitionBase {
  identityMode: "stack";
  localizationId: string;
  name: string;
}

export interface RunewordItemCatalogDefinition extends ItemCatalogDefinitionBase {
  identityMode: "runeword";
  localizationId: string;
  name: string;
}

export type ItemCatalogDefinition =
  | FixedItemCatalogDefinition
  | SeededItemCatalogDefinition
  | StackItemCatalogDefinition
  | RunewordItemCatalogDefinition;

export interface MissingItemCatalogDefinition extends ItemCatalogKey {
  expectedIdentityMode: ItemIdentityMode;
  localizationId?: string;
  reason: string;
  sourceRefs: readonly string[];
}

export interface ItemCatalogQuarantineCandidate {
  identityMode: ItemIdentityMode;
  provenanceRef: string;
  localizationId?: string;
  name?: string;
  baseLocalizationId?: string;
  baseName?: string;
}

export interface QuarantinedItemCatalogDefinition extends ItemCatalogKey {
  expectedIdentityMode: ItemIdentityMode;
  reason: string;
  candidates: readonly ItemCatalogQuarantineCandidate[];
}

export interface ItemCatalogArtifact {
  schemaVersion: typeof ITEM_CATALOG_SCHEMA_VERSION;
  catalogId: string;
  catalogStatus: ItemCatalogStatus;
  provenance: ItemCatalogBuildProvenance;
  coverage: {
    activeConstructorCount: number;
    accountedConstructorCount: number;
  };
  sources: readonly ItemCatalogSource[];
  domains: readonly ItemCatalogDomain[];
  definitions: readonly ItemCatalogDefinition[];
  missing: readonly MissingItemCatalogDefinition[];
  quarantine: readonly QuarantinedItemCatalogDefinition[];
}

export type ItemCatalogResolution =
  | {
      status: "resolved";
      key: ItemCatalogKey;
      domain: ItemCatalogDomain;
      definition: ItemCatalogDefinition;
    }
  | {
      status: "missing";
      key: ItemCatalogKey;
      domain: ItemCatalogDomain;
      expectedIdentityMode: ItemIdentityMode;
      missing: MissingItemCatalogDefinition;
    }
  | {
      status: "quarantined";
      key: ItemCatalogKey;
      domain: ItemCatalogDomain;
      expectedIdentityMode: ItemIdentityMode;
      quarantine: QuarantinedItemCatalogDefinition;
    }
  | {
      status: "out-of-range";
      key: ItemCatalogKey;
      domain: ItemCatalogDomain;
      expectedIdentityMode: ItemIdentityMode;
    }
  | {
      status: "unclassified";
      key: ItemCatalogKey | null;
      reason: "invalid-key" | "no-domain";
    };

export interface ItemCatalogResolver {
  readonly artifact: ItemCatalogArtifact;
  resolve(input: ItemCatalogKeyInput): ItemCatalogResolution;
  allDefinitions(): readonly ItemCatalogDefinition[];
}

export function canonicalItemCatalogKey(input: ItemCatalogKeyInput): ItemCatalogKey | null {
  if (!isRepository(input?.repository)) return null;
  if (!isNonNegativeInteger(input.type) || !isNonNegativeInteger(input.gameId)) return null;
  const suppliedWeaponType = input.weaponType ?? 0;
  if (!isNonNegativeInteger(suppliedWeaponType)) return null;
  if (input.repository === "runeword") {
    // Runeword `b` ordinals are global inside s_RunewordItemData. The packet's
    // item/weapon type describes the base receiving the runeword, not a second
    // runeword identity namespace.
    return {
      repository: "runeword",
      type: 3,
      gameId: input.gameId,
      weaponType: 0,
    };
  }
  return {
    repository: input.repository,
    type: input.type,
    gameId: input.gameId,
    weaponType: input.type === 3 ? suppliedWeaponType : 0,
  };
}

export function createItemCatalogResolver(
  artifactValue: unknown,
  expectedBuild: Readonly<typeof ACTIVE_ITEM_CATALOG_BUILD> = ACTIVE_ITEM_CATALOG_BUILD,
): ItemCatalogResolver {
  const errors = validateItemCatalogArtifact(artifactValue, expectedBuild);
  if (errors.length > 0) {
    throw new Error(`Invalid item catalog artifact:\n- ${errors.join("\n- ")}`);
  }

  const artifact = artifactValue as ItemCatalogArtifact;
  const domains = new Map(artifact.domains.map((domain) => [domainKey(domain), domain]));
  const definitions = new Map(artifact.definitions.map((definition) => [itemKey(definition), definition]));
  const missing = new Map(artifact.missing.map((entry) => [itemKey(entry), entry]));
  const quarantine = new Map(artifact.quarantine.map((entry) => [itemKey(entry), entry]));

  return {
    artifact,
    resolve(input) {
      const key = canonicalItemCatalogKey(input);
      if (!key) return { status: "unclassified", key: null, reason: "invalid-key" };
      const domain = domains.get(domainKey(key));
      if (!domain) return { status: "unclassified", key, reason: "no-domain" };

      const resolvedDefinition = definitions.get(itemKey(key));
      if (resolvedDefinition) return { status: "resolved", key, domain, definition: resolvedDefinition };

      const missingDefinition = missing.get(itemKey(key));
      if (missingDefinition) {
        return {
          status: "missing",
          key,
          domain,
          expectedIdentityMode: missingDefinition.expectedIdentityMode,
          missing: missingDefinition,
        };
      }

      const quarantinedDefinition = quarantine.get(itemKey(key));
      if (quarantinedDefinition) {
        return {
          status: "quarantined",
          key,
          domain,
          expectedIdentityMode: quarantinedDefinition.expectedIdentityMode,
          quarantine: quarantinedDefinition,
        };
      }

      return {
        status: "out-of-range",
        key,
        domain,
        expectedIdentityMode: domain.defaultIdentityMode,
      };
    },
    allDefinitions() {
      return artifact.definitions;
    },
  };
}

export function requiresItemIdentification(resolution: ItemCatalogResolution): boolean {
  if (resolution.status === "resolved") return false;
  if (resolution.status === "unclassified") return true;
  return resolution.expectedIdentityMode !== "seeded";
}

export function validateItemCatalogArtifact(
  artifactValue: unknown,
  expectedBuild: Readonly<typeof ACTIVE_ITEM_CATALOG_BUILD> = ACTIVE_ITEM_CATALOG_BUILD,
): string[] {
  const errors: string[] = [];
  if (!isRecord(artifactValue)) return ["artifact must be an object"];
  const artifact = artifactValue;

  if (artifact.schemaVersion !== ITEM_CATALOG_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ITEM_CATALOG_SCHEMA_VERSION}`);
  if (!isNonEmptyString(artifact.catalogId)) errors.push("catalogId must be a non-empty string");
  if (artifact.catalogStatus !== "partial" && artifact.catalogStatus !== "complete") {
    errors.push("catalogStatus must be partial or complete");
  }

  validateBuildProvenance(artifact.provenance, expectedBuild, errors);
  validateCoverage(artifact.coverage, errors);

  const sources = arrayField(artifact, "sources", errors);
  const domains = arrayField(artifact, "domains", errors);
  const definitions = arrayField(artifact, "definitions", errors);
  const missing = arrayField(artifact, "missing", errors);
  const quarantine = arrayField(artifact, "quarantine", errors);

  const sourceIds = validateSources(sources, errors);
  const domainIndex = validateDomains(domains, sourceIds, errors);
  validateSourceCoverage(sources, domains, artifact.coverage, errors);
  validateEmptyShellProvenancePlaceholders(artifact, sources, domains, definitions, missing, quarantine, errors);
  const definitionIndex = validateDefinitions(definitions, sourceIds, domainIndex, errors);
  const missingIndex = validateMissingEntries(missing, sourceIds, domainIndex, errors);
  const quarantineIndex = validateQuarantineEntries(quarantine, sourceIds, domainIndex, errors);

  for (const [key, definition] of definitionIndex) {
    if (missingIndex.has(key) || quarantineIndex.has(key)) errors.push(`${key} appears in more than one resolution set`);
    validateExpectedMode(key, definition.identityMode, domainIndex, errors);
  }
  for (const [key, entry] of missingIndex) {
    if (quarantineIndex.has(key)) errors.push(`${key} appears in both missing and quarantine`);
    validateExpectedMode(key, entry.expectedIdentityMode, domainIndex, errors);
  }
  for (const [key, entry] of quarantineIndex) {
    validateExpectedMode(key, entry.expectedIdentityMode, domainIndex, errors);
  }

  validateExpectedCoverage(domainIndex, definitionIndex, missingIndex, quarantineIndex, errors);
  validateCompletenessClaims(artifact, domains, missing, quarantine, errors);
  return errors;
}

function validateBuildProvenance(
  value: unknown,
  expected: Readonly<typeof ACTIVE_ITEM_CATALOG_BUILD>,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push("provenance must be an object");
    return;
  }
  for (const field of ["steamAppId", "steamBuild", "executableVersion", "executableSha256"] as const) {
    if (value[field] !== expected[field]) errors.push(`provenance.${field} does not match the active executable build`);
  }
  if (value.source !== "static-binary-analysis") errors.push("provenance.source must be static-binary-analysis");
  if (!isNonEmptyString(value.extractorRevision)) errors.push("provenance.extractorRevision must be a non-empty string");
  if (!isSha256(value.executableSha256)) errors.push("provenance.executableSha256 must be a 64-character SHA-256");
  for (const field of PROVENANCE_INPUT_HASH_FIELDS) {
    if (!isSha256(value[field])) errors.push(`provenance.${field} must be a 64-character SHA-256`);
  }
}

function validateCoverage(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("coverage must be an object");
    return;
  }
  if (!isNonNegativeInteger(value.activeConstructorCount)) errors.push("coverage.activeConstructorCount must be a nonnegative integer");
  if (!isNonNegativeInteger(value.accountedConstructorCount)) errors.push("coverage.accountedConstructorCount must be a nonnegative integer");
  if (
    isNonNegativeInteger(value.activeConstructorCount)
    && isNonNegativeInteger(value.accountedConstructorCount)
    && value.accountedConstructorCount > value.activeConstructorCount
  ) errors.push("coverage.accountedConstructorCount cannot exceed activeConstructorCount");
}

function validateSources(values: unknown[], errors: string[]): Set<string> {
  const sourceIds = new Set<string>();
  values.forEach((value, index) => {
    if (!isRecord(value)) {
      errors.push(`sources[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString(value.id)) errors.push(`sources[${index}].id must be a non-empty string`);
    else if (sourceIds.has(value.id)) errors.push(`duplicate source id ${value.id}`);
    else sourceIds.add(value.id);
    if (!isNonEmptyString(value.definitionFunction)) errors.push(`sources[${index}].definitionFunction must be a non-empty string`);
    if (!isSha256(value.bodySha256)) errors.push(`sources[${index}].bodySha256 must be a 64-character SHA-256`);
    if (!isNonNegativeInteger(value.definitionCount)) {
      errors.push(`sources[${index}].definitionCount must be a nonnegative integer`);
    }
    if (value.status !== "extracted" && value.status !== "zero-definitions-proved") {
      errors.push(`sources[${index}].status must be extracted or zero-definitions-proved`);
    } else if (value.status === "extracted" && value.definitionCount === 0) {
      errors.push(`sources[${index}] extracted source must have a positive definitionCount`);
    } else if (value.status === "zero-definitions-proved" && value.definitionCount !== 0) {
      errors.push(`sources[${index}] zero-definitions-proved source must have definitionCount 0`);
    }
  });
  return sourceIds;
}

function validateSourceCoverage(
  sources: unknown[],
  domains: unknown[],
  coverageValue: unknown,
  errors: string[],
): void {
  const coverage = isRecord(coverageValue) ? coverageValue : {};
  if (
    isNonNegativeInteger(coverage.accountedConstructorCount)
    && sources.length !== coverage.accountedConstructorCount
  ) {
    errors.push("sources length must equal coverage.accountedConstructorCount");
  }

  const declaredDefinitionCount = domains.reduce<number>((total, domain) => {
    if (!isRecord(domain) || !Array.isArray(domain.expectedItems)) return total;
    return total + domain.expectedItems.length;
  }, 0);
  const sourceDefinitionCount = sources.reduce<number>((total, source) => {
    if (!isRecord(source) || !isNonNegativeInteger(source.definitionCount)) return total;
    return total + source.definitionCount;
  }, 0);
  if (sourceDefinitionCount !== declaredDefinitionCount) {
    errors.push("summed source definitionCount must equal total declared domain expectedItems");
  }

  const referencedSourceIds = new Set<string>();
  for (const domain of domains) {
    if (!isRecord(domain) || !Array.isArray(domain.sourceRefs)) continue;
    for (const sourceRef of domain.sourceRefs) {
      if (typeof sourceRef === "string") referencedSourceIds.add(sourceRef);
    }
  }
  sources.forEach((source, index) => {
    if (!isRecord(source) || !isNonEmptyString(source.id)) return;
    if (source.status === "extracted" && !referencedSourceIds.has(source.id)) {
      errors.push(`sources[${index}] extracted source must be referenced by a domain`);
    }
    if (source.status === "zero-definitions-proved" && referencedSourceIds.has(source.id)) {
      errors.push(`sources[${index}] zero-definitions-proved source cannot be referenced by a domain`);
    }
  });
}

function validateEmptyShellProvenancePlaceholders(
  artifact: Record<string, unknown>,
  sources: unknown[],
  domains: unknown[],
  definitions: unknown[],
  missing: unknown[],
  quarantine: unknown[],
  errors: string[],
): void {
  const provenance = isRecord(artifact.provenance) ? artifact.provenance : {};
  if (!PROVENANCE_INPUT_HASH_FIELDS.some((field) => provenance[field] === EMPTY_SHA256)) return;
  const coverage = isRecord(artifact.coverage) ? artifact.coverage : {};
  const isEmptyPartialShell = artifact.catalogStatus === "partial"
    && coverage.accountedConstructorCount === 0
    && [sources, domains, definitions, missing, quarantine].every((values) => values.length === 0);
  if (!isEmptyPartialShell) {
    errors.push("zero SHA-256 provenance placeholders are allowed only for the empty partial catalog shell");
  }
}

interface ValidatedDomain {
  domain: ItemCatalogDomain;
  expectedModes: Map<number, ItemIdentityMode>;
}

function validateDomains(values: unknown[], sourceIds: Set<string>, errors: string[]): Map<string, ValidatedDomain> {
  const domains = new Map<string, ValidatedDomain>();
  values.forEach((value, index) => {
    if (!isRecord(value)) {
      errors.push(`domains[${index}] must be an object`);
      return;
    }
    const label = `domains[${index}]`;
    const key = validatedDomainKey(value, label, errors);
    if (!isNonEmptyString(value.id)) errors.push(`${label}.id must be a non-empty string`);
    if (!isIdentityMode(value.defaultIdentityMode)) errors.push(`${label}.defaultIdentityMode is invalid`);
    else validateModeRepository(value.repository, value.type, value.defaultIdentityMode, `${label}.defaultIdentityMode`, errors);
    if (value.status !== "partial" && value.status !== "complete") errors.push(`${label}.status must be partial or complete`);
    validateSourceRefs(value.sourceRefs, `${label}.sourceRefs`, sourceIds, errors);

    const expectedModes = new Map<number, ItemIdentityMode>();
    const expectedItems = Array.isArray(value.expectedItems) ? value.expectedItems : [];
    if (!Array.isArray(value.expectedItems)) errors.push(`${label}.expectedItems must be an array`);
    expectedItems.forEach((expected, expectedIndex) => {
      if (!isRecord(expected)) {
        errors.push(`${label}.expectedItems[${expectedIndex}] must be an object`);
        return;
      }
      if (!isNonNegativeInteger(expected.gameId)) errors.push(`${label}.expectedItems[${expectedIndex}].gameId is invalid`);
      if (!isIdentityMode(expected.identityMode)) errors.push(`${label}.expectedItems[${expectedIndex}].identityMode is invalid`);
      if (isNonNegativeInteger(expected.gameId) && isIdentityMode(expected.identityMode)) {
        validateModeRepository(value.repository, value.type, expected.identityMode, `${label}.expectedItems[${expectedIndex}]`, errors);
        if (expectedModes.has(expected.gameId)) errors.push(`${label} repeats expected gameId ${expected.gameId}`);
        else expectedModes.set(expected.gameId, expected.identityMode);
      }
    });

    if (key) {
      if (domains.has(key)) errors.push(`duplicate catalog domain ${key}`);
      else domains.set(key, { domain: value as unknown as ItemCatalogDomain, expectedModes });
    }
  });
  return domains;
}

function validateDefinitions(
  values: unknown[],
  sourceIds: Set<string>,
  domains: Map<string, ValidatedDomain>,
  errors: string[],
): Map<string, ItemCatalogDefinition> {
  const definitions = new Map<string, ItemCatalogDefinition>();
  values.forEach((value, index) => {
    if (!isRecord(value)) {
      errors.push(`definitions[${index}] must be an object`);
      return;
    }
    const label = `definitions[${index}]`;
    const key = validatedItemKey(value, label, errors);
    if (!isIdentityMode(value.identityMode)) errors.push(`${label}.identityMode is invalid`);
    if (!isNonEmptyString(value.provenanceRef) || !sourceIds.has(value.provenanceRef)) {
      errors.push(`${label}.provenanceRef must reference a catalog source`);
    }
    if (isIdentityMode(value.identityMode)) validateNamedShape(value, value.identityMode, label, errors);
    if (key && isIdentityMode(value.identityMode)) {
      const existing = definitions.get(key);
      if (existing) {
        const qualifier = existing.identityMode === value.identityMode ? "duplicate" : "cross-mode duplicate";
        errors.push(`${qualifier} definition key ${key}`);
      } else {
        definitions.set(key, value as unknown as ItemCatalogDefinition);
      }
      validateDefinitionModeRepository(value, label, errors);
      if (!domains.has(domainKey(value as unknown as ItemCatalogKey))) errors.push(`${label} has no catalog domain`);
    }
  });
  return definitions;
}

function validateMissingEntries(
  values: unknown[],
  sourceIds: Set<string>,
  domains: Map<string, ValidatedDomain>,
  errors: string[],
): Map<string, MissingItemCatalogDefinition> {
  const entries = new Map<string, MissingItemCatalogDefinition>();
  values.forEach((value, index) => {
    if (!isRecord(value)) {
      errors.push(`missing[${index}] must be an object`);
      return;
    }
    const label = `missing[${index}]`;
    const key = validatedItemKey(value, label, errors);
    if (!isIdentityMode(value.expectedIdentityMode)) errors.push(`${label}.expectedIdentityMode is invalid`);
    else validateModeRepository(value.repository, value.type, value.expectedIdentityMode, label, errors);
    if (value.localizationId !== undefined && !isNonEmptyString(value.localizationId)) {
      errors.push(`${label}.localizationId must be a non-empty string when present`);
    }
    if (!isNonEmptyString(value.reason)) errors.push(`${label}.reason must be a non-empty string`);
    validateSourceRefs(value.sourceRefs, `${label}.sourceRefs`, sourceIds, errors);
    if (key) {
      if (entries.has(key)) errors.push(`duplicate missing key ${key}`);
      else entries.set(key, value as unknown as MissingItemCatalogDefinition);
      if (!domains.has(domainKey(value as unknown as ItemCatalogKey))) errors.push(`${label} has no catalog domain`);
    }
  });
  return entries;
}

function validateQuarantineEntries(
  values: unknown[],
  sourceIds: Set<string>,
  domains: Map<string, ValidatedDomain>,
  errors: string[],
): Map<string, QuarantinedItemCatalogDefinition> {
  const entries = new Map<string, QuarantinedItemCatalogDefinition>();
  values.forEach((value, index) => {
    if (!isRecord(value)) {
      errors.push(`quarantine[${index}] must be an object`);
      return;
    }
    const label = `quarantine[${index}]`;
    const key = validatedItemKey(value, label, errors);
    if (!isIdentityMode(value.expectedIdentityMode)) errors.push(`${label}.expectedIdentityMode is invalid`);
    else validateModeRepository(value.repository, value.type, value.expectedIdentityMode, label, errors);
    if (!isNonEmptyString(value.reason)) errors.push(`${label}.reason must be a non-empty string`);
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    if (!Array.isArray(value.candidates) || candidates.length < 2) errors.push(`${label}.candidates must contain at least two candidates`);
    const candidateModes = new Set<ItemIdentityMode>();
    candidates.forEach((candidate, candidateIndex) => {
      if (!isRecord(candidate)) {
        errors.push(`${label}.candidates[${candidateIndex}] must be an object`);
        return;
      }
      const candidateLabel = `${label}.candidates[${candidateIndex}]`;
      if (!isIdentityMode(candidate.identityMode)) errors.push(`${candidateLabel}.identityMode is invalid`);
      else {
        candidateModes.add(candidate.identityMode);
        validateNamedShape(candidate, candidate.identityMode, candidateLabel, errors);
      }
      if (!isNonEmptyString(candidate.provenanceRef) || !sourceIds.has(candidate.provenanceRef)) {
        errors.push(`${candidateLabel}.provenanceRef must reference a catalog source`);
      }
    });
    if (candidateModes.size > 1) errors.push(`${label} has a forbidden cross-mode quarantine`);
    if (isIdentityMode(value.expectedIdentityMode) && [...candidateModes].some((mode) => mode !== value.expectedIdentityMode)) {
      errors.push(`${label} candidate mode does not match expectedIdentityMode`);
    }
    if (key) {
      if (entries.has(key)) errors.push(`duplicate quarantine key ${key}`);
      else entries.set(key, value as unknown as QuarantinedItemCatalogDefinition);
      if (!domains.has(domainKey(value as unknown as ItemCatalogKey))) errors.push(`${label} has no catalog domain`);
    }
  });
  return entries;
}

function validateExpectedCoverage(
  domains: Map<string, ValidatedDomain>,
  definitions: Map<string, ItemCatalogDefinition>,
  missing: Map<string, MissingItemCatalogDefinition>,
  quarantine: Map<string, QuarantinedItemCatalogDefinition>,
  errors: string[],
): void {
  for (const { domain, expectedModes } of domains.values()) {
    let hasUnresolved = false;
    for (const gameId of expectedModes.keys()) {
      const key = itemKey({ ...domain, gameId });
      const count = Number(definitions.has(key)) + Number(missing.has(key)) + Number(quarantine.has(key));
      if (count !== 1) errors.push(`${key} must appear in exactly one resolution set`);
      if (missing.has(key) || quarantine.has(key)) hasUnresolved = true;
    }
    if (domain.status === "complete" && hasUnresolved) errors.push(`complete domain ${domain.id} contains unresolved identities`);
  }
}

function validateCompletenessClaims(
  artifact: Record<string, unknown>,
  domains: unknown[],
  missing: unknown[],
  quarantine: unknown[],
  errors: string[],
): void {
  if (artifact.catalogStatus !== "complete") return;
  const coverage = isRecord(artifact.coverage) ? artifact.coverage : {};
  if (coverage.activeConstructorCount !== coverage.accountedConstructorCount) {
    errors.push("complete catalog must account for every active constructor");
  }
  if (domains.length === 0) errors.push("complete catalog must contain at least one domain");
  if (domains.some((domain) => !isRecord(domain) || domain.status !== "complete")) {
    errors.push("complete catalog cannot contain partial domains");
  }
  if (missing.length > 0 || quarantine.length > 0) errors.push("complete catalog cannot contain missing or quarantined identities");
}

function validateExpectedMode(
  key: string,
  mode: ItemIdentityMode,
  domains: Map<string, ValidatedDomain>,
  errors: string[],
): void {
  const parts = key.split(":");
  const domain = domains.get(parts.slice(0, 3).join(":"));
  const gameId = Number(parts[3]);
  const expected = domain?.expectedModes.get(gameId);
  if (!domain || expected === undefined) {
    errors.push(`${key} is not declared by domain expectedItems`);
  } else if (expected !== mode) {
    errors.push(`${key} mode ${mode} does not match expected mode ${expected}`);
  }
}

function validateDefinitionModeRepository(value: Record<string, unknown>, label: string, errors: string[]): void {
  validateModeRepository(value.repository, value.type, value.identityMode, label, errors);
}

function validateModeRepository(
  repository: unknown,
  type: unknown,
  mode: unknown,
  label: string,
  errors: string[],
): void {
  if (mode === "seeded" && repository !== "normal") errors.push(`${label} seeded identities must use normal repository`);
  if (mode === "stack" && (repository !== "normal" || ![12, 13, 14, 15].includes(Number(type)))) {
    errors.push(`${label} stack identities must use normal repository types 12-15`);
  }
  if (mode === "runeword" && repository !== "runeword") errors.push(`${label} runeword identities must use runeword repository`);
  if (repository === "runeword" && mode !== "runeword") errors.push(`${label} runeword repository requires runeword identityMode`);
  if (repository === "runeword" && (type !== 3)) errors.push(`${label} runeword identities must use canonical type 3`);
}

function validateNamedShape(value: Record<string, unknown>, mode: ItemIdentityMode, label: string, errors: string[]): void {
  if (mode === "seeded") {
    if (!isNonEmptyString(value.baseLocalizationId)) errors.push(`${label}.baseLocalizationId must be a non-empty string`);
    if (!isNonEmptyString(value.baseName)) errors.push(`${label}.baseName must be a non-empty string`);
    return;
  }
  if (!isNonEmptyString(value.localizationId)) errors.push(`${label}.localizationId must be a non-empty string`);
  if (!isNonEmptyString(value.name)) errors.push(`${label}.name must be a non-empty string`);
}

function validateSourceRefs(value: unknown, label: string, sourceIds: Set<string>, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  for (const sourceRef of value) {
    if (!isNonEmptyString(sourceRef) || !sourceIds.has(sourceRef)) errors.push(`${label} contains an unknown source reference`);
  }
}

function validatedDomainKey(value: Record<string, unknown>, label: string, errors: string[]): string | null {
  if (!isRepository(value.repository)) errors.push(`${label}.repository is invalid`);
  if (!isNonNegativeInteger(value.type)) errors.push(`${label}.type is invalid`);
  if (!isNonNegativeInteger(value.weaponType)) errors.push(`${label}.weaponType is invalid`);
  if (!isRepository(value.repository) || !isNonNegativeInteger(value.type) || !isNonNegativeInteger(value.weaponType)) return null;
  if (value.type !== 3 && value.weaponType !== 0) errors.push(`${label}.weaponType must be 0 for non-weapons`);
  if (value.repository === "runeword" && (value.type !== 3 || value.weaponType !== 0)) {
    errors.push(`${label} runeword domains must use canonical type 3 and weaponType 0`);
  }
  return `${value.repository}:${value.type}:${value.type === 3 ? value.weaponType : 0}`;
}

function validatedItemKey(value: Record<string, unknown>, label: string, errors: string[]): string | null {
  const domain = validatedDomainKey(value, label, errors);
  if (!isNonNegativeInteger(value.gameId)) errors.push(`${label}.gameId is invalid`);
  return domain && isNonNegativeInteger(value.gameId) ? `${domain}:${value.gameId}` : null;
}

function domainKey(value: Pick<ItemCatalogKey, "repository" | "type" | "weaponType">): string {
  if (value.repository === "runeword") return "runeword:3:0";
  return `${value.repository}:${value.type}:${value.type === 3 ? value.weaponType : 0}`;
}

function itemKey(value: ItemCatalogKey): string {
  return `${domainKey(value)}:${value.gameId}`;
}

function arrayField(value: Record<string, unknown>, field: string, errors: string[]): unknown[] {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  return fieldValue;
}

function isIdentityMode(value: unknown): value is ItemIdentityMode {
  return value === "fixed" || value === "seeded" || value === "stack" || value === "runeword";
}

function isRepository(value: unknown): value is ItemRepository {
  return value === "normal" || value === "unique" || value === "runeword";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[A-Fa-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const activeItemCatalog = createItemCatalogResolver(ITEM_CATALOG_BUILD_24868792_DATA);

export function resolveItemDefinition(input: ItemCatalogKeyInput): ItemCatalogResolution {
  return activeItemCatalog.resolve(input);
}
