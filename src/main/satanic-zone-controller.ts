import type { SatanicZoneInfo } from "../shared/parser";
import {
  createInitialSatanicZoneState,
  isSatanicZoneCurrent,
  mergeSatanicZoneObservation,
  type SatanicZoneState,
} from "../shared/satanic-zone";
import type {
  SatanicZoneRefreshAvailability,
  SatanicZoneRefreshDispatchResult,
  SatanicZoneRefreshErrorCode,
  SatanicZoneRefreshProvider,
  SatanicZoneRefreshResult,
} from "./satanic-zone-refresh-provider";
import {
  createManualTimeoutSuppression,
  extendRefreshDeadline,
  latestFiniteTimestamp,
  suppressesPassiveRequest,
  suppressesPassiveTimeout,
  type ManualTimeoutSuppression,
} from "./satanic-zone-refresh-timing";

const DEFAULT_REFRESH_COOLDOWN_MS = 30_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_TIMEOUT_MS = 30_000;
const MANUAL_STALE_TIMEOUT_SUPPRESSION_MS = 18_000;
const MANUAL_LATE_DISPATCH_SUPPRESSION_MS = 2_000;

interface ActiveRefresh {
  id: number;
  stage: "preflight" | "dispatching" | "awaiting_response";
  dispatchAbort: AbortController | null;
  observationAbort: AbortController | null;
  timeout: ReturnType<typeof setTimeout> | null;
  acceptedAt: number | null;
  correlatedProviderWait: boolean;
}

export interface SatanicZoneControllerOptions {
  provider?: SatanicZoneRefreshProvider | null;
  initialState?: SatanicZoneState;
  onStateChange: (state: SatanicZoneState) => void;
  now?: () => number;
  refreshCooldownMs?: number;
  responseTimeoutMs?: number;
  scheduleTimeout?: typeof setTimeout;
  cancelTimeout?: typeof clearTimeout;
}

/** Owns global Satanic Zone freshness without owning capture or transport. */
export class SatanicZoneController {
  private state: SatanicZoneState;
  private activeRefresh: ActiveRefresh | null = null;
  private lastCompletedRefreshId = 0;
  private nextRefreshId = 1;
  private availabilityCheckId = 0;
  private manualTimeoutSuppression: ManualTimeoutSuppression | null = null;
  private readonly provider: SatanicZoneRefreshProvider | null;
  private readonly now: () => number;
  private readonly refreshCooldownMs: number;
  private readonly responseTimeoutMs: number;
  private readonly scheduleTimeout: typeof setTimeout;
  private readonly cancelTimeout: typeof clearTimeout;
  private providerPassiveObservationUnsubscribe: (() => void) | null = null;

  constructor(private readonly options: SatanicZoneControllerOptions) {
    this.provider = options.provider ?? null;
    this.state = { ...(options.initialState ?? createInitialSatanicZoneState()) };
    this.now = options.now ?? Date.now;
    this.refreshCooldownMs = boundedDuration(options.refreshCooldownMs, DEFAULT_REFRESH_COOLDOWN_MS);
    this.responseTimeoutMs = boundedResponseTimeout(options.responseTimeoutMs);
    this.scheduleTimeout = options.scheduleTimeout ?? setTimeout;
    this.cancelTimeout = options.cancelTimeout ?? clearTimeout;
    if (this.provider?.subscribeToPassiveObservations) {
      this.providerPassiveObservationUnsubscribe = this.provider.subscribeToPassiveObservations(
        (observation) => this.observePassiveResponse(observation.zone, observation.observedAt),
      );
    }
  }

  getState(): SatanicZoneState {
    return { ...this.state };
  }

  async refreshAvailability(): Promise<SatanicZoneRefreshAvailability> {
    const checkId = this.nextAvailabilityCheckId();
    return this.refreshAvailabilityForCheck(checkId);
  }

  private async refreshAvailabilityForCheck(checkId: number): Promise<SatanicZoneRefreshAvailability> {
    const providerAvailability = await this.readAvailability();
    const availability: SatanicZoneRefreshAvailability = this.state.refreshEnabled
      ? providerAvailability
      : { available: false, experimental: false, errorCode: "refresh_disabled" };
    if (checkId === this.availabilityCheckId) {
      this.updateState({
        refreshAvailable: availability.available,
        refreshExperimental: availability.experimental,
        errorCode: availability.available ? null : availability.errorCode,
      });
    }
    return availability;
  }

