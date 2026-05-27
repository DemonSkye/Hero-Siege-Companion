import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { TRACKED_RARITY_ORDER } from "./past-runs";

export type ReportMetricId = "gold" | "xp" | "kills" | "keys" | "ores" | "materials" | "mfDrops";
export type ReportResourceDrawerId = "materials" | "keys" | "ores";

export interface ReportItemGroup {
  id: string;
  name: string;
  enabled: boolean;
  rarities: string[];
  types: number[];
  items: string[];
}

export interface PostRunReportConfig {
  summaryMetrics: ReportMetricId[];
  dropRarities: string[];
  resourceDrawers: ReportResourceDrawerId[];
  topDropLimit: number;
  trackedItems: string[];
  itemGroups: ReportItemGroup[];
  itemFilterGroupIds: string[];
}

export const REPORT_METRIC_OPTIONS: Array<{ id: ReportMetricId; label: string }> = [
  { id: "gold", label: "Gold" },
  { id: "xp", label: "XP" },
  { id: "kills", label: "Kills" },
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
  summaryMetrics: ["gold", "xp", "kills", "keys", "ores", "materials", "mfDrops"],
  dropRarities: TRACKED_RARITY_ORDER,
  resourceDrawers: ["materials", "keys", "ores"],
  topDropLimit: 8,
  trackedItems: [],
  itemGroups: [],
  itemFilterGroupIds: [],
};

export function normalizePostRunReportConfig(value: unknown): PostRunReportConfig {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<PostRunReportConfig>) : {};
  const legacyTrackedItems = normalizeTrackedItems(candidate.trackedItems);
  const itemGroups = normalizeReportItemGroups(candidate.itemGroups, legacyTrackedItems);
  return {
    summaryMetrics: normalizeOptionList(candidate.summaryMetrics, REPORT_METRIC_OPTIONS.map((option) => option.id), defaultPostRunReportConfig.summaryMetrics),
    dropRarities: normalizeOptionList(candidate.dropRarities, TRACKED_RARITY_ORDER, defaultPostRunReportConfig.dropRarities),
    resourceDrawers: normalizeOptionList(candidate.resourceDrawers, REPORT_RESOURCE_DRAWER_OPTIONS.map((option) => option.id), defaultPostRunReportConfig.resourceDrawers),
    topDropLimit: REPORT_TOP_DROP_LIMIT_OPTIONS.includes(Number(candidate.topDropLimit))
      ? Number(candidate.topDropLimit)
      : defaultPostRunReportConfig.topDropLimit,
    trackedItems: itemGroups.length ? [] : legacyTrackedItems,
    itemGroups,
    itemFilterGroupIds: normalizeIdList(candidate.itemFilterGroupIds),
  };
}

export function isDefaultPostRunReportConfig(config: PostRunReportConfig): boolean {
  return (
    sameStringList(config.summaryMetrics, defaultPostRunReportConfig.summaryMetrics) &&
    sameStringList(config.dropRarities, defaultPostRunReportConfig.dropRarities) &&
    sameStringList(config.resourceDrawers, defaultPostRunReportConfig.resourceDrawers) &&
    config.topDropLimit === defaultPostRunReportConfig.topDropLimit &&
    config.trackedItems.length === 0 &&
    config.itemGroups.length === 0 &&
    (config.itemFilterGroupIds?.length ?? 0) === 0
  );
}

export function createReportItemGroup(name: string, index: number): ReportItemGroup {
  return {
    id: `report-group-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: cleanGroupName(name) || `Group ${index + 1}`,
    enabled: true,
    rarities: [],
    types: [],
    items: [],
  };
}

export function normalizeReportItemGroups(value: unknown, legacyTrackedItems: string[] = []): ReportItemGroup[] {
  const values = Array.isArray(value) ? value : [];
  const groups = values.map(normalizeReportItemGroup).filter(Boolean) as ReportItemGroup[];
  if (groups.length) return groups.slice(0, 40);
  if (legacyTrackedItems.length === 0) return [];
  return [
    {
      id: "legacy-focus-items",
      name: "Focus Items",
      enabled: true,
      rarities: [],
      types: [],
      items: legacyTrackedItems,
    },
  ];
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

function normalizeTypeList(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [];
  const allowedTypes = new Set(Object.keys(ITEM_TYPE_NAMES).map(Number));
  return Array.from(new Set(values.map(Number).filter((type) => Number.isFinite(type) && allowedTypes.has(type)).map(Math.trunc)));
}

function normalizeIdList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of values) {
    const id = String(item).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.slice(0, 40);
}

function normalizeReportItemGroup(value: unknown): ReportItemGroup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ReportItemGroup>;
  const id = typeof candidate.id === "string" && candidate.id.trim()
    ? candidate.id.trim()
    : `report-group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = cleanGroupName(candidate.name) || "Untitled Group";
  return {
    id,
    name,
    enabled: candidate.enabled === undefined ? true : Boolean(candidate.enabled),
    rarities: normalizeOptionList(candidate.rarities, TRACKED_RARITY_ORDER, []),
    types: normalizeTypeList(candidate.types),
    items: normalizeTrackedItems(candidate.items),
  };
}

function cleanGroupName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "";
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
