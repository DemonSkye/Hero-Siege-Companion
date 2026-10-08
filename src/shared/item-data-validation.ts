import identities from "./data/items/build-24868792/identities.json";
import constructors from "./data/items/build-24868792/constructor-stats.json";
import statCatalog from "./data/items/build-24868792/item-stats.json";
import runewords from "./data/items/build-24868792/runewords.json";
import rarities from "./data/items/build-24868792/rarities.json";
import listingCoverage from "./data/items/build-24868792/listing-coverage.json";
import { ACTIVE_ITEM_CATALOG_BUILD, validateItemCatalogArtifact } from "./item-catalog";

export const ITEM_DATA_SOURCES = { identities, constructors, statCatalog, runewords, rarities, listingCoverage };

/** Offline contributor validation, independent of capture, sessions and game I/O. */
export function validateItemData(sources: typeof ITEM_DATA_SOURCES = ITEM_DATA_SOURCES): string[] {
  const errors = validateItemCatalogArtifact(sources.identities);
  const check = (condition: boolean, message: string) => { if (!condition) errors.push(message); };
  const unique = (values: readonly (string | number)[], label: string) =>
    check(new Set(values).size === values.length, `${label}: duplicate ID/key`);
  const keys = (value: object, allowed: readonly string[], label: string) =>
    check(Object.keys(value).every(key => allowed.includes(key)), `${label}: unsupported property`);
  const id = (value: number) => Number.isSafeInteger(value) && value >= 0;
  const hash = (value: string) => /^[0-9a-f]{64}$/i.test(value);
  const { constructors: base, statCatalog: stats, runewords: words, listingCoverage: coverage } = sources;
  keys(sources, ["identities", "constructors", "statCatalog", "runewords", "rarities", "listingCoverage"], "Sources");
  keys(base, ["steamBuild", "executableVersion", "currentBuildParity", "items"], "Constructors");
  keys(stats, ["schemaVersion", "steamBuild", "executableSha256", "provenance", "nativeMarketCatalog", "nativeMenuStatIds", "stats", "encodedFieldContexts", "procFamilies"], "Stat catalog");
  keys(words, ["steamBuild", "sourceSha256", "bindings"], "Runewords");
  keys(sources.rarities, ["source", "byNormalizedName"], "Rarities");
  keys(coverage, ["ITEM_LISTING_CONSTRUCTOR_GAPS", "ITEM_LISTING_OPTIONAL_GENERATION_KEYS"], "Listing coverage");
  check(stats.schemaVersion === 1, "Unsupported stat schema version");
  check([base.steamBuild, stats.steamBuild, words.steamBuild, stats.nativeMarketCatalog.steamBuild]
    .every(build => build === ACTIVE_ITEM_CATALOG_BUILD.steamBuild), "Build mismatch");
  check(base.executableVersion === ACTIVE_ITEM_CATALOG_BUILD.executableVersion, "Constructor version mismatch");
  check(base.currentBuildParity === "unverified", "Current build parity requires separate evidence");
  check(stats.executableSha256 === ACTIVE_ITEM_CATALOG_BUILD.executableSha256
    && stats.nativeMarketCatalog.executableSha256 === stats.executableSha256, "Executable hash mismatch");
  check(Object.values(stats.provenance).every(hash) && hash(words.sourceSha256)
    && hash(stats.nativeMarketCatalog.sourceCatalogSha256), "Invalid provenance hash");
  unique(stats.stats.map(stat => stat.statId), "ItemStats");
  const statIds = new Set(stats.stats.map(stat => stat.statId));
  const byId = new Map(stats.stats.map(stat => [stat.statId, stat]));
  for (const stat of stats.stats) {
    check(id(stat.statId), `Invalid stat ID ${stat.statId}`);
    keys(stat, ["statId", "name", "localizationKey", "nativeMarketMenu", "unit", "role", "unresolvedMeaning"], `Stat ${stat.statId}`);
    // IDs 119/121 have proved roles but no retained localization keys.
    check(Boolean(stat.name) && typeof stat.localizationKey === "string", `Stat ${stat.statId}: invalid label/key`);
    check(["percent", "flat", "count", "seconds", "unknown"].includes(stat.unit), `Stat ${stat.statId}: invalid unit`);
    check(typeof stat.nativeMarketMenu === "boolean", `Stat ${stat.statId}: invalid menu flag`);
    check(stat.role === null || stat.role.statId === stat.statId, `Stat ${stat.statId}: role ID mismatch`);
    if (stat.role) {
      keys(stat.role, ["statId", "kind", "caption", "detail", "talentFieldId"], `Stat ${stat.statId} role`);
      check(["quantity", "class-identifier", "talent-identifier", "effect", "marker", "categorical", "collection", "control-only"]
        .includes(stat.role.kind) && Boolean(stat.role.detail), `Stat ${stat.statId}: invalid role`);
    }
    if (stat.role && "talentFieldId" in stat.role) {
      check(statIds.has(stat.role.talentFieldId!), `Stat ${stat.statId}: unknown talent field`);
    }
    check(stat.unresolvedMeaning === null || stat.unresolvedMeaning.length > 0, `Stat ${stat.statId}: empty meaning gap`);
  }
  unique(stats.nativeMenuStatIds, "Native menu");
  check(stats.nativeMenuStatIds.every(statId => byId.get(statId)?.nativeMarketMenu === true)
    && stats.stats.filter(stat => stat.nativeMarketMenu).every(stat => stats.nativeMenuStatIds.includes(stat.statId)),
  "Native menu membership mismatch");
  const catalogKey = (item: { repository: string; type: number; weaponType: number; gameId: number }) =>
    `${item.repository}:${item.type}:${item.weaponType}:${item.gameId}`;
  const legacyKeys = [...sources.identities.definitions, ...sources.identities.missing, ...sources.identities.quarantine].map(catalogKey);
  const bindings = new Map(words.bindings.map(([external, legacy]) => [legacy, `runeword-repository:${external}`]));
  const expectedKeys = legacyKeys.map(key => bindings.get(key) ?? key);
  const itemKeys = base.items.map(item => item.itemKey);
  const itemSet = new Set(itemKeys);
  unique(itemKeys, "Constructor items");
  check(expectedKeys.length === itemKeys.length && expectedKeys.every(key => itemSet.has(key)), "Constructor identity coverage mismatch");
  for (const item of base.items) {
    keys(item, ["itemKey", "stats", "complete"], item.itemKey);
    check(typeof item.complete === "boolean", `${item.itemKey}: invalid coverage flag`);
    unique(item.stats.map(stat => stat.statId), item.itemKey);
    for (const stat of item.stats) {
      const label = `${item.itemKey} stat ${stat.statId}`;
      keys(stat, stat.kind === "dynamic" ? ["statId", "kind", "description"]
        : stat.kind === "series" ? ["statId", "kind", "minimum", "maximum", "values"]
        : ["statId", "kind", "minimum", "maximum"], label);
      check(statIds.has(stat.statId), `${label}: unknown ID`);
      if (stat.kind === "dynamic") {
        check("description" in stat && Boolean(stat.description) && !item.complete, `${label}: dynamic coverage claim`);
        continue;
      }
      check(["range", "scalar", "series"].includes(stat.kind), `${label}: unknown value kind`);
      if (!(typeof stat.minimum === "number" && typeof stat.maximum === "number")) { errors.push(`${label}: missing bounds`); continue; }
      check(Number.isFinite(stat.minimum) && Number.isFinite(stat.maximum) && stat.minimum <= stat.maximum, `${label}: invalid bounds`);
      if (stat.kind === "scalar") check(stat.minimum === stat.maximum, `${label}: scalar bounds differ`);
      if (stat.kind === "series") {
        const values = "values" in stat ? stat.values : undefined;
        check(Array.isArray(values) && values.length > 0 && values.every(Number.isFinite)
          && Math.min(...values) === stat.minimum && Math.max(...values) === stat.maximum, `${label}: invalid series bounds`);
      } else check(!("values" in stat), `${label}: only series can have a value table`);
    }
  }
  unique(words.bindings.map(([external]) => external as number), "Runeword external IDs");
  unique(words.bindings.map(([, legacy]) => legacy as string), "Runeword legacy keys");
  check(legacyKeys.filter(key => key.startsWith("runeword:")).length === words.bindings.length, "Runeword coverage mismatch");
  for (const [external, legacy, name, type] of words.bindings) {
    check(typeof external === "number" && id(external) && typeof legacy === "string" && legacyKeys.includes(legacy)
      && typeof name === "string" && name.length > 0 && (type === null || typeof type === "number" && id(type)), "Invalid runeword binding");
  }
  for (const [key, statId] of stats.encodedFieldContexts) {
    check(typeof key === "string" && itemSet.has(key) && typeof statId === "number" && statIds.has(statId)
      && base.items.find(item => item.itemKey === key)?.stats.some(stat => stat.statId === statId) === true, "Invalid encoded field context");
  }
  for (const proc of stats.procFamilies) {
    keys(proc, ["eventKey", "skillIdentifierId", "levelId", "chanceId"], "Proc family");
    check([proc.skillIdentifierId, proc.levelId, proc.chanceId].every(statId => statIds.has(statId)), "Invalid proc family reference");
  }
  check(Boolean(sources.rarities.source), "Missing rarity provenance");
  for (const [name, rarity] of Object.entries(sources.rarities.byNormalizedName)) {
    check(Boolean(name) && ["Satanic", "Set", "Heroic", "Angelic", "Unholy", "Runeword"].includes(rarity), "Invalid name rarity");
  }
  const families = new Set(base.items.map(item => item.itemKey.split(":").slice(0, 3).join(":")));
  for (const [family, gap] of Object.entries(coverage.ITEM_LISTING_CONSTRUCTOR_GAPS)) {
    check(families.has(family) && ["tier-helper", "constructor-helper"].includes(gap), "Invalid constructor helper gap");
  }
  unique(coverage.ITEM_LISTING_OPTIONAL_GENERATION_KEYS, "Optional generation");
  check(coverage.ITEM_LISTING_OPTIONAL_GENERATION_KEYS.every(key => itemSet.has(key)), "Invalid optional generation key");
  return errors;
}
