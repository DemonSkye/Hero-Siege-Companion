import fs from "node:fs";
import type { CapturePreferences, RunArchivePreferences } from "../shared/app-state";
import { DEFAULT_CAPTURE_PREFERENCES, DEFAULT_RUN_ARCHIVE_PREFERENCES } from "../shared/initial-state";
import {
  DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES,
  createInitialSatanicZoneState,
  type SatanicZoneRefreshPreferences,
  type SatanicZoneState,
} from "../shared/satanic-zone";
import { PAST_RUN_SCHEMA_VERSION, normalizePastRunTags, type ItemDropCounter, type PastRunSummary, type ResourceCounter } from "../shared/stats";

export const MAX_PAST_RUNS = 100;
export const SATANIC_ZONE_CACHE_SCHEMA_VERSION = 3;
const LEGACY_SATANIC_ZONE_CACHE_SCHEMA_VERSIONS = new Set([1, 2]);
const MAX_SATANIC_ZONE_COOLDOWN_FUTURE_MS = 5 * 60_000;
const PAST_RUN_RARITIES = ["Set", "Satanic", "Heroic", "Angelic"];

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowBoundsPreferences {
  normal?: WindowBounds;
  compact?: WindowBounds;
}

type StorageLog = (type: string, data: Record<string, unknown>) => void;
type StoredPastRunSummary = Partial<PastRunSummary> & {
  id: string;
  sessionStartedAt: number;
  sessionEndedAt: number;
  durationMs: number;
  totalGoldGained: number;
  totalXpGained: number;
};

interface StoredSatanicZoneCache {
  schemaVersion: number;
  nextAllowedRefreshAt: number;
}

export function loadSatanicZoneCache(filePath: string, now = Date.now(), log: StorageLog = noopLog): SatanicZoneState {
  try {
    if (!filePath || !fs.existsSync(filePath)) return createInitialSatanicZoneState();
    return normalizeSatanicZoneCache(readJsonFile(filePath), now);
  } catch (error) {
    logStorageError(log, "satanic-zone-cache-load-error", error);
    return createInitialSatanicZoneState();
  }
}

export function saveSatanicZoneCache(
  filePath: string,
  state: SatanicZoneState,
  log: StorageLog = noopLog,
  now = Date.now(),
): void {
  if (!filePath) return;
  try {
    const nextAllowedRefreshAt = boundedSatanicZoneCooldown(state.nextAllowedRefreshAt, now);
    if (nextAllowedRefreshAt === null) return;
    const cache: StoredSatanicZoneCache = {
      schemaVersion: SATANIC_ZONE_CACHE_SCHEMA_VERSION,
      nextAllowedRefreshAt,
    };
    writeJsonFile(filePath, cache);
  } catch (error) {
    logStorageError(log, "satanic-zone-cache-save-error", error);
  }
}

export function normalizeSatanicZoneCache(value: unknown, now = Date.now()): SatanicZoneState {
  if (!isRecord(value)) {
    return createInitialSatanicZoneState();
  }
  const schemaVersion = Number(value.schemaVersion);
  if (
    !LEGACY_SATANIC_ZONE_CACHE_SCHEMA_VERSIONS.has(schemaVersion)
    && schemaVersion !== SATANIC_ZONE_CACHE_SCHEMA_VERSION
  ) return createInitialSatanicZoneState();

  return {
    ...createInitialSatanicZoneState(),
    nextAllowedRefreshAt: boundedSatanicZoneCooldown(value.nextAllowedRefreshAt, now),
  };
}

export function satanicZoneCachePersistenceKey(state: SatanicZoneState, now = Date.now()): string | null {
  const nextAllowedRefreshAt = boundedSatanicZoneCooldown(state.nextAllowedRefreshAt, now);
  return nextAllowedRefreshAt === null ? null : String(nextAllowedRefreshAt);
}

export function loadPastRuns(filePath: string, log: StorageLog = noopLog): PastRunSummary[] {
  try {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const parsed = readJsonFile(filePath);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPastRunSummary).slice(0, MAX_PAST_RUNS).map(normalizePastRunSummary);
  } catch (error) {
    logStorageError(log, "past-runs-load-error", error);
    return [];
  }
}

export function savePastRuns(filePath: string, runs: PastRunSummary[], log: StorageLog = noopLog): void {
  if (!filePath) return;
  try {
    writeJsonFile(filePath, runs.slice(0, MAX_PAST_RUNS).map(normalizePastRunSummary));
  } catch (error) {
    logStorageError(log, "past-runs-save-error", error);
  }
}

export function loadWindowBounds(filePath: string, log: StorageLog = noopLog): WindowBoundsPreferences {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const parsed = readJsonFile(filePath) as WindowBoundsPreferences;
    return {
      normal: normalizeWindowBounds(parsed.normal),
      compact: normalizeWindowBounds(parsed.compact),
    };
  } catch (error) {
    logStorageError(log, "window-bounds-load-error", error);
    return {};
  }
}

