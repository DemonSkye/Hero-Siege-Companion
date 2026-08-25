export type SatanicZoneRefreshErrorCode =
  | "refresh_disabled"
  | "refresh_not_configured"
  | "helper_unavailable"
  | "helper_not_ready"
  | "one_shot_consumed"
  | "refresh_pending"
  | "refresh_in_progress"
  | "refresh_cooldown"
  | "helper_rejected"
  | "helper_failed"
  | "response_timeout"
  | "capture_unavailable";

export interface SatanicZoneRefreshAvailability {
  available: boolean;
  experimental: boolean;
  errorCode: SatanicZoneRefreshErrorCode | null;
}

/**
 * The public controller result only reports whether one request was handed
 * off; it never carries helper correlation or observation details.
 */
export interface SatanicZoneRefreshResult {
  accepted: boolean;
  errorCode: SatanicZoneRefreshErrorCode | null;
}

/** Main-process-only dispatch data; callers must not forward correlationId over IPC. */
export interface SatanicZoneRefreshDispatchResult extends SatanicZoneRefreshResult {
  correlationId: string | null;
}

export interface SatanicZoneProviderObservation {
  zone: import("../shared/parser").SatanicZoneInfo;
  observedAt: number;
}

export type SatanicZoneProviderTerminalErrorCode = Extract<
  SatanicZoneRefreshErrorCode,
  "helper_rejected" | "helper_failed" | "response_timeout"
>;

export type SatanicZoneProviderWaitOutcome =
  | {
      kind: "observation";
      observation: SatanicZoneProviderObservation;
      availabilityConsumed: boolean;
    }
  | {
      kind: "terminal";
      errorCode: SatanicZoneProviderTerminalErrorCode;
      availabilityConsumed: boolean;
    };

export interface SatanicZoneObservationWaitOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SatanicZoneRefreshRequestOptions {
  signal?: AbortSignal;
}

export type SatanicZonePassiveObservationListener = (
  observation: SatanicZoneProviderObservation,
) => void;

export interface SatanicZoneRefreshProvider {
  readonly experimental: boolean;
  getAvailability(): Promise<SatanicZoneRefreshAvailability>;
  requestRefresh(options?: SatanicZoneRefreshRequestOptions): Promise<SatanicZoneRefreshDispatchResult>;
  waitForObservation?(
    correlationId: string,
    options: SatanicZoneObservationWaitOptions,
  ): Promise<SatanicZoneProviderWaitOutcome | null>;
  subscribeToPassiveObservations?(
    listener: SatanicZonePassiveObservationListener,
  ): () => void;
}
