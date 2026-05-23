import { TRACKED_RARITY_ORDER } from "./past-runs";

export type ReportMetricId = "gold" | "xp" | "keys" | "ores" | "materials" | "mfDrops";
export type ReportResourceDrawerId = "materials" | "keys" | "ores";

export interface PostRunReportConfig {
  summaryMetrics: ReportMetricId[];
  dropRarities: string[];
  resourceDrawers: ReportResourceDrawerId[];
  topDropLimit: number;
  trackedItems: string[];
}

export const REPORT_METRIC_OPTIONS: Array<{ id: ReportMetricId; label: string }> = [
  { id: "gold", label: "Gold" },
  { id: "xp", label: "XP" },
  { id: "keys", label: "Keys" },
  { id: "ores", label: "Ore" },
  { id: "materials", label: "Materials" },
  { id: "mfDrops", label: "MF drops" },
];

export const REPORT_RESOURCE_DRAWER_OPTIONS: Array<{ id: ReportResourceDrawerId; label: string }> = [
  { id: "materials", label: "Materials" },
  { id: "keys", label: "Non-basic keys" },
  { id: "ores", label: "Ore mined" },
];

export const REPORT_TOP_DROP_LIMIT_OPTIONS = [3, 5, 8, 10, 15];

export const defaultPostRunReportConfig: PostRunReportConfig = {
  summaryMetrics: ["gold", "xp", "keys", "ores", "materials", "mfDrops"],
  dropRarities: TRACKED_RARITY_ORDER,
  resourceDrawers: ["materials", "keys", "ores"],
  topDropLimit: 8,
  trackedItems: [],
};

export function normalizePostRunReportConfig(value: unknown): PostRunReportConfig {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<PostRunReportConfig>) : {};
  return {
    summaryMetrics: normalizeOptionList(candidate.summaryMetrics, REPORT_METRIC_OPTIONS.map((option) => option.id), defaultPostRunReportConfig.summaryMetrics),
    dropRarities: normalizeOptionList(candidate.dropRarities, TRACKED_RARITY_ORDER, defaultPostRunReportConfig.dropRarities),
    resourceDrawers: normalizeOptionList(candidate.resourceDrawers, REPORT_RESOURCE_DRAWER_OPTIONS.map((option) => option.id), defaultPostRunReportConfig.resourceDrawers),
    topDropLimit: REPORT_TOP_DROP_LIMIT_OPTIONS.includes(Number(candidate.topDropLimit))
      ? Number(candidate.topDropLimit)
      : defaultPostRunReportConfig.topDropLimit,
    trackedItems: normalizeTrackedItems(candidate.trackedItems),
  };
}

export function isDefaultPostRunReportConfig(config: PostRunReportConfig): boolean {
  return (
    sameStringList(config.summaryMetrics, defaultPostRunReportConfig.summaryMetrics) &&
    sameStringList(config.dropRarities, defaultPostRunReportConfig.dropRarities) &&
    sameStringList(config.resourceDrawers, defaultPostRunReportConfig.resourceDrawers) &&
    config.topDropLimit === defaultPostRunReportConfig.topDropLimit &&
    config.trackedItems.length === 0
  );
}

function normalizeOptionList<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  const selected = Array.isArray(value) ? value.map((item) => String(item).trim()) : [];
  const allowedSet = new Set<string>(allowed);
  const normalized = selected.filter((item): item is T => allowedSet.has(item));
  const unique = Array.from(new Set(normalized));
  return unique.length ? unique : [...fallback];
}

function normalizeTrackedItems(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of values) {
    const name = String(item).trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    items.push(name);
  }
  return items.slice(0, 150);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
