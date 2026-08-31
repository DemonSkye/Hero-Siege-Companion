export const RUN_PACE_SCHEMA_VERSION = 1;
export const MAX_RUN_PACE_SAMPLES = 240;
export const MAX_RUN_PACE_ITEM_SERIES = 256;
export const MAX_RUN_PACE_ITEM_POINTS = 2_048;
export const MAX_RUN_PACE_ITEM_NAME_LENGTH = 120;

export interface RunPaceSample {
  elapsedMs: number;
  xp: number;
  gold: number;
  kills: number;
  items: number;
}

export interface RunPaceItemPoint {
  elapsedMs: number;
  value: number;
}

export interface RunPaceItemSeries {
  name: string;
  points: readonly RunPaceItemPoint[];
}

export interface PastRunPace {
  schemaVersion: number;
  samples: readonly RunPaceSample[];
  itemSeries: readonly RunPaceItemSeries[];
  itemSeriesTruncated: boolean;
}

export interface RunPaceRecordInput {
  elapsedMs: number;
  xp: number;
  gold: number;
  kills: number;
  item?: {
    name: string;
    amount: number;
  };
}

export interface RunPaceFinalTotals {
  elapsedMs: number;
  xp: number;
  gold: number;
  kills: number;
  itemTotals: readonly { name: string; total: number }[];
}

export interface RunPaceRecorder {
  record(input: RunPaceRecordInput): void;
  snapshot(totals: RunPaceFinalTotals): PastRunPace;
}

interface MutableRunPaceItemSeries {
  name: string;
  points: RunPaceItemPoint[];
}

const MAX_CANDIDATE_SAMPLES = MAX_RUN_PACE_SAMPLES * 8;
const MAX_CANDIDATE_ITEM_SERIES = MAX_RUN_PACE_ITEM_SERIES * 4;
const MAX_CANDIDATE_ITEM_POINTS = MAX_RUN_PACE_ITEM_POINTS * 8;