export function saveWindowBounds(filePath: string, windowBounds: WindowBoundsPreferences, log: StorageLog = noopLog): void {
  if (!filePath) return;
  try {
    writeJsonFile(filePath, windowBounds);
  } catch (error) {
    logStorageError(log, "window-bounds-save-error", error);
  }
}

export function normalizeWindowBounds(bounds: WindowBounds | undefined): WindowBounds | undefined {
  if (!bounds) return undefined;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  if (width < 120 || height < 100) return undefined;
  return { x: Math.trunc(x), y: Math.trunc(y), width: Math.trunc(width), height: Math.trunc(height) };
}

export function withMinimumBounds(
  bounds: WindowBounds | undefined,
  minimums: { width: number; height: number; minWidth: number; minHeight: number },
): WindowBounds | undefined {
  const normalized = normalizeWindowBounds(bounds);
  if (!normalized) return undefined;
  return {
    x: normalized.x,
    y: normalized.y,
    width: Math.max(normalized.width, minimums.minWidth),
    height: Math.max(normalized.height, minimums.minHeight),
  };
}

export function loadRunArchivePreferences(filePath: string, log: StorageLog = noopLog): RunArchivePreferences {
  try {
    if (!filePath || !fs.existsSync(filePath)) return DEFAULT_RUN_ARCHIVE_PREFERENCES;
    const parsed = loadPreferencesFile(filePath) as { runArchive?: Partial<RunArchivePreferences> };
    return parsed.runArchive === undefined ? DEFAULT_RUN_ARCHIVE_PREFERENCES : normalizeRunArchivePreferences(parsed.runArchive);
  } catch (error) {
    logStorageError(log, "preferences-load-error", error);
    return DEFAULT_RUN_ARCHIVE_PREFERENCES;
  }
}

export function saveRunArchivePreferences(filePath: string, preferences: RunArchivePreferences, log: StorageLog = noopLog): void {
  if (!filePath) return;
  try {
    savePreferencesFile(filePath, { ...loadPreferencesFile(filePath), runArchive: preferences });
  } catch (error) {
    logStorageError(log, "preferences-save-error", error);
  }
}

export function normalizeRunArchivePreferences(preferences: unknown): RunArchivePreferences {
  const record = isRecord(preferences) ? preferences : {};
  const minDuration = Number(record.minDurationMinutes);
  return {
    skipEmptyRuns: Boolean(record.skipEmptyRuns),
    minDurationMinutes: Number.isFinite(minDuration) ? Math.max(0, Math.min(1440, Math.trunc(minDuration))) : 0,
  };
}

export function loadCapturePreferences(filePath: string, log: StorageLog = noopLog): CapturePreferences {
  try {
    if (!filePath || !fs.existsSync(filePath)) return DEFAULT_CAPTURE_PREFERENCES;
    const parsed = loadPreferencesFile(filePath) as { capture?: Partial<CapturePreferences> };
    return parsed.capture === undefined ? DEFAULT_CAPTURE_PREFERENCES : normalizeCapturePreferences(parsed.capture);
  } catch (error) {
    logStorageError(log, "preferences-load-error", error);
    return DEFAULT_CAPTURE_PREFERENCES;
  }
}

export function saveCapturePreferences(filePath: string, preferences: CapturePreferences, log: StorageLog = noopLog): void {
  if (!filePath) return;
  try {
    savePreferencesFile(filePath, { ...loadPreferencesFile(filePath), capture: preferences });
  } catch (error) {
    logStorageError(log, "preferences-save-error", error);
  }
}

export function normalizeCapturePreferences(preferences: unknown): CapturePreferences {
  const record = isRecord(preferences) ? preferences : {};
  return {
    captureDebugLogging: booleanField(record.captureDebugLogging, DEFAULT_CAPTURE_PREFERENCES.captureDebugLogging),
    capturePayloadLogging: booleanField(record.capturePayloadLogging, DEFAULT_CAPTURE_PREFERENCES.capturePayloadLogging),
    captureWideLogging: booleanField(record.captureWideLogging, DEFAULT_CAPTURE_PREFERENCES.captureWideLogging),
    satanicZoneDebugLogging: booleanField(record.satanicZoneDebugLogging, DEFAULT_CAPTURE_PREFERENCES.satanicZoneDebugLogging),
  };
}

export function loadSatanicZoneRefreshPreferences(
  filePath: string,
  log: StorageLog = noopLog,
): SatanicZoneRefreshPreferences {
  try {
    if (!filePath || !fs.existsSync(filePath)) return DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES;
    const parsed = loadPreferencesFile(filePath) as { satanicZoneRefresh?: Partial<SatanicZoneRefreshPreferences> };
    return parsed.satanicZoneRefresh === undefined
      ? DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES
      : normalizeSatanicZoneRefreshPreferences(parsed.satanicZoneRefresh);
  } catch (error) {
    logStorageError(log, "preferences-load-error", error);
    return DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES;
  }
}

