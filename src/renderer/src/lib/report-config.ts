import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { MAGIC_FIND_FLAG_METRIC_LABEL } from "./format";
import { TRACKED_RARITY_ORDER } from "./past-runs";

export type ReportMetricId = "gold" | "xp" | "kills" | "keys" | "ores" | "materials" | "mfDrops";
export type ReportResourceDrawerId = "materials" | "keys" | "ores";
export type ReportSummaryItemId = string;

export interface ReportItemGroup {
  id: string;
  name: string;
  enabled: boolean;
  rarities: string[];
  types: number[];
  items: string[];
}

export interface PostRunReportConfig {
  summaryItems: ReportSummaryItemId[];
  summaryMetrics: ReportMetricId[];
  dropRarities: string[];
  resourceDrawers: ReportResourceDrawerId[];
  topDropLimit: number;
  trackedItems: string[];
  itemGroups: ReportItemGroup[];
  itemFilterGroupIds: string[];
}

export interface PostRunReportPreset {
  id: string;
  name: string;
  description: string;
  config: PostRunReportConfig;
}

export const REPORT_METRIC_OPTIONS: Array<{ id: ReportMetricId; label: string }> = [
  { id: "gold", label: "Gold" },
  { id: "xp", label: "XP" },
  { id: "kills", label: "Kills" },
  { id: "keys", label: "Keys" },
  { id: "ores", label: "Ore" },
  { id: "materials", label: "Materials" },
  { id: "mfDrops", label: MAGIC_FIND_FLAG_METRIC_LABEL },
];

export const REPORT_RESOURCE_DRAWER_OPTIONS: Array<{ id: ReportResourceDrawerId; label: string }> = [
  { id: "materials", label: "Materials" },
  { id: "keys", label: "Non-basic keys" },
  { id: "ores", label: "Ore mined" },
];

export const REPORT_TOP_DROP_LIMIT_OPTIONS = [3, 5, 8, 10, 15];
export const REPORT_SUMMARY_ITEM_LIMIT = 8;
const REPORT_RESOURCE_DRAWER_METRICS: Record<ReportResourceDrawerId, ReportMetricId> = {
  materials: "materials",
  keys: "keys",
  ores: "ores",
};
const LEGACY_RARITY_SUMMARY_PRIORITY = ["Satanic", "Heroic", "Angelic", "Set"];

export function reportMetricItemId(metric: ReportMetricId): ReportSummaryItemId {
  return `metric:${metric}`;
}

export function reportRarityItemId(rarity: string): ReportSummaryItemId {
  return `rarity:${rarity}`;
}

export function reportItemGroupItemId(groupId: string): ReportSummaryItemId {
  return `group:${groupId}`;
}

export function reportItemFilterGroupItemId(groupId: string): ReportSummaryItemId {
  return `filter:${groupId}`;
}

export function reportSummaryItemKind(itemId: ReportSummaryItemId): "metric" | "rarity" | "group" | "filter" | null {
  if (itemId.startsWith("metric:")) return "metric";
  if (itemId.startsWith("rarity:")) return "rarity";
  if (itemId.startsWith("group:")) return "group";
  if (itemId.startsWith("filter:")) return "filter";
  return null;
}

export function reportSummaryItemValue(itemId: ReportSummaryItemId): string {
  const separatorIndex = itemId.indexOf(":");
  return separatorIndex >= 0 ? itemId.slice(separatorIndex + 1) : itemId;
}