export function createRunPaceRecorder(): RunPaceRecorder {
  let samples: RunPaceSample[] = [emptyRunPaceSample()];
  let itemTotal = 0;
  let itemSeries = new Map<string, MutableRunPaceItemSeries>();
  let itemSeriesTruncated = false;

  return {
    record(input) {
      const elapsedMs = Math.max(
        finiteNonNegativeInteger(input.elapsedMs) ?? 0,
        samples.at(-1)?.elapsedMs ?? 0,
      );
      if (input.item) recordItem(input.item.name, input.item.amount, elapsedMs);
      const nextSample: RunPaceSample = {
        elapsedMs,
        xp: finiteNonNegativeInteger(input.xp) ?? 0,
        gold: finiteNonNegativeInteger(input.gold) ?? 0,
        kills: finiteNonNegativeInteger(input.kills) ?? 0,
        items: itemTotal,
      };
      samples = appendChangedSample(samples, nextSample);
      samples = evenlySelect(samples, MAX_RUN_PACE_SAMPLES);
    },
    snapshot(totals) {
      const elapsedMs = Math.max(
        finiteNonNegativeInteger(totals.elapsedMs) ?? 0,
        samples.at(-1)?.elapsedMs ?? 0,
      );
      const authoritativeItemTotals = itemTotalMap(totals.itemTotals);
      const finalItems = Math.max(
        itemTotal,
        [...authoritativeItemTotals.values()].reduce(safeAdd, 0),
      );
      const finalSample: RunPaceSample = {
        elapsedMs,
        xp: Math.max(finiteNonNegativeInteger(totals.xp) ?? 0, samples.at(-1)?.xp ?? 0),
        gold: Math.max(finiteNonNegativeInteger(totals.gold) ?? 0, samples.at(-1)?.gold ?? 0),
        kills: Math.max(finiteNonNegativeInteger(totals.kills) ?? 0, samples.at(-1)?.kills ?? 0),
        items: finalItems,
      };
      const finalSeries = [...itemSeries.entries()].map(([key, series]) => {
        const previous = series.points.at(-1);
        const value = Math.max(previous?.value ?? 0, authoritativeItemTotals.get(key) ?? 0);
        const point = { elapsedMs, value };
        return {
          name: series.name,
          points: previous?.elapsedMs === elapsedMs
            ? [...series.points.slice(0, -1), point]
            : [...series.points, point],
        };
      });
      return normalizePastRunPace({
        schemaVersion: RUN_PACE_SCHEMA_VERSION,
        samples: appendTerminalSample(samples, finalSample),
        itemSeries: finalSeries,
        itemSeriesTruncated,
      }, elapsedMs) ?? {
        schemaVersion: RUN_PACE_SCHEMA_VERSION,
        samples: [emptyRunPaceSample(), finalSample],
        itemSeries: [],
        itemSeriesTruncated: true,
      };
    },
  };

  function recordItem(rawName: string, rawAmount: number, elapsedMs: number): void {
    const amount = Math.max(finiteNonNegativeInteger(rawAmount) ?? 1, 1);
    itemTotal = safeAdd(itemTotal, amount);
    const name = normalizeRunPaceItemName(rawName);
    const key = canonicalRunPaceItemKey(name);
    if (!name || !key) return;

    let series = itemSeries.get(key);
    if (!series) {
      if (itemSeries.size >= MAX_RUN_PACE_ITEM_SERIES) {
        itemSeriesTruncated = true;
        return;
      }
      series = { name, points: [] };
      itemSeries.set(key, series);
    }
    const previous = series.points.at(-1);
    const point = {
      elapsedMs: Math.max(elapsedMs, previous?.elapsedMs ?? 0),
      value: safeAdd(previous?.value ?? 0, amount),
    };
    if (previous?.elapsedMs === point.elapsedMs) series.points.splice(-1, 1, point);
    else series.points.push(point);

    const pointCount = [...itemSeries.values()].reduce((total, candidate) => total + candidate.points.length, 0);
    if (pointCount > Math.ceil(MAX_RUN_PACE_ITEM_POINTS * 1.25)) {
      const bounded = boundItemSeries([...itemSeries.values()], MAX_RUN_PACE_ITEM_POINTS);
      itemSeries = new Map(bounded.series.map((candidate) => [canonicalRunPaceItemKey(candidate.name), {
        name: candidate.name,
        points: [...candidate.points],
      }]));
      itemSeriesTruncated ||= bounded.truncated;
    }
  }
}

export function normalizePastRunPace(value: unknown, durationMs = Number.MAX_SAFE_INTEGER): PastRunPace | null {
  if (!isRecord(value) || Number(value.schemaVersion) !== RUN_PACE_SCHEMA_VERSION) return null;
  const duration = finiteNonNegativeInteger(durationMs) ?? Number.MAX_SAFE_INTEGER;
  const samples = normalizeSamples(value.samples, duration);
  if (!samples.length) return null;
  const normalizedSeries = normalizeItemSeries(value.itemSeries, duration);
  return {
    schemaVersion: RUN_PACE_SCHEMA_VERSION,
    samples,
    itemSeries: normalizedSeries.series,
    itemSeriesTruncated: value.itemSeriesTruncated === true || normalizedSeries.truncated,
  };
}

export function normalizeRunPaceItemName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RUN_PACE_ITEM_NAME_LENGTH)
    .trim();
}