export function saveSatanicZoneRefreshPreferences(
  filePath: string,
  preferences: SatanicZoneRefreshPreferences,
  log: StorageLog = noopLog,
): void {
  if (!filePath) return;
  try {
    savePreferencesFile(filePath, {
      ...loadPreferencesFile(filePath),
      satanicZoneRefresh: normalizeSatanicZoneRefreshPreferences(preferences),
    });
  } catch (error) {
    logStorageError(log, "preferences-save-error", error);
  }
}

export function normalizeSatanicZoneRefreshPreferences(preferences: unknown): SatanicZoneRefreshPreferences {
  const record = isRecord(preferences) ? preferences : {};
  return {
    enabled: booleanField(record.enabled, DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES.enabled),
  };
}

export function loadPreferencesFile(filePath: string): Record<string, unknown> {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const parsed = readJsonFile(filePath);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

export function savePreferencesFile(filePath: string, preferences: Record<string, unknown>): void {
  if (!filePath) return;
  writeJsonFile(filePath, preferences);
}

export function isPastRunSummary(value: unknown): value is StoredPastRunSummary {
  if (!isRecord(value)) return false;
  return (
    stringField(value, "id") !== "" &&
    isFiniteNumber(value.sessionStartedAt) &&
    isFiniteNumber(value.sessionEndedAt) &&
    isFiniteNumber(value.durationMs) &&
    isFiniteNumber(value.totalGoldGained) &&
    isFiniteNumber(value.totalXpGained)
  );
}

export function normalizePastRunSummary(run: StoredPastRunSummary): PastRunSummary {
  const itemBreakdown = normalizeItemBreakdown(run.itemBreakdown);
  return {
    schemaVersion: PAST_RUN_SCHEMA_VERSION,
    id: run.id.trim(),
    sessionStartedAt: timestampField(run.sessionStartedAt),
    sessionEndedAt: timestampField(run.sessionEndedAt),
    durationMs: numberField(run.durationMs),
    accountName: typeof run.accountName === "string" ? run.accountName : "",
    tags: normalizePastRunTags(run.tags),
    totalGoldGained: numberField(run.totalGoldGained),
    totalXpGained: numberField(run.totalXpGained),
    totalKillsGained: numberField(run.totalKillsGained),
    setDrops: dropTotal(run.setDrops, itemBreakdown.Set),
    satanicDrops: dropTotal(run.satanicDrops, itemBreakdown.Satanic),
    heroicDrops: dropTotal(run.heroicDrops, itemBreakdown.Heroic),
    angelicDrops: dropTotal(run.angelicDrops, itemBreakdown.Angelic),
    itemBreakdown,
    keys: normalizeResourceList(run.keys),
    ores: normalizeResourceList(run.ores),
    materials: normalizeResourceList(run.materials),
  };
}

function normalizeItemBreakdown(value: unknown): Record<string, Record<string, ItemDropCounter>> {
  const normalized: Record<string, Record<string, ItemDropCounter>> = {};
  for (const rarity of PAST_RUN_RARITIES) normalized[rarity] = {};
  if (!isRecord(value)) return normalized;

  for (const [rawRarity, rawBreakdown] of Object.entries(value)) {
    const rarity = rawRarity.trim();
    if (!rarity || !isRecord(rawBreakdown)) continue;
    const breakdown = normalized[rarity] ?? {};
    for (const [rawName, rawDrop] of Object.entries(rawBreakdown)) {
      if (!isRecord(rawDrop)) continue;
      const name = stringField(rawDrop, "name") || rawName.trim();
      const total = numberField(rawDrop.total);
      if (!name || total <= 0) continue;
      breakdown[name] = { name, total, mf: Math.min(numberField(rawDrop.mf), total) };
    }
    normalized[rarity] = breakdown;
  }

  return normalized;
}

function normalizeResourceList(value: unknown): ResourceCounter[] {
  if (!Array.isArray(value)) return [];
  const resources: ResourceCounter[] = [];
  for (const resource of value) {
    if (!isRecord(resource)) continue;
    const id = Number(resource.id);
    const name = stringField(resource, "name");
    const total = numberField(resource.total);
    if (!Number.isFinite(id) || !name || total <= 0) continue;
    resources.push({ id: Math.trunc(id), name, total });
  }
  return resources.sort((left, right) => left.id - right.id || left.name.localeCompare(right.name));
}

function dropTotal(value: unknown, breakdown: Record<string, ItemDropCounter>): number {
  return isFiniteNumber(value) ? numberField(value) : Object.values(breakdown).reduce((total, drop) => total + drop.total, 0);
}

function isFiniteNumber(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

function numberField(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function booleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function boundedSatanicZoneCooldown(value: unknown, now: number): number | null {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || !Number.isFinite(now)
    || value <= now
    || value > now + MAX_SATANIC_ZONE_COOLDOWN_FUTURE_MS
  ) return null;
  return value;
}

function timestampField(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  return typeof record[field] === "string" ? record[field].trim() : "";
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function logStorageError(log: StorageLog, type: string, error: unknown): void {
  log(type, { error: error instanceof Error ? error.message : String(error) });
}

function noopLog(): void {
  // Optional storage logging hook.
}
