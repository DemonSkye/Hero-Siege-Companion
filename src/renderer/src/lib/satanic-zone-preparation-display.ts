import type { SatanicZonePreparation } from "../../../shared/satanic-zone-preparation";

export function satanicZonePreparationDetail(state: SatanicZonePreparation | undefined, now: number): string | null {
  if (!state) return null;
  switch (state.phase) {
    case "opening": return "Opening capture for refresh preparation. Wait for the connection cue before reconnecting.";
    case "waiting_connection": return "Capture is ready. Reconnect or restart Hero Siege now so Companion can observe login. Preparation expires after two minutes; click again to cancel.";
    case "collecting": return "Observing the game connection and login. No refresh request has been sent. Click again to cancel preparation.";
    case "ready": {
      const seconds = Math.max(0, Math.ceil(((state.expiresAt ?? now) - now) / 1000));
      return `Ready for manual refresh for ${seconds}s. Click Refresh to request the zone. Login context stays only in memory for this game connection.`;
    }
    case "requesting": return "Requesting the zone on a separate Companion connection. Game updates do not complete this request.";
    case "expired": return "Refresh preparation expired and its login context was cleared. Prepare again before reconnecting the game.";
    case "unavailable": return "Refresh preparation is unavailable. Keep capture running with the game connected, then prepare again before reconnecting.";
    case "idle": return "Click Prepare refresh while the game is connected, wait for the connection cue, then reconnect the game. Click Refresh once ready. No proxy installation is needed.";
  }
}
