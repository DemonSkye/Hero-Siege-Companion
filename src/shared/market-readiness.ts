export const MARKET_CONTEXT_FIELDS = [
  "account_id", "unique_account_id", "crossregion_identifier", "season", "hardcore", "beta",
] as const;

export type MarketContextField = typeof MARKET_CONTEXT_FIELDS[number];
export type MarketReadinessPhase = "waiting" | "collecting" | "expired" | "region-required" | "preparing" | "region-error" | "ready";
export type MarketReadinessReason = "capture_inactive" | "game_unavailable" | "missing_fields"
  | "identity_expired" | "endpoint_mismatch" | "observation_gap" | "region_unprepared" | "region_unavailable" | "region_unresolved" | null;

/** Display-safe evidence only. Never add account/session values or endpoints. */
export interface MarketReadiness {
  /** Local invalidation counter. Contains no session identity or mode values. */
  contextVersion?: number;
  phase: MarketReadinessPhase;
  reason: MarketReadinessReason;
  missingFields: MarketContextField[];
  sessionCurrent: boolean;
  regionQualified: boolean;
  /** Account/mode came from earlier in this Companion session, not fresh traffic. */
  retainedContext?: boolean;
  expiresAt: number | null;
  canSearch: boolean;
}

export function createInitialMarketReadiness(): MarketReadiness {
  return {
    phase: "waiting", reason: "capture_inactive", missingFields: [...MARKET_CONTEXT_FIELDS],
    sessionCurrent: false, regionQualified: false, expiresAt: null, canSearch: false,
  };
}
