// Compatibility adapter. Edit the canonical JSON; see docs/item-data.md.
import data from "./items/build-24868792/listing-coverage.json";
export const ITEM_LISTING_CONSTRUCTOR_GAPS = data.ITEM_LISTING_CONSTRUCTOR_GAPS as Readonly<Record<string, "constructor-helper">>;
export const ITEM_LISTING_OPTIONAL_GENERATION_KEYS: readonly string[] = data.ITEM_LISTING_OPTIONAL_GENERATION_KEYS;
