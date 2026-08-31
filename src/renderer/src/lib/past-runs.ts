import {
  canonicalPastRunTrackerName,
  pastRunItemNameKey,
  pastRunOreTrackerName,
  type ItemDropCounter,
  type PastRunSummary,
  type ResourceCounter,
} from "../../../shared/stats";
import {
  MAGIC_FIND_FLAG_METRIC_LABEL,
  formatDateTime,
  formatDuration,
  formatMagicFindFlagCount,
  formatNumber,
} from "./format";
import { itemFilterHasTimelineCriteria, itemMatchesItemFilterCriteria, type ItemFilterCriteriaGroup, type ItemFilterGroup } from "./item-filters";
import { itemTypeValueForName } from "./item-options";
import type { PostRunReportConfig, ReportMetricId, ReportSummaryItemId } from "./report-config";

export const TRACKED_RARITY_ORDER = ["Set", "Satanic", "Heroic", "Angelic"];

export interface PastRunAggregate {
  runCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  totalGold: number;
  totalXp: number;
  totalKills: number;
  goldPerHour: number;
  xpPerHour: number;
  killsPerHour: number;
  bestGoldPerHour: number;
  bestXpPerHour: number;
  bestKillsPerHour: number;
  totalKeys: number;
  totalOres: number;
  totalMaterials: number;
  totalMfDrops: number;
  drops: Array<{ rarity: string; total: number; mf: number; unique: number }>;
  topDrops: ItemDropCounter[];
}

export interface PastRunDropFilterGroup {
  enabled: boolean;
  rarities: string[];
  types: number[];
  items: ItemFilterCriteriaGroup["items"];
  emptyCriteriaMatchesAll?: boolean;
}

export interface PastRunsExportPayload {
  app: "hero-siege-companion";
  kind: "past-runs";
  version: 1;
  exportedAt: string;
  filter: {
    query: string;
    runCount: number;
  };
  summary: PastRunAggregate;
  runs: PastRunSummary[];
}

export interface PastRunMetricRow {
  id: ReportMetricId;
  label: string;
  value: number;
  detail: string;
}

export type PastRunReportItemDetail =
  | { kind: "drops"; drops: ItemDropCounter[]; empty: string }
  | { kind: "resources"; resources: ResourceCounter[]; imageKind: "key" | "ore" | "material"; empty: string };

export interface PastRunReportItemRow {
  id: ReportSummaryItemId;
  label: string;
  value: number;
  detail: string;
  mf?: number;
  detailPanel?: PastRunReportItemDetail;
}

export function hasReportItemDetailEntries(detail: PastRunReportItemDetail | undefined): boolean {
  if (!detail) return false;
  return detail.kind === "drops" ? detail.drops.length > 0 : detail.resources.length > 0;
}

export interface PastRunShareOptions {
  reportConfig?: PostRunReportConfig;
  itemFilterGroups?: ItemFilterGroup[];
  summaryMetrics?: ReportMetricId[];
  dropRarities?: string[];
  topDropLimit?: number;
  activeReportGroups?: PastRunDropFilterGroup[];
}

export interface PastRunsAggregateShareOptions {
  title: string;
  query: string;
  runs?: PastRunSummary[];
  aggregate: PastRunAggregate;
  reportConfig?: PostRunReportConfig;
  itemFilterGroups?: ItemFilterGroup[];
  summaryMetrics?: ReportMetricId[];
}

export function runTrackedItems(run: PastRunSummary, rarities = TRACKED_RARITY_ORDER, trackedItems: string[] = [], groups: PastRunDropFilterGroup[] = []) {
  return effectiveRarities(rarities, groups).map((rarity) => ({
    rarity,
    total: runDropTotal(run, rarity, trackedItems, groups),
    mf: runDropMf(run, rarity, trackedItems, groups),
    drops: runDropBreakdown(run, rarity, trackedItems, groups),
  }));
}

export function aggregateMetricRows(aggregate: PastRunAggregate, summaryMetrics: ReportMetricId[]): PastRunMetricRow[] {
  const rows: Record<ReportMetricId, PastRunMetricRow> = {
    gold: { id: "gold", label: "Gold/h", value: aggregate.goldPerHour, detail: `Best per hour ${formatNumber(aggregate.bestGoldPerHour)}` },
    xp: { id: "xp", label: "XP/h", value: aggregate.xpPerHour, detail: `Best per hour ${formatNumber(aggregate.bestXpPerHour)}` },
    kills: { id: "kills", label: "Kills/h", value: aggregate.killsPerHour, detail: `Best per hour ${formatNumber(aggregate.bestKillsPerHour)}` },
    keys: { id: "keys", label: "Keys", value: aggregate.totalKeys, detail: `Average per run ${formatNumber(averagePerRun(aggregate.totalKeys, aggregate.runCount))}` },
    ores: { id: "ores", label: "Ore", value: aggregate.totalOres, detail: `Average per run ${formatNumber(averagePerRun(aggregate.totalOres, aggregate.runCount))}` },
    materials: { id: "materials", label: "Materials", value: aggregate.totalMaterials, detail: `Average per run ${formatNumber(averagePerRun(aggregate.totalMaterials, aggregate.runCount))}` },
    mfDrops: { id: "mfDrops", label: MAGIC_FIND_FLAG_METRIC_LABEL, value: aggregate.totalMfDrops, detail: `Total gold ${formatNumber(aggregate.totalGold)}` },
  };
  return summaryMetrics.map((metric) => rows[metric]).filter(Boolean);
}