export function reportSummaryItemsFromLegacy(
  summaryMetrics: ReportMetricId[],
  dropRarities: string[],
  itemGroups: ReportItemGroup[] = [],
  itemFilterGroupIds: string[] = [],
  resourceDrawers: ReportResourceDrawerId[] = [],
): ReportSummaryItemId[] {
  const genericItems = uniqueSummaryItems([
    ...summaryMetrics.map(reportMetricItemId),
    ...resourceDrawers.map((drawer) => reportMetricItemId(REPORT_RESOURCE_DRAWER_METRICS[drawer])),
    ...LEGACY_RARITY_SUMMARY_PRIORITY
      .filter((rarity) => dropRarities.includes(rarity))
      .map(reportRarityItemId),
  ]);
  const customItems = uniqueSummaryItems([
    ...itemGroups.filter((group) => group.enabled).map((group) => reportItemGroupItemId(group.id)),
    ...itemFilterGroupIds.map(reportItemFilterGroupItemId),
  ]).slice(0, REPORT_SUMMARY_ITEM_LIMIT);
  if (customItems.length === 0) return genericItems.slice(0, REPORT_SUMMARY_ITEM_LIMIT);

  const genericLimit = Math.max(REPORT_SUMMARY_ITEM_LIMIT - customItems.length, 0);
  return uniqueSummaryItems([...genericItems.slice(0, genericLimit), ...customItems]).slice(0, REPORT_SUMMARY_ITEM_LIMIT);
}

export const defaultPostRunReportConfig: PostRunReportConfig = {
  summaryItems: [
    reportMetricItemId("gold"),
    reportMetricItemId("xp"),
    reportMetricItemId("kills"),
    reportMetricItemId("ores"),
    reportRarityItemId("Heroic"),
    reportRarityItemId("Angelic"),
  ],
  summaryMetrics: ["gold", "xp", "kills", "ores"],
  dropRarities: ["Heroic", "Angelic"],
  resourceDrawers: ["ores"],
  topDropLimit: 8,
  trackedItems: [],
  itemGroups: [],
  itemFilterGroupIds: [],
};

export const POST_RUN_REPORT_PRESETS: PostRunReportPreset[] = [
  {
    id: "default",
    name: "Default",
    description: "Balanced run totals, resources, and tracked rarity drops.",
    config: defaultPostRunReportConfig,
  },
  {
    id: "gear-farming",
    name: "Gear Farming",
    description: "High-value rarity drops with longer top-drop recaps.",
    config: reportPresetConfig(["gold", "xp", "kills", "mfDrops"], ["Satanic", "Heroic", "Angelic"], 10),
  },
  {
    id: "materials-ore",
    name: "Materials / Ore",
    description: "Resources and material pace for crafting sessions.",
    config: reportPresetConfig(["gold", "keys", "ores", "materials"], TRACKED_RARITY_ORDER, 5),
  },
  {
    id: "keys",
    name: "Keys",
    description: "Key totals and supporting resources for key-farming routes.",
    config: reportPresetConfig(["gold", "keys", "materials"], TRACKED_RARITY_ORDER, 5),
  },
  {
    id: "magic-find",
    name: "Magic-Find Focus",
    description: "Magic-find flag counts first, with top drops expanded.",
    config: reportPresetConfig(["mfDrops", "gold", "xp", "kills"], TRACKED_RARITY_ORDER, 15),
  },
  {
    id: "satanic-zone",
    name: "Satanic Zone",
    description: "Zone strategy recap with pace, resources, and rare drops.",
    config: reportPresetConfig(["gold", "xp", "kills", "keys", "materials", "mfDrops"], ["Satanic", "Heroic", "Angelic"], 10),
  },
];

