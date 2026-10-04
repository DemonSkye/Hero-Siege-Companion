import {
  MAX_RUN_PACE_ITEM_NAME_LENGTH,
  canonicalRunPaceItemKey,
  normalizeRunPaceItemName,
} from "../../../shared/run-pace";

export const LIVE_RUN_STANDARD_METRICS = ["xp", "gold", "kills", "items"] as const;
export type LiveRunStandardMetric = typeof LIVE_RUN_STANDARD_METRICS[number];

export const DEFAULT_LIVE_RUN_STANDARD_METRICS: readonly LiveRunStandardMetric[] = LIVE_RUN_STANDARD_METRICS;
export const DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS = 4;
export const MAX_LIVE_RUN_CUSTOM_ITEM_NAME_LENGTH = MAX_RUN_PACE_ITEM_NAME_LENGTH;

const LIVE_RUN_STANDARD_METRIC_SET = new Set<string>(LIVE_RUN_STANDARD_METRICS);

export function normalizeLiveRunGraphEnabledMetrics(value: unknown): LiveRunStandardMetric[] {
  if (!Array.isArray(value)) return [...DEFAULT_LIVE_RUN_STANDARD_METRICS];

  const selected = new Set(
    value.filter((metric): metric is LiveRunStandardMetric => (
      typeof metric === "string" && LIVE_RUN_STANDARD_METRIC_SET.has(metric)
    )),
  );
  return LIVE_RUN_STANDARD_METRICS.filter((metric) => selected.has(metric));
}

export function normalizeLiveRunGraphItemNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const names: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const name = normalizeRunPaceItemName(candidate).slice(0, MAX_LIVE_RUN_CUSTOM_ITEM_NAME_LENGTH).trim();
    const key = canonicalRunPaceItemKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= DEFAULT_LIVE_RUN_MAX_CUSTOM_ITEMS) break;
  }
  return names;
}