export function runMetricRows(
  run: PastRunSummary,
  summaryMetrics: ReportMetricId[],
  rarities = TRACKED_RARITY_ORDER,
  groups: PastRunDropFilterGroup[] = [],
): PastRunMetricRow[] {
  const drops = runTrackedItems(run, rarities, [], groups);
  const totalDrops = drops.reduce((total, item) => total + item.total, 0);
  const totalMfDrops = drops.reduce((total, item) => total + item.mf, 0);
  const rows: Record<ReportMetricId, PastRunMetricRow> = {
    gold: { id: "gold", label: "Gold", value: run.totalGoldGained, detail: `${formatNumber(ratePerHour(run.totalGoldGained, run.durationMs))}/h` },
    xp: { id: "xp", label: "XP", value: run.totalXpGained, detail: `${formatNumber(ratePerHour(run.totalXpGained, run.durationMs))}/h` },
    kills: { id: "kills", label: "Kills", value: run.totalKillsGained ?? 0, detail: `${formatNumber(ratePerHour(run.totalKillsGained ?? 0, run.durationMs))}/h` },
    keys: { id: "keys", label: "Keys", value: runResourceTotal(run.keys), detail: `${runResourceTypeCount(run.keys)} types` },
    ores: { id: "ores", label: "Ore", value: runResourceTotal(run.ores), detail: `${runResourceTypeCount(run.ores)} types` },
    materials: { id: "materials", label: "Materials", value: runResourceTotal(run.materials ?? []), detail: `${runResourceTypeCount(run.materials)} types` },
    mfDrops: { id: "mfDrops", label: MAGIC_FIND_FLAG_METRIC_LABEL, value: totalMfDrops, detail: `${totalDrops} tracked drops` },
  };
  return summaryMetrics.map((metric) => rows[metric]).filter(Boolean);
}

export function runReportItemRows(run: PastRunSummary, config: PostRunReportConfig, itemFilterGroups: ItemFilterGroup[] = []): PastRunReportItemRow[] {
  const summaryRows = config.summaryItems.map((itemId) => runReportItemRow(run, config, itemFilterGroups, itemId)).filter(Boolean) as PastRunReportItemRow[];
  return [...summaryRows, ...exactTrackedItemNames(config).map((name) => runExactTrackedItemRow(run, name))];
}

export function aggregateReportItemRows(runs: PastRunSummary[], aggregate: PastRunAggregate, config: PostRunReportConfig, itemFilterGroups: ItemFilterGroup[] = []): PastRunReportItemRow[] {
  const summaryRows = config.summaryItems.map((itemId) => aggregateReportItemRow(runs, aggregate, config, itemFilterGroups, itemId)).filter(Boolean) as PastRunReportItemRow[];
  return [...summaryRows, ...exactTrackedItemNames(config).map((name) => aggregateExactTrackedItemRow(runs, aggregate, name))];
}

export function exactTrackedItemRowId(name: string): ReportSummaryItemId {
  return `exact:${encodeURIComponent(pastRunItemNameKey(canonicalPastRunTrackerName(name)))}`;
}

