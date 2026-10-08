import { resolveItemDefinition } from "../shared/item-catalog";
import { itemStatDefinition } from "../shared/item-stat-ranges";
import { sanitizeMarketListingItem, type MarketListingItem } from "../shared/market-listing-item";

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
  const definition = itemStatDefinition(itemKey);
  if (item.identified && definition) {
    // Scope exact checked flags and fail closed on additions: upgrades,
    // corruption, subskills, random affixes and socket contents are untranslated.
    const allowed = new Set(["a", "b", "c", "d", "e", "j", "m", "w", "sh"]);
    const supported = Object.keys(raw).every(field => allowed.has(field))
      && raw.d === definition.flags.d && raw.e === definition.flags.e
      && raw.m === definition.flags.m && (raw.j ?? 0) === 0
      && typeof raw.a === "number" && Number.isSafeInteger(raw.a) && raw.a >= 0 && raw.a <= 0x7fff_ffff;
    if (supported) {
      let state = raw.a as number;
      const draw = () => { state = ((1789570533 * state + 465707) % 2147483648) & 1073741823; return state; };
      const roll = (minimum: number, maximum: number) => minimum + Math.floor((Math.floor(maximum - minimum) + .99999) * (draw() / 1073741823));
      const stats = [...definition.stats].sort((left, right) => String(left.statId) < String(right.statId) ? -1 : 1)
        .filter(stat => stat.statId !== 20)
        .map(stat => ({ statId: stat.statId, value: stat.kind === "scalar" ? stat.minimum : roll(stat.minimum, stat.maximum) }));
      // Eight native preparation draws precede the late socket-capacity roll.
      for (let index = 0; index < 8; index++) draw();
      const sockets = definition.stats.find(stat => stat.statId === 20);
      if (sockets) stats.push({ statId: 20, value: roll(sockets.minimum, sockets.maximum) });
      item.stats = stats;
    }
  }
  return sanitizeMarketListingItem(item);
}