export function normalizePostRunReportConfig(value: unknown): PostRunReportConfig {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<PostRunReportConfig>) : {};
  const legacyTrackedItems = normalizeTrackedItems(candidate.trackedItems);
  const itemGroups = normalizeReportItemGroups(candidate.itemGroups, legacyTrackedItems);
  const legacySummaryMetrics = normalizeOptionList(candidate.summaryMetrics, REPORT_METRIC_OPTIONS.map((option) => option.id), defaultPostRunReportConfig.summaryMetrics, true);
  const legacyDropRarities = normalizeOptionList(candidate.dropRarities, TRACKED_RARITY_ORDER, defaultPostRunReportConfig.dropRarities, true);
  const legacyResourceDrawers = normalizeOptionList(candidate.resourceDrawers, REPORT_RESOURCE_DRAWER_OPTIONS.map((option) => option.id), defaultPostRunReportConfig.resourceDrawers, true);
  const legacyItemFilterGroupIds = normalizeIdList(candidate.itemFilterGroupIds);
  const hasCanonicalSummaryItems = Array.isArray(candidate.summaryItems);
  const summaryItems = normalizeReportSummaryItems(
    candidate.summaryItems,
    reportSummaryItemsFromLegacy(legacySummaryMetrics, legacyDropRarities, itemGroups, legacyItemFilterGroupIds, legacyResourceDrawers),
  );
  return {
    summaryItems,
    summaryMetrics: hasCanonicalSummaryItems ? summaryMetricsFromSummaryItems(summaryItems) : legacySummaryMetrics,
    dropRarities: hasCanonicalSummaryItems ? dropRaritiesFromSummaryItems(summaryItems) : legacyDropRarities,
    resourceDrawers: hasCanonicalSummaryItems ? resourceDrawersFromSummaryItems(summaryItems) : legacyResourceDrawers,
    topDropLimit: REPORT_TOP_DROP_LIMIT_OPTIONS.includes(Number(candidate.topDropLimit))
      ? Number(candidate.topDropLimit)
      : defaultPostRunReportConfig.topDropLimit,
    trackedItems: itemGroups.length ? [] : legacyTrackedItems,
    itemGroups,
    itemFilterGroupIds: hasCanonicalSummaryItems ? itemFilterGroupIdsFromSummaryItems(summaryItems) : legacyItemFilterGroupIds,
  };
}

export function clonePostRunReportConfig(config: PostRunReportConfig): PostRunReportConfig {
  return {
    summaryItems: [...config.summaryItems],
    summaryMetrics: [...config.summaryMetrics],
    dropRarities: [...config.dropRarities],
    resourceDrawers: [...config.resourceDrawers],
    topDropLimit: config.topDropLimit,
    trackedItems: [...config.trackedItems],
    itemGroups: config.itemGroups.map((group) => ({
      ...group,
      rarities: [...group.rarities],
      types: [...group.types],
      items: [...group.items],
    })),
    itemFilterGroupIds: [...config.itemFilterGroupIds],
  };
}

export function withPostRunReportSummaryItems(config: PostRunReportConfig, summaryItems: ReportSummaryItemId[]): PostRunReportConfig {
  const nextSummaryItems = normalizeReportSummaryItems(summaryItems, []);
  return {
    ...clonePostRunReportConfig(config),
    summaryItems: nextSummaryItems,
    summaryMetrics: summaryMetricsFromSummaryItems(nextSummaryItems),
    dropRarities: dropRaritiesFromSummaryItems(nextSummaryItems),
    resourceDrawers: resourceDrawersFromSummaryItems(nextSummaryItems),
    itemFilterGroupIds: itemFilterGroupIdsFromSummaryItems(nextSummaryItems),
  };
}

export function hasMeaningfulPostRunReportGroups(config: PostRunReportConfig): boolean {
  return config.trackedItems.length > 0 || config.itemFilterGroupIds.length > 0 || config.itemGroups.length > 0;
}

export function withoutPostRunReportItemFilterGroup(config: PostRunReportConfig, groupId: string): PostRunReportConfig {
  const removedItemId = reportItemFilterGroupItemId(groupId);
  return {
    ...clonePostRunReportConfig(config),
    summaryItems: config.summaryItems.filter((itemId) => itemId !== removedItemId),
    itemFilterGroupIds: config.itemFilterGroupIds.filter((id) => id !== groupId),
  };
}