export function canonicalRunPaceItemKey(value: unknown): string {
  return normalizeRunPaceItemName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['`\u00b4\u02bc\u2018\u2019\u201b\u2032]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function pastRunPaceElapsedMs(pace: PastRunPace): number {
  const first = pace.samples[0]?.elapsedMs ?? 0;
  const last = pace.samples.at(-1)?.elapsedMs ?? first;
  return Math.max(last - first, 0);
}

function normalizeSamples(value: unknown, durationMs: number): RunPaceSample[] {
  if (!Array.isArray(value)) return [];
  const byElapsed = new Map<number, RunPaceSample>();
  for (const candidate of evenlySelect(value, MAX_CANDIDATE_SAMPLES)) {
    const sample = normalizeSample(candidate, durationMs);
    if (sample) byElapsed.set(sample.elapsedMs, sample);
  }
  let samples = [...byElapsed.values()].sort((left, right) => left.elapsedMs - right.elapsedMs);
  if (!samples.length) return [];
  if (samples[0]!.elapsedMs > 0) samples.unshift(emptyRunPaceSample());
  samples = monotonicSamples(samples);
  const last = samples.at(-1)!;
  if (last.elapsedMs < durationMs && durationMs < Number.MAX_SAFE_INTEGER) {
    samples.push({ ...last, elapsedMs: durationMs });
  }
  return evenlySelect(samples, MAX_RUN_PACE_SAMPLES);
}

function normalizeSample(value: unknown, durationMs: number): RunPaceSample | null {
  if (!isRecord(value)) return null;
  const elapsedMs = finiteNonNegativeInteger(value.elapsedMs);
  const xp = finiteNonNegativeInteger(value.xp);
  const gold = finiteNonNegativeInteger(value.gold);
  const kills = finiteNonNegativeInteger(value.kills);
  const items = finiteNonNegativeInteger(value.items);
  if (elapsedMs === null || xp === null || gold === null || kills === null || items === null) return null;
  return { elapsedMs: Math.min(elapsedMs, durationMs), xp, gold, kills, items };
}

function monotonicSamples(samples: readonly RunPaceSample[]): RunPaceSample[] {
  const monotonic: RunPaceSample[] = [];
  for (const sample of samples) {
    const previous = monotonic.at(-1);
    monotonic.push(previous ? {
      elapsedMs: sample.elapsedMs,
      xp: Math.max(previous.xp, sample.xp),
      gold: Math.max(previous.gold, sample.gold),
      kills: Math.max(previous.kills, sample.kills),
      items: Math.max(previous.items, sample.items),
    } : sample);
  }
  return monotonic;
}

function normalizeItemSeries(value: unknown, durationMs: number): { series: RunPaceItemSeries[]; truncated: boolean } {
  if (!Array.isArray(value)) return { series: [], truncated: false };
  const merged = new Map<string, MutableRunPaceItemSeries>();
  let candidatePointCount = 0;
  let truncated = value.length > MAX_CANDIDATE_ITEM_SERIES;
  for (const candidate of value.slice(0, MAX_CANDIDATE_ITEM_SERIES)) {
    if (!isRecord(candidate)) continue;
    const name = normalizeRunPaceItemName(candidate.name);
    const key = canonicalRunPaceItemKey(name);
    if (!name || !key || !Array.isArray(candidate.points)) continue;
    const target = merged.get(key) ?? { name, points: [] };
    for (const rawPoint of candidate.points) {
      candidatePointCount += 1;
      if (candidatePointCount > MAX_CANDIDATE_ITEM_POINTS) {
        truncated = true;
        break;
      }
      const point = normalizeItemPoint(rawPoint, durationMs);
      if (point) target.points.push(point);
    }
    if (target.points.length) merged.set(key, target);
    if (candidatePointCount > MAX_CANDIDATE_ITEM_POINTS) break;
  }

  let series = [...merged.values()].map((candidate) => ({
    name: candidate.name,
    points: monotonicItemPoints(candidate.points),
  })).filter((candidate) => candidate.points.length > 0);
  if (series.length > MAX_RUN_PACE_ITEM_SERIES) {
    series = series.slice(0, MAX_RUN_PACE_ITEM_SERIES);
    truncated = true;
  }
  const bounded = boundItemSeries(series, MAX_RUN_PACE_ITEM_POINTS);
  return { series: bounded.series, truncated: truncated || bounded.truncated };
}

function normalizeItemPoint(value: unknown, durationMs: number): RunPaceItemPoint | null {
  if (!isRecord(value)) return null;
  const elapsedMs = finiteNonNegativeInteger(value.elapsedMs);
  const pointValue = finiteNonNegativeInteger(value.value);
  if (elapsedMs === null || pointValue === null) return null;
  return { elapsedMs: Math.min(elapsedMs, durationMs), value: pointValue };
}

function monotonicItemPoints(points: readonly RunPaceItemPoint[]): RunPaceItemPoint[] {
  const byElapsed = new Map<number, RunPaceItemPoint>();
  for (const point of points) byElapsed.set(point.elapsedMs, point);
  const sorted = [...byElapsed.values()].sort((left, right) => left.elapsedMs - right.elapsedMs);
  let value = 0;
  return sorted.map((point) => {
    value = Math.max(value, point.value);
    return { elapsedMs: point.elapsedMs, value };
  });
}

function boundItemSeries(
  series: readonly RunPaceItemSeries[],
  limit: number,
): { series: RunPaceItemSeries[]; truncated: boolean } {
  const total = series.reduce((sum, candidate) => sum + candidate.points.length, 0);
  if (total <= limit) return { series: series.map(cloneItemSeries), truncated: false };

  const selected = series.map(() => new Set<number>());
  let remaining = limit;
  for (let index = 0; index < series.length && remaining > 0; index += 1) {
    const lastIndex = series[index]!.points.length - 1;
    if (lastIndex < 0) continue;
    selected[index]!.add(lastIndex);
    remaining -= 1;
  }

  const candidates: Array<{ seriesIndex: number; pointIndex: number }> = [];
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
    const points = series[seriesIndex]!.points;
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      candidates.push({ seriesIndex, pointIndex });
    }
  }
  for (const candidate of evenlySelect(candidates, Math.max(remaining, 0))) {
    selected[candidate.seriesIndex]!.add(candidate.pointIndex);
  }

  return {
    series: series.map((candidate, seriesIndex) => ({
      name: candidate.name,
      points: candidate.points.filter((_point, pointIndex) => selected[seriesIndex]!.has(pointIndex)),
    })).filter((candidate) => candidate.points.length > 0),
    truncated: true,
  };
}

