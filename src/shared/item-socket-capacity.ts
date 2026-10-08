import { itemBaseStatDefinition } from "./item-base-stat-catalog";

export interface ItemBaseSocketRange {
  minimum: number;
  maximum: number;
}

export type SocketFilterAdjustment = "invalid" | "order";

export function normalizeSavedSocketRange(minimum: unknown, maximum: unknown):
  { minSockets?: number; maxSockets?: number; adjustment?: SocketFilterAdjustment } {
  const valid = (value: unknown): value is number => typeof value === "number"
    && Number.isSafeInteger(value) && value >= 0 && value <= 6;
  const minSockets = valid(minimum) ? (Object.is(minimum, -0) ? 0 : minimum) : undefined;
  const maxSockets = valid(maximum) ? (Object.is(maximum, -0) ? 0 : maximum) : undefined;
  if (minSockets !== undefined && maxSockets !== undefined && minSockets > maxSockets) return { adjustment: "order" };
  return { ...(minSockets === undefined ? {} : { minSockets }), ...(maxSockets === undefined ? {} : { maxSockets }),
    ...((minimum != null && !valid(minimum)) || (maximum != null && !valid(maximum)) ? { adjustment: "invalid" as const } : {}) };
}

export function socketFilterAdjustmentMessage(adjustment: SocketFilterAdjustment): string {
  return adjustment === "order"
    ? "Saved socket range cleared: minimum was greater than maximum. Other stat filters were preserved."
    : "Invalid saved socket bound cleared. Other stat filters were preserved.";
}

/** Retained base range, independent of populated positional slots and final
 * item capacity. Missing evidence does not establish socketlessness.
 */
export function itemBaseSocketRange(itemKey: string | null): ItemBaseSocketRange | null {
  const stat = itemBaseStatDefinition(itemKey)?.stats.find(value => value.statId === 20);
  if (!stat || (stat.kind !== "scalar" && stat.kind !== "range")) return null;
  if (!Number.isSafeInteger(stat.minimum) || !Number.isSafeInteger(stat.maximum)
    || stat.minimum < 0 || stat.minimum > stat.maximum || stat.maximum < 1 || stat.maximum > 6) return null;
  return { minimum: stat.minimum, maximum: stat.maximum };
}
