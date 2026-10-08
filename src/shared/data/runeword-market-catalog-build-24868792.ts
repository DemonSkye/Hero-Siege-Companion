// Compatibility adapter. Edit the canonical JSON; see docs/item-data.md.
import data from "./items/build-24868792/runewords.json";
export const RUNEWORD_MARKET_CATALOG_DATA = data.bindings.map(
  ([id, key, name, type]) => [id as number, key as string, name as string, type as number | null] as const,
);
