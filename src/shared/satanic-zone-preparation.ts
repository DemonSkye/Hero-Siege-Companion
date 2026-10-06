/** Renderer-safe readiness only. Login bodies and flow identifiers stay in main. */
export interface SatanicZonePreparation {
  phase: "idle" | "opening" | "waiting_connection" | "collecting" | "ready" | "suspended" | "requesting" | "expired" | "unavailable";
  /** Request deadline only; automatic watching and Ready have no clock expiry. */
  expiresAt: number | null;
  reason?: "login_missed";
}

export function initialSatanicZonePreparation(): SatanicZonePreparation {
  return { phase: "idle", expiresAt: null };
}
