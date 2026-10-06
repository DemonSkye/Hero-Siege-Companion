/** Renderer-safe readiness only. Login bodies and flow identifiers stay in main. */
export interface SatanicZonePreparation {
  phase: "idle" | "opening" | "waiting_connection" | "collecting" | "ready" | "requesting" | "expired" | "unavailable";
  expiresAt: number | null;
}

export function initialSatanicZonePreparation(): SatanicZonePreparation {
  return { phase: "idle", expiresAt: null };
}