export function runExactTrackedItemCount(run: PastRunSummary, name: string): { total: number; mf: number; source: "drop" | "resource" | "none" } {
  const target = pastRunItemNameKey(canonicalPastRunTrackerName(name));
  if (!target) return { total: 0, mf: 0, source: "none" };

  let total = 0;
  let mf = 0;
  let matched = false;
  for (const item of run.itemTotals ?? []) {
    if (pastRunItemNameKey(canonicalPastRunTrackerName(item.name)) !== target) continue;
    matched = true;
    total += Math.max(item.total, 0);
    mf += Math.max(Math.min(item.mf, item.total), 0);
  }

  let resourceTotal = 0;
  let resourceMatched = false;
  for (const resource of [...run.keys, ...(run.materials ?? [])]) {
    if (pastRunItemNameKey(canonicalPastRunTrackerName(resource.name)) !== target) continue;
    resourceMatched = true;
    resourceTotal += Math.max(resource.total, 0);
  }
  for (const resource of run.ores) {
    if (pastRunItemNameKey(pastRunOreTrackerName(resource.name, resource.id)) !== target) continue;
    resourceMatched = true;
    resourceTotal += Math.max(resource.total, 0);
  }
  if (matched) {
    const resourceOnly = resourceMatched && total === resourceTotal && mf === 0;
    return { total, mf, source: resourceOnly ? "resource" : "drop" };
  }
  if (resourceMatched) return { total: resourceTotal, mf: 0, source: "resource" };

  for (const breakdown of Object.values(run.itemBreakdown ?? {})) {
    for (const item of Object.values(breakdown)) {
      if (pastRunItemNameKey(canonicalPastRunTrackerName(item.name)) !== target) continue;
      matched = true;
      total += Math.max(item.total, 0);
      mf += Math.max(Math.min(item.mf, item.total), 0);
    }
  }
  return matched ? { total, mf, source: "drop" } : { total: 0, mf: 0, source: "none" };
}