  async setRefreshEnabled(enabled: boolean): Promise<SatanicZoneRefreshAvailability> {
    const checkId = this.nextAvailabilityCheckId();
    if (!enabled) {
      const nextAllowedRefreshAt = this.acceptedRefreshDeadline();
      this.clearActiveRefresh();
      const availability: SatanicZoneRefreshAvailability = {
        available: false,
        experimental: false,
        errorCode: "refresh_disabled",
      };
      this.updateState({
        phase: restingPhase(this.state, this.now()),
        refreshEnabled: false,
        refreshAvailable: false,
        refreshExperimental: false,
        errorCode: availability.errorCode,
        nextAllowedRefreshAt,
      });
      return availability;
    }

    this.updateState({ refreshEnabled: true, errorCode: null });
    return this.refreshAvailabilityForCheck(checkId);
  }

  observePassiveRequest(observedAt = this.now()): void {
    if (suppressesPassiveRequest(this.manualTimeoutSuppression, observedAt)) return;
    this.updateState({
      phase: this.activeRefresh ? "refreshing" : "updating",
      lastAttemptAt: finiteTimestamp(observedAt, this.state.lastAttemptAt),
      errorCode: null,
    });
  }

  observePassiveResponse(zone: SatanicZoneInfo, observedAt = this.now()): void {
    const activeRefresh = this.activeRefresh;
    const source = activeRefresh && activeRefresh.stage !== "preflight" ? "manual" : "captured";
    this.acceptObservation(zone, observedAt, source);
  }

  observePassiveTimeout(observedAt = this.now(), requestedAt?: number): void {
    if (
      this.activeRefresh
      && (
        this.activeRefresh.stage !== "awaiting_response"
        || this.activeRefresh.correlatedProviderWait
      )
    ) return;
    if (suppressesPassiveTimeout(this.manualTimeoutSuppression, observedAt, requestedAt)) return;

    if (this.activeRefresh) {
      this.failActiveRefresh("response_timeout", observedAt);
      return;
    }

    this.updateState({
      phase: "missed",
      lastAttemptAt: this.state.lastAttemptAt ?? finiteTimestamp(observedAt, null),
      errorCode: "response_timeout",
    });
  }

  markUnavailable(errorCode = "helper_unavailable"): void {
    const nextAllowedRefreshAt = this.acceptedRefreshDeadline();
    this.clearActiveRefresh();
    this.updateState({
      phase: "unavailable",
      refreshAvailable: false,
      errorCode: this.state.refreshEnabled ? sanitizeErrorCode(errorCode) : "refresh_disabled",
      nextAllowedRefreshAt,
    });
  }

  /** Clears display evidence for a new run without weakening an active refresh gate. */
  resetObservation(): void {
    const refreshInProgress = this.activeRefresh !== null;
    const passiveUpdateInProgress = !refreshInProgress && this.state.phase === "updating";
    const availabilityError = this.state.refreshEnabled && !this.state.refreshAvailable
      ? this.state.errorCode
      : this.state.refreshEnabled ? null : "refresh_disabled";
    this.updateState({
      current: null,
      phase: refreshInProgress
        ? "refreshing"
        : passiveUpdateInProgress
          ? "updating"
          : this.state.refreshEnabled && availabilityError ? "unavailable" : "waiting",
      source: null,
      lastAttemptAt: refreshInProgress || passiveUpdateInProgress
        ? this.state.lastAttemptAt
        : null,
      lastSuccessAt: null,
      validUntil: null,
      errorCode: availabilityError,
    });
  }

