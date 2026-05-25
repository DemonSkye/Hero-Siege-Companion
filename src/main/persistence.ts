import fs from "node:fs";
import type { CapturePreferences, RunArchivePreferences } from "../shared/app-state";
import { DEFAULT_CAPTURE_PREFERENCES, DEFAULT_RUN_ARCHIVE_PREFERENCES } from "../shared/initial-state";
import { normalizePastRunTags, type PastRunSummary } from "../shared/stats";

export const MAX_PAST_RUNS = 100;

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

export function loadPastRuns(filePath: string, log: StorageLog = noopLog): PastRunSummary[] {
  try {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const parsed = readJsonFile(filePath);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_PAST_RUNS).filter(isPastRunSummary).map(normalizePastRunSummary);
  } catch (error) {
    logStorageError(log, "past-runs-load-error", error);
    return [];
  }
}

export function savePastRuns(filePath: string, runs: PastRunSummary[], log: StorageLog = noopLog): void {
  if (!filePath) return;
  try {
    writeJsonFile(filePath, runs.slice(0, MAX_PAST_RUNS));
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
    return normalizeRunArchivePreferences(parsed.runArchive ?? {});
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

export function normalizeRunArchivePreferences(preferences: Partial<RunArchivePreferences>): RunArchivePreferences {
  const minDuration = Number(preferences.minDurationMinutes);
  return {
    skipEmptyRuns: Boolean(preferences.skipEmptyRuns),
    minDurationMinutes: Number.isFinite(minDuration) ? Math.max(0, Math.min(1440, Math.trunc(minDuration))) : 0,
  };
}

export function loadCapturePreferences(filePath: string, log: StorageLog = noopLog): CapturePreferences {
  try {
    if (!filePath || !fs.existsSync(filePath)) return DEFAULT_CAPTURE_PREFERENCES;
    const parsed = loadPreferencesFile(filePath) as { capture?: Partial<CapturePreferences> };
    return normalizeCapturePreferences(parsed.capture ?? {});
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

export function normalizeCapturePreferences(preferences: Partial<CapturePreferences>): CapturePreferences {
  return {
    createDebugMode: Boolean(preferences.createDebugMode),
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

export function isPastRunSummary(value: unknown): value is PastRunSummary {
  const candidate = value as Partial<PastRunSummary>;
  return (
    Boolean(candidate) &&
    typeof candidate.id === "string" &&
    typeof candidate.sessionStartedAt === "number" &&
    typeof candidate.sessionEndedAt === "number" &&
    typeof candidate.durationMs === "number" &&
    typeof candidate.totalGoldGained === "number" &&
    typeof candidate.totalXpGained === "number" &&
    Array.isArray(candidate.keys) &&
    Array.isArray(candidate.ores)
  );
}

export function normalizePastRunSummary(run: PastRunSummary): PastRunSummary {
  return {
    ...run,
    tags: normalizePastRunTags((run as { tags?: unknown }).tags),
    materials: Array.isArray(run.materials) ? run.materials : [],
  };
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
