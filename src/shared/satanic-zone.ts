import type { SatanicZoneInfo } from "./parser";

export type SatanicZonePhase =
  | "waiting"
  | "updating"
  | "current"
  | "stale"
  | "missed"
  | "unavailable"
  | "refreshing"
  | "failed";

export type SatanicZoneSource = "captured" | "manual" | "experimental" | null;

export interface SatanicZoneRefreshPreferences {
  enabled: boolean;
}

export const DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES: SatanicZoneRefreshPreferences = {
  enabled: false,
};

export interface SatanicZoneState {
  current: SatanicZoneInfo | null;
  phase: SatanicZonePhase;
  source: SatanicZoneSource;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  validUntil: number | null;
  nextAllowedRefreshAt: number | null;
  errorCode: string | null;
  refreshEnabled: boolean;
  refreshAvailable: boolean;
  refreshExperimental: boolean;
}

export function createInitialSatanicZoneState(): SatanicZoneState {
  return {
    current: null,
    phase: "waiting",
    source: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    validUntil: null,
    nextAllowedRefreshAt: null,
    errorCode: null,
    refreshEnabled: DEFAULT_SATANIC_ZONE_REFRESH_PREFERENCES.enabled,
    refreshAvailable: false,
    refreshExperimental: false,
  };
}

/** Returns the next :00 or :30 boundary in the user's local time. */
export function nextSatanicZoneBoundary(timestamp: number): number {
  if (!Number.isFinite(timestamp)) {
    return Number.NaN;
  }

  const boundary = new Date(timestamp);
  boundary.setMinutes(boundary.getMinutes() < 30 ? 30 : 60, 0, 0);
  return boundary.getTime();
}

export function isSatanicZoneCurrent(zone: SatanicZoneInfo, now: number): boolean {
  if (!Number.isFinite(zone.updatedAt) || !Number.isFinite(now)) {
    return false;
  }

  return now >= zone.updatedAt && now < nextSatanicZoneBoundary(zone.updatedAt);
}

/**
 * Applies time-based expiry without erasing an in-progress or failed lifecycle
 * phase that the caller still needs to show.
 */
export function effectiveSatanicZonePhase(state: SatanicZoneState, now: number): SatanicZonePhase {
  if (state.current === null) {
    return state.phase === "current" || state.phase === "stale" ? "waiting" : state.phase;
  }

  if (state.phase === "current" && !isSatanicZoneCurrent(state.current, now)) {
    return "stale";
  }

  return state.phase;
}

/**
 * Merges a parsed observation while preventing a generic same-window packet or
 * an out-of-order older packet from replacing more useful current data.
 */
export function mergeSatanicZoneObservation(
  previous: SatanicZoneState,
  zone: SatanicZoneInfo,
  source: SatanicZoneSource,
  observedAt: number = zone.updatedAt,
): SatanicZoneState {
  const selected = selectSatanicZoneObservation(previous.current, zone);
  const acceptedIncoming = selected === zone;

  return {
    ...previous,
    current: selected,
    phase: isSatanicZoneCurrent(selected, observedAt) ? "current" : "stale",
    source: acceptedIncoming ? source : previous.source,
    lastSuccessAt: Number.isFinite(observedAt) ? observedAt : previous.lastSuccessAt,
    validUntil: nextSatanicZoneBoundary(selected.updatedAt),
    errorCode: null,
  };
}

function selectSatanicZoneObservation(
  current: SatanicZoneInfo | null,
  incoming: SatanicZoneInfo,
): SatanicZoneInfo {
  if (current === null) {
    return incoming;
  }

  const currentWindow = satanicZoneWindowStart(current.updatedAt);
  const incomingWindow = satanicZoneWindowStart(incoming.updatedAt);

  if (Number.isFinite(currentWindow) && Number.isFinite(incomingWindow)) {
    if (incomingWindow < currentWindow) {
      return current;
    }

    if (incomingWindow === currentWindow && isSpecificSatanicZone(current) && !isSpecificSatanicZone(incoming)) {
      return current;
    }
  }

  return incoming;
}

function satanicZoneWindowStart(timestamp: number): number {
  if (!Number.isFinite(timestamp)) {
    return Number.NaN;
  }

  const start = new Date(timestamp);
  start.setMinutes(start.getMinutes() < 30 ? 0 : 30, 0, 0);
  return start.getTime();
}

function isSpecificSatanicZone(zone: SatanicZoneInfo): boolean {
  return zone.rawZone.trim().length > 0 && Number.isInteger(zone.act) && Number.isInteger(zone.area);
}