  async refreshNow(): Promise<SatanicZoneRefreshResult> {
    const attemptedAt = this.now();
    if (!this.state.refreshEnabled) return rejected("refresh_disabled");
    if (this.activeRefresh) return rejected("refresh_in_progress");
    if (
      this.state.nextAllowedRefreshAt !== null
      && attemptedAt < this.state.nextAllowedRefreshAt
    ) {
      return rejected("refresh_cooldown");
    }

    const refreshId = this.nextRefreshId;
    this.nextRefreshId += 1;
    this.activeRefresh = {
      id: refreshId,
      stage: "preflight",
      dispatchAbort: null,
      observationAbort: null,
      timeout: null,
      acceptedAt: null,
      correlatedProviderWait: false,
    };
    this.updateState({
      phase: "refreshing",
      lastAttemptAt: finiteTimestamp(attemptedAt, this.state.lastAttemptAt),
      errorCode: null,
      refreshExperimental: this.provider?.experimental ?? false,
    });

    const availability = await this.readAvailability();
    if (!this.isActiveRefresh(refreshId)) {
      if (!this.state.refreshEnabled) return rejected("refresh_disabled");
      return this.lastCompletedRefreshId === refreshId ? accepted() : rejected("helper_unavailable");
    }
    if (!this.state.refreshEnabled) {
      this.clearActiveRefresh();
      this.updateState({
        phase: restingPhase(this.state, this.now()),
        refreshAvailable: false,
        refreshExperimental: false,
        errorCode: "refresh_disabled",
      });
      return rejected("refresh_disabled");
    }
    this.updateState({
      refreshAvailable: availability.available,
      refreshExperimental: availability.experimental,
    });
    if (!availability.available) {
      this.clearActiveRefresh();
      this.updateState({
        phase: "unavailable",
        errorCode: availability.errorCode ?? "helper_unavailable",
      });
      return rejected(availability.errorCode ?? "helper_unavailable");
    }

    this.activeRefresh.stage = "dispatching";
    const dispatchAbort = new AbortController();
    this.activeRefresh.dispatchAbort = dispatchAbort;

    let result: SatanicZoneRefreshDispatchResult;
    try {
      result = this.provider
        ? await this.provider.requestRefresh({ signal: dispatchAbort.signal })
        : dispatchRejected("refresh_not_configured");
    } catch {
      result = dispatchRejected("helper_failed");
    }

    if (!this.isActiveRefresh(refreshId)) {
      if (result.accepted) {
        this.settleDetachedAcceptedRefresh(
          refreshId,
          latestFiniteTimestamp(this.now(), attemptedAt),
        );
      }
      return this.lastCompletedRefreshId === refreshId ? accepted() : rejected("helper_unavailable");
    }
    this.activeRefresh.dispatchAbort = null;
    if (!result.accepted) {
      this.clearActiveRefresh();
      this.updateState({ phase: "failed", errorCode: result.errorCode ?? "helper_failed" });
      return publicResult(result);
    }

    const acceptedAt = latestFiniteTimestamp(this.now(), attemptedAt);
    this.activeRefresh.acceptedAt = acceptedAt;
    this.activeRefresh.correlatedProviderWait = this.provider?.waitForObservation !== undefined;
    if (acceptedAt !== null) {
      this.updateState({
        nextAllowedRefreshAt: extendRefreshDeadline(null, this.refreshCooldownMs, acceptedAt),
      });
    }
    this.activeRefresh.stage = "awaiting_response";
    if (this.provider?.waitForObservation) {
      if (!result.correlationId) {
        this.failActiveRefresh("helper_failed", this.now());
        return rejected("helper_failed");
      }
      this.startProviderObservationWait(refreshId, result.correlationId);
    } else {
      const timeout = this.scheduleTimeout(() => {
        if (this.isActiveRefresh(refreshId)) this.failActiveRefresh("response_timeout", this.now());
      }, this.responseTimeoutMs);
      if (this.isActiveRefresh(refreshId)) this.activeRefresh.timeout = timeout;
      else this.cancelTimeout(timeout);
    }
    return publicResult(result);
  }

  dispose(): void {
    const nextAllowedRefreshAt = this.acceptedRefreshDeadline();
    this.clearActiveRefresh();
    this.providerPassiveObservationUnsubscribe?.();
    this.providerPassiveObservationUnsubscribe = null;
    if (nextAllowedRefreshAt !== this.state.nextAllowedRefreshAt) {
      this.updateState({ nextAllowedRefreshAt });
    }
  }

