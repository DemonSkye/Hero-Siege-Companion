import type { ItemDropCounter, PastRunSummary, ResourceCounter } from "../../../shared/stats";
import { itemMatchesItemFilterCriteria, type ItemFilterCriteriaGroup } from "./item-filters";
import { itemTypeValueForName } from "./item-options";

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

export interface PastRunComparisonMetric {
  id: string;
  label: string;
  format: "duration" | "number";
  primary: number;
  baseline: number;
  delta: number;
  deltaPercent: number | null;
  direction: "up" | "down" | "flat";
}

export function runTrackedItems(run: PastRunSummary, rarities = TRACKED_RARITY_ORDER, trackedItems: string[] = [], groups: PastRunDropFilterGroup[] = []) {
  return effectiveRarities(rarities, groups).map((rarity) => ({
    rarity,
    total: runDropTotal(run, rarity, trackedItems, groups),
    mf: runDropMf(run, rarity, trackedItems, groups),
    drops: runDropBreakdown(run, rarity, trackedItems, groups),
  }));
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

export function comparePastRunAggregates(primary: PastRunAggregate, baseline: PastRunAggregate): PastRunComparisonMetric[] {
  return [
    comparisonMetric("averageDuration", "Avg duration", "duration", primary.averageDurationMs, baseline.averageDurationMs),
    comparisonMetric("goldPerHour", "Gold/h", "number", primary.goldPerHour, baseline.goldPerHour),
    comparisonMetric("xpPerHour", "XP/h", "number", primary.xpPerHour, baseline.xpPerHour),
    comparisonMetric("killsPerHour", "Kills/h", "number", primary.killsPerHour, baseline.killsPerHour),
    comparisonMetric("keysPerRun", "Keys/run", "number", averagePerRun(primary.totalKeys, primary.runCount), averagePerRun(baseline.totalKeys, baseline.runCount)),
    comparisonMetric("materialsPerRun", "Materials/run", "number", averagePerRun(primary.totalMaterials, primary.runCount), averagePerRun(baseline.totalMaterials, baseline.runCount)),
    comparisonMetric("mfDropsPerRun", "MF drops/run", "number", averagePerRun(primary.totalMfDrops, primary.runCount), averagePerRun(baseline.totalMfDrops, baseline.runCount)),
  ];
}

function ratePerHour(value: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.trunc(value / (durationMs / 3_600_000));
}

function averagePerRun(value: number, runCount: number): number {
  return runCount ? Math.trunc(value / runCount) : 0;
}

function comparisonMetric(
  id: string,
  label: string,
  format: PastRunComparisonMetric["format"],
  primary: number,
  baseline: number,
): PastRunComparisonMetric {
  const delta = Math.trunc(primary - baseline);
  return {
    id,
    label,
    format,
    primary: Math.trunc(primary),
    baseline: Math.trunc(baseline),
    delta,
    deltaPercent: baseline ? delta / baseline : null,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

export function pastRunDropKey(run: PastRunSummary, rarity: string): string {
  return `${run.id}:${rarity}`;
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

export function runResourceTotal(resources: ResourceCounter[]): number {
  return resources.reduce((total, resource) => total + resource.total, 0);
}

export function runResourceTypeCount(resources: ResourceCounter[] | undefined): number {
  return (resources ?? []).filter((resource) => resource.total > 0).length;
}

export function resourceRecordTotal(resources: Record<string, ResourceCounter>): number {
  return Object.values(resources).reduce((total, resource) => resource.total + total, 0);
}
