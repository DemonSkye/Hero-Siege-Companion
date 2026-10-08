import { activeItemCatalog, type ItemCatalogKey, type ItemIdentityMode } from "./item-catalog";
import { itemBaseStatDefinition, type ItemBaseStat } from "./item-base-stat-catalog";
import { lookupKnownItemRarity } from "./item-rarity";
import { runewordMarketByLegacyKey } from "./runeword-market-catalog";

export type ItemGroup = "base" | "satanic" | "set" | "heroic" | "angelic" | "unholy" | "runeword" | "unknown";
export interface ReusableItem extends ItemCatalogKey {
  itemKey: string;
  /** Original catalog key, including the legacy runeword constructor ordinal. */
  catalogKey: string;
  name: string | null;
  nameKind: "base" | "fixed" | "unavailable";
  localizationId: string | null;
  identityMode: ItemIdentityMode;
  identityStatus: "resolved" | "missing" | "quarantined";
  identityIssue: string | null;
  provenanceRefs: readonly string[];
  group: ItemGroup;
  classificationBasis: "normal-repository" | "runeword-repository" | "retained-name-rarity" | "unknown";
  /** Static constructor facts only; never per-listing rolls or full tooltip stats. */
  stats: readonly ItemBaseStat[];
  statsComplete: boolean | null;
  statsStatus: "retained" | "no-values-retained" | "unavailable";
}

const groups: Record<ItemGroup, ReusableItem[]> = {
  base: [], satanic: [], set: [], heroic: [], angelic: [], unholy: [], runeword: [], unknown: [],
};
const artifact = activeItemCatalog.artifact;
for (const definition of [...artifact.definitions, ...artifact.missing, ...artifact.quarantine]) {
  const catalogKey = `${definition.repository}:${definition.type}:${definition.weaponType}:${definition.gameId}`;
  const runeword = runewordMarketByLegacyKey(catalogKey);
  const constructor = itemBaseStatDefinition(catalogKey);
  const resolved = "identityMode" in definition;
  const seeded = resolved && definition.identityMode === "seeded";
  const name = resolved ? seeded ? definition.baseName : definition.name : null;
  const rarity = lookupKnownItemRarity(definition.type, name ?? undefined);
  const group: ItemGroup = definition.repository === "normal" ? "base"
    : definition.repository === "runeword" ? "runeword"
    : rarity && rarity !== "Runeword" ? rarity.toLowerCase() as ItemGroup : "unknown";
  const item: ReusableItem = {
    repository: definition.repository, type: definition.type,
    weaponType: definition.weaponType, gameId: definition.gameId,
    itemKey: runeword?.itemKey ?? catalogKey, catalogKey, name,
    nameKind: name === null ? "unavailable" : seeded ? "base" : "fixed",
    localizationId: resolved ? seeded ? definition.baseLocalizationId : definition.localizationId
      : "localizationId" in definition ? definition.localizationId ?? null : null,
    identityMode: resolved ? definition.identityMode : definition.expectedIdentityMode,
    identityStatus: resolved ? "resolved" : "candidates" in definition ? "quarantined" : "missing",
    identityIssue: resolved ? null : definition.reason,
    provenanceRefs: resolved ? [definition.provenanceRef] : "sourceRefs" in definition
      ? definition.sourceRefs : definition.candidates.map(candidate => candidate.provenanceRef),
    group,
    classificationBasis: definition.repository === "normal" ? "normal-repository"
      : definition.repository === "runeword" ? "runeword-repository"
      : group === "unknown" ? "unknown" : "retained-name-rarity",
    stats: constructor?.stats ?? [], statsComplete: constructor?.complete ?? null,
    statsStatus: !constructor ? "unavailable" : constructor.stats.length ? "retained" : "no-values-retained",
  };
  groups[group].push(Object.freeze(item));
}
for (const group of Object.values(groups)) {
  group.sort((left, right) => left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
  Object.freeze(group);
}

/** Requested groups plus explicit unknowns and the separate runeword ID domain. */
export const Items: Readonly<Record<ItemGroup, readonly ReusableItem[]>> = Object.freeze(groups);