  private async readAvailability(): Promise<SatanicZoneRefreshAvailability> {
    if (!this.state.refreshEnabled) {
      return { available: false, experimental: false, errorCode: "refresh_disabled" };
    }
    if (!this.provider) {
      return { available: false, experimental: false, errorCode: "refresh_not_configured" };
    }
    try {
      const availability = await this.provider.getAvailability();
      return {
        available: availability.available === true,
        experimental: this.provider.experimental && availability.experimental === true,
        errorCode: availability.available
          ? null
          : sanitizeErrorCode(availability.errorCode ?? "helper_unavailable"),
      };
    } catch {
      return {
        available: false,
        experimental: this.provider.experimental,
        errorCode: "helper_unavailable",
      };
    }
  }

  private failActiveRefresh(
    errorCode: SatanicZoneRefreshErrorCode,
    observedAt: number,
    availabilityConsumed?: boolean,
  ): void {
    const activeRefresh = this.activeRefresh;
    const refreshEnabled = this.state.refreshEnabled;
    const nextAllowedRefreshAt = this.acceptedRefreshDeadline();
    const settlementAt = latestFiniteTimestamp(
      observedAt,
      this.now(),
      activeRefresh?.acceptedAt,
    ) ?? observedAt;
    if (activeRefresh?.correlatedProviderWait) {
      this.manualTimeoutSuppression = createManualTimeoutSuppression(
        activeRefresh.id,
        settlementAt,
        MANUAL_STALE_TIMEOUT_SUPPRESSION_MS,
        MANUAL_LATE_DISPATCH_SUPPRESSION_MS,
      );
    }
    this.clearActiveRefresh();
    this.updateState({
      phase: "failed",
      lastAttemptAt: this.state.lastAttemptAt ?? finiteTimestamp(observedAt, null),
      errorCode: refreshEnabled
        ? availabilityConsumed ? "one_shot_consumed" : errorCode
        : "refresh_disabled",
      ...(!refreshEnabled
        ? { refreshAvailable: false }
        : availabilityConsumed === undefined
          ? {}
          : { refreshAvailable: !availabilityConsumed }),
      nextAllowedRefreshAt,
    });
  }

  private startProviderObservationWait(refreshId: number, correlationId: string): void {
    const waitForObservation = this.provider?.waitForObservation?.bind(this.provider);
    const activeRefresh = this.activeRefresh;
    if (!waitForObservation || activeRefresh?.id !== refreshId) return;
    const observationAbort = new AbortController();
    activeRefresh.observationAbort = observationAbort;
    void waitForObservation(correlationId, {
      timeoutMs: this.responseTimeoutMs,
      signal: observationAbort.signal,
    }).then((outcome) => {
      if (!this.isActiveRefresh(refreshId)) return;
      if (!outcome) {
        this.failActiveRefresh("response_timeout", this.now());
        return;
      }
      if (outcome.kind === "terminal") {
        this.failActiveRefresh(outcome.errorCode, this.now(), outcome.availabilityConsumed);
        return;
      }
      this.acceptObservation(
        outcome.observation.zone,
        outcome.observation.observedAt,
        "manual",
        outcome.availabilityConsumed,
      );
    }).catch(() => {
      if (this.isActiveRefresh(refreshId)) this.failActiveRefresh("helper_failed", this.now());
    });
  }

  private acceptObservation(
    zone: SatanicZoneInfo,
    observedAt: number,
    source: "captured" | "manual",
    availabilityConsumed = false,
  ): void {
    const activeRefresh = this.activeRefresh;
    const refreshEnabled = this.state.refreshEnabled;
    if (activeRefresh) this.lastCompletedRefreshId = activeRefresh.id;
    const settlementAt = latestFiniteTimestamp(observedAt, this.now(), activeRefresh?.acceptedAt) ?? observedAt;
    const nextAllowedRefreshAt = this.acceptedRefreshDeadline();
    if (source === "manual" && activeRefresh?.correlatedProviderWait) {
      this.manualTimeoutSuppression = createManualTimeoutSuppression(
        activeRefresh.id,
        settlementAt,
        MANUAL_STALE_TIMEOUT_SUPPRESSION_MS,
      );
    }
    this.clearActiveRefresh();
    const next = mergeSatanicZoneObservation(this.state, zone, source, observedAt);
    this.setState({
      ...next,
      refreshAvailable: refreshEnabled && !availabilityConsumed ? next.refreshAvailable : false,
      errorCode: !refreshEnabled
        ? "refresh_disabled"
        : availabilityConsumed ? "one_shot_consumed" : next.errorCode,
      nextAllowedRefreshAt,
    });
  }

