export const NORMAL_ITEM_NAME_PROVENANCE = {
  steamBuild: 24_868_792,
  executableSha256: "BA72B95AC10785D0ECDCC2B3D1925D6CB3439EFAF4CEF9DE2EA1F67D6CFDD4DF",
  definitionFunction: "gml_Script_DefineItemNormalCharms",
} as const;

export interface GeneratedNormalItemBaseRange {
  repository: "normal";
  type: number;
  firstGameId: number;
  lastGameId: number;
  baseLocalizationId: string;
  baseName: string;
  nameMode: "seeded-affixes";
}

export interface GeneratedNormalItemBase {
  repository: "normal";
  type: number;
  gameId: number;
  baseLocalizationId: string;
  baseName: string;
  nameMode: "seeded-affixes";
}

// Reviewed app derivative of build 24868792's DefineItemNormalCharms dispatch.
// These rows identify stable bases only. Prefixes, suffixes, rolls, and semantic
// rarity are seed-generated and must never be promoted into the fixed catalog.
export const GENERATED_NORMAL_ITEM_BASE_RANGES: readonly GeneratedNormalItemBaseRange[] = [
  {
    repository: "normal",
    type: 10,
    firstGameId: 0,
    lastGameId: 19,
    baseLocalizationId: "charms_normal_small_charm",
    baseName: "Small Charm",
    nameMode: "seeded-affixes",
  },
  {
    repository: "normal",
    type: 10,
    firstGameId: 20,
    lastGameId: 39,
    baseLocalizationId: "charms_normal_large_charm",
    baseName: "Large Charm",
    nameMode: "seeded-affixes",
  },
  {
    repository: "normal",
    type: 10,
    firstGameId: 40,
    lastGameId: 59,
    baseLocalizationId: "charms_normal_grand_charm",
    baseName: "Grand Charm",
    nameMode: "seeded-affixes",
  },
];

// Normal-repository equipment in these categories can be seed-generated. A
// generic packet identity is therefore not enough to create a fixed-name row.
export const POTENTIALLY_GENERATED_NORMAL_EQUIPMENT_TYPES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10] as const;
const potentiallyGeneratedNormalEquipmentTypes = new Set<number>(POTENTIALLY_GENERATED_NORMAL_EQUIPMENT_TYPES);

export function lookupGeneratedNormalItemBase(type: number, gameId: number): GeneratedNormalItemBase | null {
  if (!Number.isSafeInteger(type) || !Number.isSafeInteger(gameId) || type < 0 || gameId < 0) return null;
  const range = GENERATED_NORMAL_ITEM_BASE_RANGES.find((candidate) =>
    candidate.type === type && gameId >= candidate.firstGameId && gameId <= candidate.lastGameId,
  );
  if (!range) return null;
  return {
    repository: range.repository,
    type,
    gameId,
    baseLocalizationId: range.baseLocalizationId,
    baseName: range.baseName,
    nameMode: range.nameMode,
  };
}

export function isGeneratedNormalItemIdentity(repository: unknown, type: number, gameId: number): boolean {
  return repository === "normal" && lookupGeneratedNormalItemBase(type, gameId) !== null;
}

export function isPotentiallyGeneratedNormalEquipment(repository: unknown, type: number): boolean {
  return repository === "normal" && potentiallyGeneratedNormalEquipmentTypes.has(type);
}
