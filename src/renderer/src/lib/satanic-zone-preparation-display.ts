import type { SatanicZonePreparation } from "../../../shared/satanic-zone-preparation";

export function satanicZonePreparationDetail(state: SatanicZonePreparation | undefined, _now: number): string | null {
  if (!state) return null;
  switch (state.phase) {
    case "opening": return "Opening a listener for the game's next API initialization. Preparation sends no request.";
    case "waiting_connection": return "Listening for a fresh game API connection and complete login. You can keep playing. Already completed login cannot be recovered; this listening window ends after two minutes. Click again to cancel.";
    case "collecting": return "Observing the game connection and login. No refresh request has been sent. Click again to cancel preparation.";
    case "ready": return "Ready for manual refresh for this game session. Click Refresh to request the zone. Login context stays only in memory until the game session changes or the feature closes.";
    case "requesting": return "Requesting the zone on a separate Companion connection. Game updates do not complete this request.";
    case "expired": return "The listening window ended without a complete login. Click Prepare refresh to listen again. Ready context has no two-minute expiry.";
    case "unavailable": return "Refresh context is unavailable. Keep capture running and click Prepare refresh to listen for the next game API initialization.";
    case "idle": return "Enable capture to listen for game API initialization, or click Prepare refresh to listen again. Once ready, Refresh remains an explicit action. No proxy installation is needed.";
  }
}