export function isDefaultPostRunReportConfig(config: PostRunReportConfig): boolean {
  return (
    sameStringList(config.summaryItems, defaultPostRunReportConfig.summaryItems) &&
    sameStringList(config.summaryMetrics, defaultPostRunReportConfig.summaryMetrics) &&
    sameStringList(config.dropRarities, defaultPostRunReportConfig.dropRarities) &&
    sameStringList(config.resourceDrawers, defaultPostRunReportConfig.resourceDrawers) &&
    config.topDropLimit === defaultPostRunReportConfig.topDropLimit &&
    config.trackedItems.length === 0 &&
    config.itemGroups.length === 0 &&
    (config.itemFilterGroupIds?.length ?? 0) === 0
  );
}

function reportPresetConfig(
  summaryMetrics: ReportMetricId[],
  dropRarities: string[],
  topDropLimit: number,
): PostRunReportConfig {
  const summaryItems = reportSummaryItemsFromLegacy(summaryMetrics, dropRarities);
  return {
    summaryItems,
    summaryMetrics: summaryMetricsFromSummaryItems(summaryItems),
    dropRarities: dropRaritiesFromSummaryItems(summaryItems),
    resourceDrawers: resourceDrawersFromSummaryItems(summaryItems),
    topDropLimit,
    trackedItems: [],
    itemGroups: [],
    itemFilterGroupIds: [],
  };
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

function normalizeOptionList<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[], allowEmpty = false): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const selected = value.map((item) => String(item).trim());
  const allowedSet = new Set<string>(allowed);
  const normalized = selected.filter((item): item is T => allowedSet.has(item));
  const unique = Array.from(new Set(normalized));
  return unique.length || allowEmpty ? unique : [...fallback];
}

function normalizeReportSummaryItems(value: unknown, fallback: ReportSummaryItemId[]): ReportSummaryItemId[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.map((item) => String(item).trim()).filter(isAllowedSummaryItem);
  return uniqueSummaryItems(items).slice(0, REPORT_SUMMARY_ITEM_LIMIT);
}

function isAllowedSummaryItem(itemId: string): boolean {
  const kind = reportSummaryItemKind(itemId);
  const value = reportSummaryItemValue(itemId);
  if (!value) return false;
  if (kind === "metric") return REPORT_METRIC_OPTIONS.some((option) => option.id === value);
  if (kind === "rarity") return TRACKED_RARITY_ORDER.includes(value);
  return kind === "group" || kind === "filter";
}

function uniqueSummaryItems(items: ReportSummaryItemId[]): ReportSummaryItemId[] {
  const seen = new Set<string>();
  const unique: ReportSummaryItemId[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
  }
  return unique;
}

function summaryMetricsFromSummaryItems(items: ReportSummaryItemId[]): ReportMetricId[] {
  const allowed = new Set<ReportMetricId>(REPORT_METRIC_OPTIONS.map((option) => option.id));
  return items
    .filter((itemId) => reportSummaryItemKind(itemId) === "metric")
    .map(reportSummaryItemValue)
    .filter((value): value is ReportMetricId => allowed.has(value as ReportMetricId));
}

function dropRaritiesFromSummaryItems(items: ReportSummaryItemId[]): string[] {
  return items
    .filter((itemId) => reportSummaryItemKind(itemId) === "rarity")
    .map(reportSummaryItemValue)
    .filter((rarity) => TRACKED_RARITY_ORDER.includes(rarity));
}

function resourceDrawersFromSummaryItems(items: ReportSummaryItemId[]): ReportResourceDrawerId[] {
  const resourceMetrics = new Set<ReportResourceDrawerId>(["keys", "ores", "materials"]);
  return items
    .filter((itemId) => reportSummaryItemKind(itemId) === "metric")
    .map(reportSummaryItemValue)
    .filter((value): value is ReportResourceDrawerId => resourceMetrics.has(value as ReportResourceDrawerId));
}

function itemFilterGroupIdsFromSummaryItems(items: ReportSummaryItemId[]): string[] {
  return items
    .filter((itemId) => reportSummaryItemKind(itemId) === "filter")
    .map(reportSummaryItemValue)
    .filter(Boolean);
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
