import type { SatanicZonePreparation } from "../../../shared/satanic-zone-preparation";

export function satanicZonePreparationDetail(state: SatanicZonePreparation | undefined, _now: number): string | null {
  if (!state) return null;
  if (state.reason === "login_missed") return "This login was already completed. Refresh will be ready after the game next signs in. You can keep playing.";
  switch (state.phase) {
    case "opening": return "Getting Refresh ready…";
    case "waiting_connection": return "Waiting for the game to sign in. You can keep playing.";
    case "collecting": return "Getting Refresh ready as the game signs in…";
    case "ready": return "Ready to refresh.";
    case "suspended": return "Refresh paused after a capture interruption. Resume capture; waiting for the game to sign in again.";
    case "requesting": return "Refreshing the zone…";
    case "expired":
    case "unavailable": return "Refresh is unavailable. Checking again automatically while capture is enabled.";
    case "idle": return "Start capture to get Refresh ready automatically.";
  }
}