  private acceptedRefreshDeadline(): number | null {
    const acceptedAt = this.activeRefresh?.acceptedAt;
    if (acceptedAt === null || acceptedAt === undefined) return this.state.nextAllowedRefreshAt;
    return extendRefreshDeadline(null, this.refreshCooldownMs, acceptedAt);
  }

  private settleDetachedAcceptedRefresh(refreshId: number, acceptedAt: number | null): void {
    const completedThisRefresh = this.lastCompletedRefreshId === refreshId;
    const settlementAt = latestFiniteTimestamp(
      this.now(),
      completedThisRefresh ? this.state.lastSuccessAt : null,
    );
    if (
      settlementAt !== null
      && completedThisRefresh
      && this.state.source === "manual"
      && this.provider?.waitForObservation !== undefined
    ) {
      this.manualTimeoutSuppression = createManualTimeoutSuppression(
        refreshId,
        settlementAt,
        MANUAL_STALE_TIMEOUT_SUPPRESSION_MS,
      );
    }
    const nextAllowedRefreshAt = extendRefreshDeadline(
      this.state.nextAllowedRefreshAt,
      this.refreshCooldownMs,
      acceptedAt,
    );
    if (nextAllowedRefreshAt !== this.state.nextAllowedRefreshAt) {
      this.updateState({ nextAllowedRefreshAt });
    }
  }

  private isActiveRefresh(id: number): boolean {
    return this.activeRefresh?.id === id;
  }

  private nextAvailabilityCheckId(): number {
    this.availabilityCheckId += 1;
    return this.availabilityCheckId;
  }

  private clearActiveRefresh(): void {
    const activeRefresh = this.activeRefresh;
    this.activeRefresh = null;
    if (activeRefresh?.timeout !== null && activeRefresh?.timeout !== undefined) {
      this.cancelTimeout(activeRefresh.timeout);
    }
    activeRefresh?.dispatchAbort?.abort();
    activeRefresh?.observationAbort?.abort();
  }

  private updateState(patch: Partial<SatanicZoneState>): void {
    this.setState({ ...this.state, ...patch });
  }

  private setState(next: SatanicZoneState): void {
    this.state = next;
    this.options.onStateChange(this.getState());
  }
}

function accepted(): SatanicZoneRefreshResult {
  return { accepted: true, errorCode: null };
}

function rejected(errorCode: SatanicZoneRefreshErrorCode): SatanicZoneRefreshResult {
  return { accepted: false, errorCode };
}

function dispatchRejected(errorCode: SatanicZoneRefreshErrorCode): SatanicZoneRefreshDispatchResult {
  return { ...rejected(errorCode), correlationId: null };
}

function publicResult(result: SatanicZoneRefreshDispatchResult): SatanicZoneRefreshResult {
  return { accepted: result.accepted, errorCode: result.errorCode };
}

function sanitizeErrorCode(errorCode: string): SatanicZoneRefreshErrorCode {
  const allowed: ReadonlySet<string> = new Set<SatanicZoneRefreshErrorCode>([
    "refresh_disabled",
    "refresh_not_configured",
    "helper_unavailable",
    "helper_not_ready",
    "one_shot_consumed",
    "refresh_pending",
    "refresh_in_progress",
    "refresh_cooldown",
    "helper_rejected",
    "helper_failed",
    "response_timeout",
    "capture_unavailable",
  ]);
  return allowed.has(errorCode) ? errorCode as SatanicZoneRefreshErrorCode : "helper_failed";
}

function boundedDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? Math.floor(value as number) : fallback;
}

function boundedResponseTimeout(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(MAX_RESPONSE_TIMEOUT_MS, Math.floor(value as number))
    : DEFAULT_RESPONSE_TIMEOUT_MS;
}

function finiteTimestamp(value: number, fallback: number | null): number | null {
  return Number.isFinite(value) ? value : fallback;
}

function restingPhase(state: SatanicZoneState, now: number): SatanicZoneState["phase"] {
  if (!state.current) return "waiting";
  return isSatanicZoneCurrent(state.current, now) ? "current" : "stale";
}
