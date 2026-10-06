/** Renderer-safe readiness only. Login bodies and flow identifiers stay in main. */
export interface SatanicZonePreparation {
  phase: "idle" | "opening" | "waiting_connection" | "collecting" | "ready" | "suspended" | "requesting" | "expired" | "unavailable";
  /** Collection/request deadline; Ready context has no clock expiry. */
  expiresAt: number | null;
}

export function initialSatanicZonePreparation(): SatanicZonePreparation {
  return { phase: "idle", expiresAt: null };
}
