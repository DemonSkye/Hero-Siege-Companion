import { createSatanicZoneInfo } from "../shared/parser";
import type {
  SatanicZoneProviderObservation,
  SatanicZoneProviderWaitOutcome,
} from "./satanic-zone-refresh-provider";

export const SATANIC_ZONE_RELAY_SCHEMA_VERSION = 1;
export const SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS = 30_000;
export const SATANIC_ZONE_RELAY_MAX_FILE_BYTES = 64 * 1024;

const MAX_OBSERVATION_CLOCK_SKEW_MS = 5 * 60_000;
const RELAY_SESSION_START_CLOCK_SKEW_MS = 5000;
const MAX_EFFECT_IDS = 32;
const MAX_EFFECT_ID = 4096;
const COMMAND_ID_PATTERN = /^[a-f0-9]{32}$/u;
const ZONE_NAME_PATTERN = /^[A-Za-z0-9_.: -]{1,64}$/u;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/u;

export type RelayJsonRecord = Record<string, unknown>;

export interface SatanicZoneRelayCommand {
  schemaVersion: typeof SATANIC_ZONE_RELAY_SCHEMA_VERSION;
  command: "refresh_satanic_zone";
  commandId: string;
  sessionId: string;
  requestedAt: string;
  minimumDispatchSpacingMs: typeof SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS;
}

export interface SatanicZoneRelayReadyState {
  sessionId: string;
  pid: number;
  startedAt: number;
}

export interface SatanicZoneRelayPassiveObservation {
  observationId: string;
  completedAt: number;
  observation: SatanicZoneProviderObservation;
}

export function isRelayIdentifier(value: string): boolean {
  return COMMAND_ID_PATTERN.test(value);
}

export function createSatanicZoneRelayCommand(
  commandId: string,
  sessionId: string,
  requestedAt: number,
): SatanicZoneRelayCommand | null {
  if (
    !isRelayIdentifier(commandId)
    || !isRelayIdentifier(sessionId)
    || !Number.isFinite(requestedAt)
  ) return null;

  return {
    schemaVersion: SATANIC_ZONE_RELAY_SCHEMA_VERSION,
    command: "refresh_satanic_zone",
    commandId,
    sessionId,
    requestedAt: new Date(requestedAt).toISOString(),
    minimumDispatchSpacingMs: SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS,
  };
}

export function parseSatanicZoneRelayReadyState(
  value: RelayJsonRecord | null,
  expectedSessionId: string,
  expectedPid: number,
): SatanicZoneRelayReadyState | null {
  if (
    !value
    || value.schemaVersion !== SATANIC_ZONE_RELAY_SCHEMA_VERSION
    || value.status !== "ready"
    || value.sessionId !== expectedSessionId
    || value.pid !== expectedPid
    || value.repeatableRefresh !== true
    || value.counterTranslation !== true
    || value.parentLiveness !== true
    || value.commandCooldownMs !== SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS
  ) return null;

  const startedAt = parseUtcTimestamp(value.startedAt);
  return startedAt === null
    ? null
    : {
        sessionId: expectedSessionId,
        pid: expectedPid,
        startedAt,
      };
}

export function parseSatanicZoneRelayResult(
  value: RelayJsonRecord | null,
  commandId: string,
  sessionId: string,
  now: number,
): SatanicZoneProviderWaitOutcome | null {
  if (
    !value
    || value.schemaVersion !== SATANIC_ZONE_RELAY_SCHEMA_VERSION
    || !isRelayIdentifier(commandId)
    || !isRelayIdentifier(sessionId)
    || value.commandId !== commandId
    || value.sessionId !== sessionId
    || parseBoundedTimestamp(value.completedAt, now) === null
  ) return null;

  if (value.status === "rejected") {
    return terminal("helper_rejected");
  }
  if (value.status === "timeout") {
    return terminal("response_timeout");
  }
  if (value.status === "failed") {
    return terminal("helper_failed");
  }
  if (
    value.status !== "success"
    || value.requestAccepted !== true
    || value.counterTranslationActive !== true
  ) return null;

  const observation = parseObservation(value.zoneObservation, now);
  return observation
    ? { kind: "observation", observation, availabilityConsumed: false }
    : null;
}

/**
 * Accepts only one session-bound, recent, display-safe passive observation.
 * Relay flow details and any unknown producer fields are deliberately dropped.
 */
export function parseSatanicZoneRelayPassiveObservation(
  value: RelayJsonRecord | null,
  expectedSessionId: string,
  sessionCreatedAt: number,
  now: number,
): SatanicZoneRelayPassiveObservation | null {
  if (
    !value
    || value.schemaVersion !== SATANIC_ZONE_RELAY_SCHEMA_VERSION
    || !isRelayIdentifier(expectedSessionId)
    || value.sessionId !== expectedSessionId
    || !isRelayIdentifier(typeof value.observationId === "string" ? value.observationId : "")
    || !Number.isFinite(sessionCreatedAt)
  ) return null;

  const completedAt = parseBoundedTimestamp(value.completedAt, now);
  const observation = parseObservation(value.zoneObservation, now);
  if (
    completedAt === null
    || !observation
    || completedAt < sessionCreatedAt - RELAY_SESSION_START_CLOCK_SKEW_MS
    || observation.observedAt < sessionCreatedAt - RELAY_SESSION_START_CLOCK_SKEW_MS
  ) return null;

  return {
    observationId: value.observationId as string,
    completedAt,
    observation,
  };
}

function parseObservation(value: unknown, now: number): SatanicZoneProviderObservation | null {
  const observation = asJsonRecord(value);
  if (!observation || observation.schemaVersion !== SATANIC_ZONE_RELAY_SCHEMA_VERSION) return null;

  const suppliedRawZone = typeof observation.rawZone === "string" ? observation.rawZone : "";
  const rawZone = suppliedRawZone.trim();
  const buffs = boundedEffectIds(observation.buffs);
  const debuffs = boundedEffectIds(observation.debuffs);
  const observedAt = parseBoundedTimestamp(observation.observedAt, now);
  if (
    rawZone !== suppliedRawZone
    || !ZONE_NAME_PATTERN.test(rawZone)
    || !buffs
    || !debuffs
    || observedAt === null
  ) return null;

  return {
    zone: createSatanicZoneInfo(rawZone, buffs, debuffs, observedAt),
    observedAt,
  };
}

function terminal(
  errorCode: "helper_rejected" | "helper_failed" | "response_timeout",
): SatanicZoneProviderWaitOutcome {
  return { kind: "terminal", errorCode, availabilityConsumed: false };
}

function asJsonRecord(value: unknown): RelayJsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RelayJsonRecord
    : null;
}

function boundedEffectIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_EFFECT_IDS) return null;
  const ids: number[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "number"
      || !Number.isSafeInteger(entry)
      || entry <= 0
      || entry > MAX_EFFECT_ID
      || ids.includes(entry)
    ) return null;
    ids.push(entry);
  }
  return ids;
}

function parseBoundedTimestamp(value: unknown, now: number): number | null {
  const timestamp = parseUtcTimestamp(value);
  if (timestamp === null || !Number.isFinite(now)) return null;
  return Math.abs(now - timestamp) <= MAX_OBSERVATION_CLOCK_SKEW_MS ? timestamp : null;
}

function parseUtcTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(UTC_TIMESTAMP_PATTERN);
  if (!match) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  const expected = match.slice(1, 7).map((part) => Number.parseInt(part, 10));
  const actual = [
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
  ];
  return expected.some((part, index) => part !== actual[index]) ? null : timestamp;
}
