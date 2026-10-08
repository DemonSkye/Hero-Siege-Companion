import type { ItemBaseStat } from "../shared/item-base-stat-catalog";
import { constructorFieldGap, NON_RANDOM_CONSTRUCTOR_STATS } from "../shared/item-listing-definition";

/** Build 24868792: retained CPR double arithmetic, never BigInt arithmetic. */
export class ItemStatRandom {
  private state: number;
  draws = 0;
  constructor(seed: number) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fff_ffff) throw new Error("Invalid item seed");
    this.state = seed;
  }
  draw(): number {
    this.state = ((1789570533 * this.state + 465707) % 2147483648) & 1073741823;
    this.draws++;
    return this.state;
  }
  range(minimum: number, maximum: number): number {
    return minimum + Math.floor((Math.floor(maximum - minimum) + 0.99999) * (this.draw() / 1073741823));
  }
}

// Retained DontRandomStats exclusions. These are native generation cases,
// independent of Market filter semantics or whether an English label is known.
export const NON_RANDOM_ITEM_STATS = NON_RANDOM_CONSTRUCTOR_STATS;

export type GeneratedStatReason = "constructor-value" | "prior-draw" | "native-stat-case";
export interface ItemStatGeneration {
  stats: { statId: number; value: number }[];
  unknownStats: { statId: number; reason: GeneratedStatReason }[];
  draws: number;
}

/** Main-only constructor expansion. Unknown consumers invalidate later draws,
 * while independent scalar values survive. No compact data enters the result. */
export function generateConstructorStats(seed: number, fields: readonly ItemBaseStat[],
  options: { incomplete?: boolean; latePhaseUnknown?: boolean } = {}): ItemStatGeneration {
  const random = new ItemStatRandom(seed);
  const stats: ItemStatGeneration["stats"] = [];
  const unknownStats: ItemStatGeneration["unknownStats"] = [];
  let drawPositionKnown = !options.incomplete;
  const ordered = [...fields].sort((a, b) => String(a.statId) < String(b.statId) ? -1 : String(a.statId) > String(b.statId) ? 1 : 0);
  for (const stat of ordered) {
    if (stat.statId === 20) continue;
    if (NON_RANDOM_ITEM_STATS.has(stat.statId) || stat.statId < 22 || stat.statId >= 476) {
      unknownStats.push({ statId: stat.statId, reason: "native-stat-case" });
      continue;
    }
    const gap = constructorFieldGap(stat);
    if (gap || stat.kind !== "scalar" && stat.kind !== "range") {
      unknownStats.push({ statId: stat.statId, reason: gap ?? "constructor-value" });
      drawPositionKnown = false;
      continue;
    }
    if (stat.kind === "scalar") stats.push({ statId: stat.statId, value: stat.minimum });
    else if (drawPositionKnown) stats.push({ statId: stat.statId, value: random.range(stat.minimum, stat.maximum) });
    else unknownStats.push({ statId: stat.statId, reason: "prior-draw" });
  }
  // Audited preparation phase: four pairs, even with an empty affix pool.
  for (let draw = 0; draw < 8; draw++) random.draw();
  const sockets = ordered.find(stat => stat.statId === 20);
  if (sockets) {
    const gap = constructorFieldGap(sockets);
    if (gap) unknownStats.push({ statId: 20, reason: gap });
    else if (!drawPositionKnown || options.latePhaseUnknown) unknownStats.push({ statId: 20, reason: "prior-draw" });
    else if (sockets.kind === "scalar" || sockets.kind === "range") {
      // The late native socket case consumes a draw even at a fixed capacity.
      stats.push({ statId: 20, value: random.range(sockets.minimum, sockets.maximum) });
    } else unknownStats.push({ statId: 20, reason: "constructor-value" });
  }
  return { stats, unknownStats, draws: random.draws };
}
