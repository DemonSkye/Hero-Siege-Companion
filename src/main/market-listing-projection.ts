import { resolveItemDefinition } from "../shared/item-catalog";
import { itemListingDefinition } from "../shared/item-listing-definition";
import { sanitizeMarketListingItem, type MarketListingItem } from "../shared/market-listing-item";
import { generateConstructorStats } from "./item-stat-generator";
import { marketStatRole } from "../shared/market-stat-capabilities";

/** Compact records stay in main. Fingerprint is read only for its type suffix. */
export function projectMarketListingItem(itemData: unknown, fingerprint: unknown): MarketListingItem | null {
  if (typeof fingerprint !== "string" || fingerprint.length > 256) return null;
  const parts = fingerprint.split("-");
  if (parts.length !== 4 || !/^\d{1,2}$/.test(parts[3])) return null;
  let data: unknown = itemData;
  if (typeof data === "string") {
    if (data.length > 16_384) return null;
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  if ((raw.c !== 0 && raw.c !== 1) || !Number.isSafeInteger(raw.b)
    || !Number.isSafeInteger(raw.j ?? 0) || (raw.w !== undefined && raw.w !== 0 && raw.w !== 1)) return null;
  const type = Number(parts[3]);
  const resolution = resolveItemDefinition({ repository: raw.c ? "unique" : "normal", type,
    gameId: raw.b as number, weaponType: type === 3 ? (raw.j as number ?? 0) : 0 });
  if (resolution.status !== "resolved") return null;
  const key = resolution.key;
  const itemKey = `${key.repository}:${key.type}:${key.weaponType}:${key.gameId}`;
  const item: MarketListingItem = { itemKey, identified: raw.c === 0 || raw.w === 1 };
  const definition = itemListingDefinition(itemKey);
  if (item.identified && definition) {
    const unavailable = (reason: NonNullable<MarketListingItem["unknownStats"]>[number]["reason"]) => {
      item.unknownStats = definition.stats.map(stat => ({ statId: stat.statId, reason }));
    };
    const seedValid = typeof raw.a === "number" && Number.isSafeInteger(raw.a) && raw.a >= 0 && raw.a <= 0x7fff_ffff;
    const allowed = new Set(["a", "b", "c", "d", "e", "j", "m", "w", "sh", "r", "p"]);
    const flagsValid = [raw.d, raw.e, raw.m].every(value => value === undefined
      || typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0x7fff_ffff);
    const modifiers = Object.keys(raw).some(field => !allowed.has(field))
      || raw.r !== undefined && raw.r !== 0 || raw.p !== undefined && raw.p !== 0;
    if (!seedValid) unavailable("invalid-seed");
    else if (definition.helperGap) unavailable(definition.helperGap);
    // LoadCommonItems and additional affix catalogs remain untranslated.
    else if (!flagsValid || modifiers || raw.c === 0 || definition.optionalGeneration) unavailable("modifier");
    else {
      const generated = generateConstructorStats(raw.a as number, definition.stats, { incomplete: !definition.complete,
        latePhaseUnknown: definition.stats.some(stat => ["talent-identifier", "class-identifier"].includes(marketStatRole(stat.statId)?.kind ?? "")),
      });
      item.stats = generated.stats;
      item.unknownStats = generated.unknownStats;
    }
  }
  return sanitizeMarketListingItem(item);
}
