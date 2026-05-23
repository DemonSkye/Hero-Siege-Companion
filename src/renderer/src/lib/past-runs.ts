import type { ItemDropCounter, PastRunSummary, ResourceCounter } from "../../../shared/stats";

export const TRACKED_RARITY_ORDER = ["Set", "Satanic", "Heroic", "Angelic"];

interface PastRunAggregate {
  runCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  totalGold: number;
  totalXp: number;
  goldPerHour: number;
  xpPerHour: number;
  bestGoldPerHour: number;
  bestXpPerHour: number;
  totalKeys: number;
  totalOres: number;
  totalMfDrops: number;
  drops: Array<{ rarity: string; total: number; mf: number; unique: number }>;
  topDrops: ItemDropCounter[];
}

export function runTrackedItems(run: PastRunSummary) {
  return TRACKED_RARITY_ORDER.map((rarity) => ({
    rarity,
    total: runDropTotal(run, rarity),
    mf: runDropMf(run, rarity),
    drops: runDropBreakdown(run, rarity),
  }));
}

function runDropTotal(run: PastRunSummary, rarity: string): number {
  if (rarity === "Set") return run.setDrops ?? breakdownTotal(run.itemBreakdown?.Set);
  if (rarity === "Satanic") return run.satanicDrops ?? breakdownTotal(run.itemBreakdown?.Satanic);
  if (rarity === "Heroic") return run.heroicDrops ?? breakdownTotal(run.itemBreakdown?.Heroic);
  if (rarity === "Angelic") return run.angelicDrops ?? breakdownTotal(run.itemBreakdown?.Angelic);
  return breakdownTotal(run.itemBreakdown?.[rarity]);
}

function runDropMf(run: PastRunSummary, rarity: string): number {
  return Object.values(run.itemBreakdown?.[rarity] ?? {}).reduce((total, drop) => total + drop.mf, 0);
}

function runDropBreakdown(run: PastRunSummary, rarity: string): ItemDropCounter[] {
  return sortedDropBreakdown(run.itemBreakdown?.[rarity] ?? {});
}

export function aggregatePastRuns(runs: PastRunSummary[]): PastRunAggregate {
  const aggregateDrops: Record<string, ItemDropCounter> = {};
  const rarityDrops = TRACKED_RARITY_ORDER.map((rarity) => {
    let total = 0;
    let mf = 0;
    const uniqueNames = new Set<string>();
    for (const run of runs) {
      total += runDropTotal(run, rarity);
      const drops = runDropBreakdown(run, rarity);
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

  return {
    runCount: runs.length,
    totalDurationMs,
    averageDurationMs: runs.length ? totalDurationMs / runs.length : 0,
    totalGold,
    totalXp,
    goldPerHour: ratePerHour(totalGold, totalDurationMs),
    xpPerHour: ratePerHour(totalXp, totalDurationMs),
    bestGoldPerHour: Math.max(0, ...runs.map((run) => ratePerHour(run.totalGoldGained, run.durationMs))),
    bestXpPerHour: Math.max(0, ...runs.map((run) => ratePerHour(run.totalXpGained, run.durationMs))),
    totalKeys: runs.reduce((total, run) => total + runResourceTotal(run.keys), 0),
    totalOres: runs.reduce((total, run) => total + runResourceTotal(run.ores), 0),
    totalMfDrops: rarityDrops.reduce((total, drop) => total + drop.mf, 0),
    drops: rarityDrops,
    topDrops: sortedDropBreakdown(aggregateDrops).slice(0, 5),
  };
}

function ratePerHour(value: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.trunc(value / (durationMs / 3_600_000));
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

export function runResourceTotal(resources: ResourceCounter[]): number {
  return resources.reduce((total, resource) => total + resource.total, 0);
}

export function resourceRecordTotal(resources: Record<string, ResourceCounter>): number {
  return Object.values(resources).reduce((total, resource) => resource.total + total, 0);
}
