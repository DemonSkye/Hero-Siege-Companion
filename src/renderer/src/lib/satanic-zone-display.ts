import {
  effectiveSatanicZonePhase,
  type SatanicZonePhase,
  type SatanicZoneState,
} from "../../../shared/satanic-zone";

export interface SatanicZoneDisplay {
  phase: SatanicZonePhase;
  statusLabel: string;
  statusDetail: string;
  observedLabel: string | null;
  validUntilLabel: string | null;
}

export interface SatanicZoneRefreshControl {
  visible: boolean;
  disabled: boolean;
  title: string;
  ariaLabel: string;
}

export function satanicZoneDisplay(
  state: SatanicZoneState,
  now: number,
): SatanicZoneDisplay {
  const phase = effectiveSatanicZonePhase(state, now);
  const observedCandidate = state.lastSuccessAt ?? state.current?.updatedAt ?? null;
  const observedAt = observedCandidate !== null && Number.isFinite(observedCandidate) ? observedCandidate : null;
  const validUntil = state.validUntil !== null && Number.isFinite(state.validUntil) ? state.validUntil : null;

  return {
    phase,
    statusLabel: zoneStatusLabel(phase),
    statusDetail: zoneStatusDetail(phase, state),
    observedLabel: observedAt === null ? null : `Observed ${formatObservedAge(observedAt, now)}`,
    validUntilLabel: validUntil === null ? null : `Valid until ${formatClockTime(validUntil)}`,
  };
}

export function satanicZoneRefreshControl(
  state: SatanicZoneState,
  now: number,
  submitting: boolean,
): SatanicZoneRefreshControl {
  if (!state.refreshEnabled) {
    return {
      visible: false,
      disabled: true,
      title: "Manual Satanic Zone refresh is disabled.",
      ariaLabel: "Refresh Satanic Zone unavailable: manual refresh is disabled",
    };
  }

  if (submitting) {
    return {
      visible: true,
      disabled: true,
      title: "Submitting a manual refresh request.",
      ariaLabel: "Refresh Satanic Zone: submitting request",
    };
  }

  const nextAllowedRefreshAt = state.nextAllowedRefreshAt;
  if (
    nextAllowedRefreshAt !== null
    && Number.isFinite(nextAllowedRefreshAt)
    && now < nextAllowedRefreshAt
  ) {
    const reason = `Refresh available in ${formatCooldown(nextAllowedRefreshAt - now)}.`;
    return {
      visible: true,
      disabled: true,
      title: reason,
      ariaLabel: `Refresh Satanic Zone unavailable: ${reason}`,
    };
  }

  return {
    visible: true,
    disabled: false,
    title: "Refresh Satanic Zone",
    ariaLabel: "Refresh Satanic Zone",
  };
}

function zoneStatusLabel(phase: SatanicZonePhase): string {
  switch (phase) {
    case "current":
      return "Current";
    case "stale":
      return "Stale";
    case "updating":
      return "Updating";
    case "refreshing":
      return "Refreshing";
    case "missed":
      return "Update missed";
    case "failed":
      return "Refresh failed";
    case "unavailable":
      return "Unavailable";
    case "waiting":
      return "Waiting for an update";
  }
}

function zoneStatusDetail(phase: SatanicZonePhase, state: SatanicZoneState): string {
  switch (phase) {
    case "current":
      if (state.source === "manual" || state.source === "experimental") return "Received through manual refresh.";
      if (state.source === "captured") return "Observed from the game's own network traffic.";
      return "Loaded from the last known update.";
    case "stale":
      return "The last observed zone has expired and is shown for reference.";
    case "updating":
      return "The game requested the current zone; waiting for its response.";
    case "refreshing":
      return "A manual refresh is in progress.";
    case "missed":
      return "The game requested a zone update, but no matching response arrived.";
    case "failed":
      return "The manual refresh did not complete. The last known zone is preserved.";
    case "unavailable":
      if (state.errorCode === "one_shot_consumed") {
        return "Manual refresh is unavailable for the rest of this helper session.";
      }
      if (state.errorCode === "helper_not_ready") {
        return "The local refresh relay has not finished starting. Try the refresh button again shortly.";
      }
      return "The manual refresh relay is unavailable. Passive capture can still update the zone.";
    case "waiting":
      return "Waiting for the game to send the current Satanic Zone.";
  }
}

function formatObservedAge(timestamp: number, now: number): string {
  const ageSeconds = Math.max(Math.floor((now - timestamp) / 1_000), 0);
  if (ageSeconds < 5) return "just now";
  if (ageSeconds < 60) return `${ageSeconds}s ago`;

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m ago`;

  const ageHours = Math.floor(ageMinutes / 60);
  return `${ageHours}h ago`;
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatCooldown(durationMs: number): string {
  const totalSeconds = Math.max(Math.ceil(durationMs / 1_000), 1);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