function appendChangedSample(samples: readonly RunPaceSample[], next: RunPaceSample): RunPaceSample[] {
  const previous = samples.at(-1);
  if (!previous) return [next];
  const monotonic = {
    ...next,
    xp: Math.max(previous.xp, next.xp),
    gold: Math.max(previous.gold, next.gold),
    kills: Math.max(previous.kills, next.kills),
    items: Math.max(previous.items, next.items),
  };
  if (sameSampleValues(previous, monotonic)) return [...samples];
  if (previous.elapsedMs === monotonic.elapsedMs) return [...samples.slice(0, -1), monotonic];
  return [...samples, monotonic];
}

function appendTerminalSample(samples: readonly RunPaceSample[], terminal: RunPaceSample): RunPaceSample[] {
  const previous = samples.at(-1);
  if (!previous) return [emptyRunPaceSample(), terminal];
  if (previous.elapsedMs === terminal.elapsedMs) return [...samples.slice(0, -1), terminal];
  return [...samples, terminal];
}

function sameSampleValues(left: RunPaceSample, right: RunPaceSample): boolean {
  return left.xp === right.xp
    && left.gold === right.gold
    && left.kills === right.kills
    && left.items === right.items;
}

function itemTotalMap(items: readonly { name: string; total: number }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const key = canonicalRunPaceItemKey(item.name);
    const total = finiteNonNegativeInteger(item.total);
    if (!key || total === null) continue;
    totals.set(key, safeAdd(totals.get(key) ?? 0, total));
  }
  return totals;
}

function emptyRunPaceSample(): RunPaceSample {
  return { elapsedMs: 0, xp: 0, gold: 0, kills: 0, items: 0 };
}

function cloneItemSeries(series: RunPaceItemSeries): RunPaceItemSeries {
  return { name: series.name, points: series.points.map((point) => ({ ...point })) };
}

function evenlySelect<T>(values: readonly T[], limit: number): T[] {
  if (limit <= 0 || !values.length) return [];
  if (values.length <= limit) return [...values];
  if (limit === 1) return [values.at(-1)!];
  const selected: T[] = [];
  for (let position = 0; position < limit; position += 1) {
    const index = Math.round((position * (values.length - 1)) / (limit - 1));
    selected.push(values[index]!);
  }
  return selected;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
}

function safeAdd(total: number, value: number): number {
  return Math.min(total + value, Number.MAX_SAFE_INTEGER);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