function exactTrackedItemNames(config: PostRunReportConfig): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const rawName of config.exactTrackedItems ?? []) {
    const name = canonicalPastRunTrackerName(rawName);
    const key = pastRunItemNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function runExactTrackedItemRow(run: PastRunSummary, name: string): PastRunReportItemRow {
  const count = runExactTrackedItemCount(run, name);
  const rate = ratePerHour(count.total, run.durationMs);
  const detail = count.source === "none"
    ? "No saved matches"
    : count.source === "resource"
      ? `${formatNumber(rate)}/h - Saved resource`
      : `${formatNumber(rate)}/h - ${formatMagicFindFlagCount(count.mf, { short: true })}`;
  return {
    id: exactTrackedItemRowId(name),
    label: name,
    value: count.total,
    detail,
    ...(count.source === "drop" ? { mf: count.mf } : {}),
  };
}

function aggregateExactTrackedItemRow(runs: PastRunSummary[], aggregate: PastRunAggregate, name: string): PastRunReportItemRow {
  let total = 0;
  let mf = 0;
  let hasDrop = false;
  let hasResource = false;
  for (const run of runs) {
    const count = runExactTrackedItemCount(run, name);
    total += count.total;
    mf += count.mf;
    if (count.source === "drop") hasDrop = true;
    if (count.source === "resource") hasResource = true;
  }
  if (total <= 0) return { id: exactTrackedItemRowId(name), label: name, value: 0, detail: "No saved matches" };

  const rate = formatNumber(ratePerHour(total, aggregate.totalDurationMs));
  const average = formatNumber(averagePerRun(total, aggregate.runCount));
  const sourceDetail = hasResource && !hasDrop
    ? "Saved resource"
    : hasDrop && !hasResource
      ? formatMagicFindFlagCount(mf, { short: true })
      : "Saved entries";
  return {
    id: exactTrackedItemRowId(name),
    label: name,
    value: total,
    detail: `${rate}/h - ${average}/run - ${sourceDetail}`,
    ...(hasDrop ? { mf } : {}),
  };
}

function runReportItemRow(run: PastRunSummary, config: PostRunReportConfig, itemFilterGroups: ItemFilterGroup[], itemId: ReportSummaryItemId): PastRunReportItemRow | null {
  const kind = reportItemKind(itemId);
  const value = reportItemValue(itemId);
  if (kind === "metric") return runMetricReportItemRow(run, value as ReportMetricId, config, itemFilterGroups);
  if (kind === "rarity") return runDropReportItemRow(value, runDropTotal(run, value), runDropMf(run, value), runDropBreakdown(run, value), itemId);
  const group = reportGroupForItem(config, itemFilterGroups, itemId);
  if (!group) return null;
  const drops = runGroupedDropBreakdown(run, group.criteria);
  return runDropReportItemRow(group.label, breakdownItemTotal(drops), breakdownItemMf(drops), drops, itemId);
}

function aggregateReportItemRow(
  runs: PastRunSummary[],
  aggregate: PastRunAggregate,
  config: PostRunReportConfig,
  itemFilterGroups: ItemFilterGroup[],
  itemId: ReportSummaryItemId,
): PastRunReportItemRow | null {
  const kind = reportItemKind(itemId);
  const value = reportItemValue(itemId);
  if (kind === "metric") return aggregateMetricReportItemRow(runs, aggregate, value as ReportMetricId, itemId);
  if (kind === "rarity") {
    const drops = aggregateGroupedDropBreakdown(runs, { enabled: true, rarities: [value], types: [], items: [], emptyCriteriaMatchesAll: false });
    return runDropReportItemRow(value, breakdownItemTotal(drops), breakdownItemMf(drops), drops, itemId);
  }
  const group = reportGroupForItem(config, itemFilterGroups, itemId);
  if (!group) return null;
  const drops = aggregateGroupedDropBreakdown(runs, group.criteria);
  return runDropReportItemRow(group.label, breakdownItemTotal(drops), breakdownItemMf(drops), drops, itemId);
}

function runMetricReportItemRow(run: PastRunSummary, metric: ReportMetricId, config: PostRunReportConfig, itemFilterGroups: ItemFilterGroup[]): PastRunReportItemRow | null {
  const drops = runTrackedItems(run, config.dropRarities, [], reportGroupsFromConfig(config, itemFilterGroups));
  const totalDrops = drops.reduce((total, item) => total + item.total, 0);
  const totalMfDrops = drops.reduce((total, item) => total + item.mf, 0);
  const rows: Record<ReportMetricId, PastRunReportItemRow> = {
    gold: { id: "metric:gold", label: "Gold", value: run.totalGoldGained, detail: `${formatNumber(ratePerHour(run.totalGoldGained, run.durationMs))}/h` },
    xp: { id: "metric:xp", label: "XP", value: run.totalXpGained, detail: `${formatNumber(ratePerHour(run.totalXpGained, run.durationMs))}/h` },
    kills: { id: "metric:kills", label: "Kills", value: run.totalKillsGained ?? 0, detail: `${formatNumber(ratePerHour(run.totalKillsGained ?? 0, run.durationMs))}/h` },
    keys: metricResourceRow("metric:keys", "Keys", run.keys, "key", "No non-basic keys logged."),
    ores: metricResourceRow("metric:ores", "Ore", run.ores, "ore", "No ore logged."),
    materials: metricResourceRow("metric:materials", "Materials", run.materials ?? [], "material", "No materials logged."),
    mfDrops: { id: "metric:mfDrops", label: MAGIC_FIND_FLAG_METRIC_LABEL, value: totalMfDrops, detail: `${totalDrops} tracked drops` },
  };
  return rows[metric] ?? null;
}

function aggregateMetricReportItemRow(runs: PastRunSummary[], aggregate: PastRunAggregate, metric: ReportMetricId, itemId: ReportSummaryItemId): PastRunReportItemRow | null {
  const rows: Record<ReportMetricId, PastRunReportItemRow> = {
    gold: { id: itemId, label: "Gold/h", value: aggregate.goldPerHour, detail: `Best per hour ${formatNumber(aggregate.bestGoldPerHour)}` },
    xp: { id: itemId, label: "XP/h", value: aggregate.xpPerHour, detail: `Best per hour ${formatNumber(aggregate.bestXpPerHour)}` },
    kills: { id: itemId, label: "Kills/h", value: aggregate.killsPerHour, detail: `Best per hour ${formatNumber(aggregate.bestKillsPerHour)}` },
    keys: aggregateResourceRow(itemId, "Keys", aggregateResources(runs, "keys"), "key", "No non-basic keys logged.", aggregate.runCount),
    ores: aggregateResourceRow(itemId, "Ore", aggregateResources(runs, "ores"), "ore", "No ore logged.", aggregate.runCount),
    materials: aggregateResourceRow(itemId, "Materials", aggregateResources(runs, "materials"), "material", "No materials logged.", aggregate.runCount),
    mfDrops: { id: itemId, label: MAGIC_FIND_FLAG_METRIC_LABEL, value: aggregate.totalMfDrops, detail: `Total gold ${formatNumber(aggregate.totalGold)}` },
  };
  return rows[metric] ?? null;
}

function metricResourceRow(
  id: ReportSummaryItemId,
  label: string,
  resources: ResourceCounter[],
  imageKind: "key" | "ore" | "material",
  empty: string,
): PastRunReportItemRow {
  return {
    id,
    label,
    value: runResourceTotal(resources),
    detail: `${runResourceTypeCount(resources)} types`,
    detailPanel: { kind: "resources", resources, imageKind, empty },
  };
}

function aggregateResourceRow(
  id: ReportSummaryItemId,
  label: string,
  resources: ResourceCounter[],
  imageKind: "key" | "ore" | "material",
  empty: string,
  runCount: number,
): PastRunReportItemRow {
  return {
    id,
    label,
    value: runResourceTotal(resources),
    detail: `Average per run ${formatNumber(averagePerRun(runResourceTotal(resources), runCount))}`,
    detailPanel: { kind: "resources", resources, imageKind, empty },
  };
}

function runDropReportItemRow(label: string, value: number, mf: number, drops: ItemDropCounter[], id: ReportSummaryItemId): PastRunReportItemRow {
  return {
    id,
    label,
    value,
    detail: `${formatMagicFindFlagCount(mf, { short: true })} - ${drops.length} unique`,
    detailPanel: { kind: "drops", drops, empty: `No saved ${label.toLowerCase()} item detail for this run.` },
  };
}

function reportItemKind(itemId: ReportSummaryItemId): "metric" | "rarity" | "group" | "filter" | null {
  if (itemId.startsWith("metric:")) return "metric";
  if (itemId.startsWith("rarity:")) return "rarity";
  if (itemId.startsWith("group:")) return "group";
  if (itemId.startsWith("filter:")) return "filter";
  return null;
}

function reportItemValue(itemId: ReportSummaryItemId): string {
  const separatorIndex = itemId.indexOf(":");
  return separatorIndex >= 0 ? itemId.slice(separatorIndex + 1) : itemId;
}

function reportGroupsFromConfig(config: PostRunReportConfig, itemFilterGroups: ItemFilterGroup[]): PastRunDropFilterGroup[] {
  return [
    ...config.itemGroups
      .filter((group) => config.summaryItems.includes(`group:${group.id}`))
      .map((group) => ({ ...group, enabled: true, emptyCriteriaMatchesAll: true })),
    ...itemFilterGroups
      .filter((group) => config.summaryItems.includes(`filter:${group.id}`) && itemFilterHasTimelineCriteria(group))
      .map((group) => ({
        enabled: true,
        rarities: group.rarities,
        types: group.types,
        items: group.items,
        emptyCriteriaMatchesAll: false,
      })),
  ];
}

function reportGroupForItem(config: PostRunReportConfig, itemFilterGroups: ItemFilterGroup[], itemId: ReportSummaryItemId): { label: string; criteria: PastRunDropFilterGroup } | null {
  const kind = reportItemKind(itemId);
  const id = reportItemValue(itemId);
  if (kind === "group") {
    const group = config.itemGroups.find((candidate) => candidate.id === id);
    if (!group) return null;
    return { label: group.name, criteria: { ...group, enabled: true, emptyCriteriaMatchesAll: true } };
  }
  if (kind === "filter") {
    const group = itemFilterGroups.find((candidate) => candidate.id === id);
    if (!group || !itemFilterHasTimelineCriteria(group)) return null;
    return {
      label: group.name,
      criteria: {
        enabled: true,
        rarities: group.rarities,
        types: group.types,
        items: group.items,
        emptyCriteriaMatchesAll: false,
      },
    };
  }
  return null;
}

function runGroupedDropBreakdown(run: PastRunSummary, group: PastRunDropFilterGroup): ItemDropCounter[] {
  const drops: Record<string, ItemDropCounter> = {};
  for (const rarity of effectiveRarities(TRACKED_RARITY_ORDER, [group])) {
    for (const drop of runDropBreakdown(run, rarity, [], [group])) {
      drops[drop.name] = drops[drop.name] ?? { name: drop.name, total: 0, mf: 0 };
      drops[drop.name].total += drop.total;
      drops[drop.name].mf += drop.mf;
    }
  }
  return sortedDropBreakdown(drops);
}

function aggregateGroupedDropBreakdown(runs: PastRunSummary[], group: PastRunDropFilterGroup): ItemDropCounter[] {
  const drops: Record<string, ItemDropCounter> = {};
  for (const run of runs) {
    for (const drop of runGroupedDropBreakdown(run, group)) {
      drops[drop.name] = drops[drop.name] ?? { name: drop.name, total: 0, mf: 0 };
      drops[drop.name].total += drop.total;
      drops[drop.name].mf += drop.mf;
    }
  }
  return sortedDropBreakdown(drops);
}

function breakdownItemTotal(drops: ItemDropCounter[]): number {
  return drops.reduce((total, drop) => total + drop.total, 0);
}

function breakdownItemMf(drops: ItemDropCounter[]): number {
  return drops.reduce((total, drop) => total + drop.mf, 0);
}

function aggregateResources(runs: PastRunSummary[], key: "keys" | "ores" | "materials"): ResourceCounter[] {
  const resources = new Map<string, ResourceCounter>();
  for (const run of runs) {
    for (const resource of (key === "materials" ? run.materials ?? [] : run[key])) {
      const existing = resources.get(resource.name) ?? { id: resource.id, name: resource.name, total: 0 };
      existing.total += resource.total;
      resources.set(resource.name, existing);
    }
  }
  return Array.from(resources.values()).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
}

function runDropTotal(run: PastRunSummary, rarity: string, trackedItems: string[] = [], groups: PastRunDropFilterGroup[] = []): number {
  if (trackedItems.length > 0 || activeDropGroups(groups).length > 0) {
    return breakdownTotal(filteredBreakdown(run.itemBreakdown?.[rarity], rarity, trackedItems, groups));
  }
  if (rarity === "Set") return run.setDrops ?? breakdownTotal(run.itemBreakdown?.Set);
  if (rarity === "Satanic") return run.satanicDrops ?? breakdownTotal(run.itemBreakdown?.Satanic);
  if (rarity === "Heroic") return run.heroicDrops ?? breakdownTotal(run.itemBreakdown?.Heroic);
  if (rarity === "Angelic") return run.angelicDrops ?? breakdownTotal(run.itemBreakdown?.Angelic);
  return breakdownTotal(run.itemBreakdown?.[rarity]);
}

function runDropMf(run: PastRunSummary, rarity: string, trackedItems: string[] = [], groups: PastRunDropFilterGroup[] = []): number {
  return Object.values(filteredBreakdown(run.itemBreakdown?.[rarity], rarity, trackedItems, groups)).reduce((total, drop) => total + drop.mf, 0);
}

function runDropBreakdown(run: PastRunSummary, rarity: string, trackedItems: string[] = [], groups: PastRunDropFilterGroup[] = []): ItemDropCounter[] {
  return sortedDropBreakdown(filteredBreakdown(run.itemBreakdown?.[rarity], rarity, trackedItems, groups));
}

export function aggregatePastRuns(runs: PastRunSummary[], rarities = TRACKED_RARITY_ORDER, topDropLimit = 8, trackedItems: string[] = [], groups: PastRunDropFilterGroup[] = []): PastRunAggregate {
  const aggregateDrops: Record<string, ItemDropCounter> = {};
  const rarityDrops = effectiveRarities(rarities, groups).map((rarity) => {
    let total = 0;
    let mf = 0;
    const uniqueNames = new Set<string>();
    for (const run of runs) {
      total += runDropTotal(run, rarity, trackedItems, groups);
      const drops = runDropBreakdown(run, rarity, trackedItems, groups);
      for (const drop of drops) {
        uniqueNames.add(drop.name);
        mf += drop.mf;
        aggregateDrops[drop.name] = aggregateDrops[drop.name] ?? { name: drop.name, total: 0, mf: 0 };
        aggregateDrops[drop.name].total += drop.total;
        aggregateDrops[drop.name].mf += drop.mf;
      }
    }
    return { rarity, total, mf, unique: uniqueNames.size };
  });
  const totalDurationMs = runs.reduce((total, run) => total + Math.max(run.durationMs, 0), 0);
  const totalGold = runs.reduce((total, run) => total + run.totalGoldGained, 0);
  const totalXp = runs.reduce((total, run) => total + run.totalXpGained, 0);
  const totalKills = runs.reduce((total, run) => total + (run.totalKillsGained ?? 0), 0);

  return {
    runCount: runs.length,
    totalDurationMs,
    averageDurationMs: runs.length ? totalDurationMs / runs.length : 0,
    totalGold,
    totalXp,
    totalKills,
    goldPerHour: ratePerHour(totalGold, totalDurationMs),
    xpPerHour: ratePerHour(totalXp, totalDurationMs),
    killsPerHour: ratePerHour(totalKills, totalDurationMs),
    bestGoldPerHour: Math.max(0, ...runs.map((run) => ratePerHour(run.totalGoldGained, run.durationMs))),
    bestXpPerHour: Math.max(0, ...runs.map((run) => ratePerHour(run.totalXpGained, run.durationMs))),
    bestKillsPerHour: Math.max(0, ...runs.map((run) => ratePerHour(run.totalKillsGained ?? 0, run.durationMs))),
    totalKeys: runs.reduce((total, run) => total + runResourceTotal(run.keys), 0),
    totalOres: runs.reduce((total, run) => total + runResourceTotal(run.ores), 0),
    totalMaterials: runs.reduce((total, run) => total + runResourceTotal(run.materials ?? []), 0),
    totalMfDrops: rarityDrops.reduce((total, drop) => total + drop.mf, 0),
    drops: rarityDrops,
    topDrops: sortedDropBreakdown(aggregateDrops).slice(0, topDropLimit),
  };
}

export function createPastRunsExportPayload(runs: PastRunSummary[], query: string, summary: PastRunAggregate): PastRunsExportPayload {
  return {
    app: "hero-siege-companion",
    kind: "past-runs",
    version: 1,
    exportedAt: new Date().toISOString(),
    filter: {
      query: query.trim(),
      runCount: runs.length,
    },
    summary,
    runs,
  };
}

export function createPastRunsAggregateCsv(options: PastRunsAggregateShareOptions): string {
  const reportRows = aggregateShareReportRows(options);
  const rows = [
    ["section", "label", "value", "mf_flagged", "unique", "detail"],
    ["summary", "Title", options.title, "", "", filterSummaryDetail(options.query, options.aggregate.runCount)],
    ["summary", "Run count", String(options.aggregate.runCount), "", "", ""],
    ["summary", "Average duration", formatDuration(options.aggregate.averageDurationMs), "", "", ""],
    ["summary", "Total duration", formatDuration(options.aggregate.totalDurationMs), "", "", ""],
    ...(options.reportConfig
      ? reportRows.map(reportItemCsvRow)
      : aggregateMetricRows(options.aggregate, options.summaryMetrics ?? []).map((metric) => ["metric", metric.label, String(Math.trunc(metric.value)), "", "", metric.detail])),
    ...options.aggregate.drops.map((drop) => ["rarity", drop.rarity, String(drop.total), String(drop.mf), String(drop.unique), "tracked drops"]),
    ...options.aggregate.topDrops.map((drop, index) => ["top_drop", drop.name, String(drop.total), String(drop.mf), "", `rank ${index + 1}`]),
  ];
  return rows.map(csvRow).join("\n");
}

export function createPastRunsDiscordSummary(options: PastRunsAggregateShareOptions): string {
  const reportRows = aggregateShareReportRows(options);
  const metrics = (options.reportConfig ? reportRows : aggregateMetricRows(options.aggregate, options.summaryMetrics ?? []))
    .map((row) => `${row.label}: ${formatNumber(row.value)} (${row.detail})`)
    .join(" | ");
  const drops = options.reportConfig ? "" : options.aggregate.drops
    .map((drop) => `${drop.rarity} ${formatNumber(drop.total)} (${formatMagicFindFlagCount(drop.mf, { short: true })}, ${formatNumber(drop.unique)} unique)`)
    .join(" | ");
  const topDrops = formatTopDrops(options.aggregate.topDrops, options.aggregate.topDrops.length);
  const lines = [
    `**Hero Siege Past Runs - ${options.title}**`,
    `Runs: ${formatNumber(options.aggregate.runCount)} | Avg: ${formatDuration(options.aggregate.averageDurationMs)} | Total: ${formatDuration(options.aggregate.totalDurationMs)}`,
    metrics ? `${options.reportConfig ? "Report" : "Stats"}: ${metrics}` : "",
    drops ? `Drops: ${drops}` : "",
    topDrops ? `Top drops: ${topDrops}` : "Top drops: none",
    options.query.trim() ? `Filter: ${options.query.trim()}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function createPastRunDiscordSummary(run: PastRunSummary, options: PastRunShareOptions): string {
  const activeGroups = options.activeReportGroups ?? [];
  const rarities = options.dropRarities ?? TRACKED_RARITY_ORDER;
  const reportRows = options.reportConfig ? runReportItemRows(run, options.reportConfig, options.itemFilterGroups ?? []) : [];
  const metrics = (options.reportConfig ? reportRows : runMetricRows(run, options.summaryMetrics ?? [], rarities, activeGroups))
    .map((row) => `${row.label}: ${formatNumber(row.value)} (${row.detail})`)
    .join(" | ");
  const drops = options.reportConfig ? "" : runTrackedItems(run, rarities, [], activeGroups)
    .map((drop) => `${drop.rarity} ${formatNumber(drop.total)} (${formatMagicFindFlagCount(drop.mf, { short: true })}, ${formatNumber(drop.drops.length)} unique)`)
    .join(" | ");
  const topDrops = formatTopDrops(topDropsForRun(run, rarities, activeGroups), options.topDropLimit ?? 5);
  const resources = [
    `${formatNumber(runResourceTotal(run.keys))} keys`,
    `${formatNumber(runResourceTotal(run.ores))} ore`,
    `${formatNumber(runResourceTotal(run.materials ?? []))} materials`,
  ].join(" | ");
  const tags = run.tags?.length ? run.tags.map((tag) => `#${tag}`).join(" ") : "";
  const lines = [
    `**Hero Siege Run - ${run.accountName?.trim() || "Unknown Hero"}**`,
    `Duration: ${formatDuration(run.durationMs)} | Ended: ${formatDateTime(run.sessionEndedAt)}`,
    metrics ? `${options.reportConfig ? "Report" : "Stats"}: ${metrics}` : "",
    options.reportConfig ? "" : `Resources: ${resources}`,
    drops ? `Drops: ${drops}` : "",
    topDrops ? `Top drops: ${topDrops}` : "Top drops: none",
    tags ? `Tags: ${tags}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function aggregateShareReportRows(options: PastRunsAggregateShareOptions): PastRunReportItemRow[] {
  if (!options.reportConfig || !options.runs) return [];
  return aggregateReportItemRows(options.runs, options.aggregate, options.reportConfig, options.itemFilterGroups ?? []);
}

function reportItemCsvRow(row: PastRunReportItemRow): string[] {
  const mf = row.mf !== undefined
    ? String(Math.trunc(row.mf))
    : row.detailPanel?.kind === "drops"
      ? String(breakdownItemMf(row.detailPanel.drops))
      : "";
  const unique = row.detailPanel
    ? String(row.detailPanel.kind === "drops" ? row.detailPanel.drops.length : row.detailPanel.resources.length)
    : "";
  return ["report_item", row.label, String(Math.trunc(row.value)), mf, unique, row.detail];
}

function ratePerHour(value: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.trunc(value / (durationMs / 3_600_000));
}

function averagePerRun(value: number, runCount: number): number {
  return runCount ? Math.trunc(value / runCount) : 0;
}

export function sortedDropBreakdown(breakdown: Record<string, ItemDropCounter>): ItemDropCounter[] {
  return Object.values(breakdown).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function breakdownTotal(breakdown: Record<string, ItemDropCounter> | undefined): number {
  return Object.values(breakdown ?? {}).reduce((total, drop) => total + drop.total, 0);
}

function filteredBreakdown(breakdown: Record<string, ItemDropCounter> | undefined, rarity: string, trackedItems: string[] = [], groups: PastRunDropFilterGroup[] = []): Record<string, ItemDropCounter> {
  const values = breakdown ?? {};
  const activeGroups = activeDropGroups(groups);
  if (activeGroups.length > 0) {
    return Object.fromEntries(Object.entries(values).filter(([name]) => activeGroups.some((group) => pastRunDropMatchesGroup(name, rarity, group))));
  }
  if (trackedItems.length === 0) return values;
  const tracked = new Set(trackedItems.map(normalizeDropName));
  return Object.fromEntries(Object.entries(values).filter(([name]) => tracked.has(normalizeDropName(name))));
}

function effectiveRarities(fallbackRarities: string[], groups: PastRunDropFilterGroup[] = []): string[] {
  const activeGroups = activeDropGroups(groups);
  if (activeGroups.length === 0) return fallbackRarities;
  const rarities = new Set<string>();
  for (const group of activeGroups) {
    const groupRarities = group.items.length || group.rarities.length === 0 ? TRACKED_RARITY_ORDER : group.rarities;
    for (const rarity of groupRarities) {
      if (TRACKED_RARITY_ORDER.includes(rarity)) rarities.add(rarity);
    }
  }
  return TRACKED_RARITY_ORDER.filter((rarity) => rarities.has(rarity));
}

function activeDropGroups(groups: PastRunDropFilterGroup[]): PastRunDropFilterGroup[] {
  return groups.filter((group) => group.enabled);
}

function pastRunDropMatchesGroup(name: string, rarity: string, group: PastRunDropFilterGroup): boolean {
  if (group.emptyCriteriaMatchesAll !== false && group.rarities.length === 0 && group.types.length === 0 && group.items.length === 0) return true;
  return itemMatchesItemFilterCriteria(
    {
      source: "server",
      rarity,
      label: name,
      type: itemTypeValueForName(name) ?? -1,
    },
    group,
  );
}

function normalizeDropName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function topDropsForRun(run: PastRunSummary, rarities: string[], groups: PastRunDropFilterGroup[]): ItemDropCounter[] {
  const drops: Record<string, ItemDropCounter> = {};
  for (const rarity of runTrackedItems(run, rarities, [], groups)) {
    for (const drop of rarity.drops) {
      drops[drop.name] = drops[drop.name] ?? { name: drop.name, total: 0, mf: 0 };
      drops[drop.name].total += drop.total;
      drops[drop.name].mf += drop.mf;
    }
  }
  return sortedDropBreakdown(drops);
}

function formatTopDrops(drops: ItemDropCounter[], limit: number): string {
  if (!drops.length) return "";
  const visibleDrops = drops.slice(0, Math.max(0, limit));
  if (!visibleDrops.length) return "";
  const hiddenCount = Math.max(0, drops.length - visibleDrops.length);
  const suffix = hiddenCount ? `, +${hiddenCount} more` : "";
  return `${visibleDrops.map((drop) => `${drop.name} x${formatNumber(drop.total)}`).join(", ")}${suffix}`;
}

function filterSummaryDetail(query: string, runCount: number): string {
  const trimmedQuery = query.trim();
  return trimmedQuery ? `query: ${trimmedQuery}; runs: ${runCount}` : `all saved runs: ${runCount}`;
}

function csvRow(values: string[]): string {
  return values.map(csvCell).join(",");
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export function runResourceTotal(resources: ResourceCounter[]): number {
  return resources.reduce((total, resource) => total + resource.total, 0);
}

export function runResourceTypeCount(resources: ResourceCounter[] | undefined): number {
  return (resources ?? []).filter((resource) => resource.total > 0).length;
}

export function resourceRecordTotal(resources: Record<string, ResourceCounter>): number {
  return Object.values(resources).reduce((total, resource) => resource.total + total, 0);
}
