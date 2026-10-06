import type { SatanicZonePreparation } from "../../../shared/satanic-zone-preparation";

export function satanicZonePreparationDetail(state: SatanicZonePreparation | undefined, _now: number): string | null {
  if (!state) return null;
  if (state.reason === "cache_empty") return "No saved sign-in is available. Companion needs to observe a complete sign-in before Refresh is ready. You can keep playing.";
  if (state.reason === "cache_identity_required") return "Experimental saved sign-in needs fresh account and mode evidence from the game. Refresh is unavailable until they match.";
  if (state.reason === "cache_identity_mismatch") return "The account or mode did not match the saved sign-in. It was cleared.";
  if (state.reason === "cache_build_unavailable") return "Cannot verify the running game build for saved sign-in. Refresh is unavailable.";
  if (state.reason === "cache_build_mismatch") return "The game build changed. The saved sign-in was cleared.";
  if (state.origin === "cached" && state.phase === "ready") return "Experimental saved sign-in matched this account and game build. Click Refresh to test it.";
  if (state.reason === "login_missed") return "The game's connection is open, but its sign-in was not observed. Refresh is unavailable. You can keep playing.";
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
