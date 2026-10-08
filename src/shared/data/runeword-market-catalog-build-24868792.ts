// Compatibility adapter. Edit the canonical JSON; see docs/item-data.md.
import data from "./items/build-24868792/runewords.json";
import identities from "./items/build-24868792/identities.json";
const names = new Map(identities.definitions
  .filter(item => item.repository === "runeword" && item.identityMode === "runeword")
  .map(item => [`${item.repository}:${item.type}:${item.weaponType}:${item.gameId}`, item.name]));

/** Preserve the old tuple API; identities.json is the only editable name source. */
export const RUNEWORD_MARKET_CATALOG_DATA = data.bindings.map(
  ([id, key, type]) => {
    const name = names.get(key as string);
    if (!name) throw new Error(`Runeword binding lacks a named identity: ${key}`);
    return [id as number, key as string, name, type as number | null] as const;
  },
);
