import { MARKET_CONTEXT_FIELDS, type MarketContextField, type MarketReadiness } from "../../../shared/market-readiness";

export const MARKET_CONTEXT_LABELS: Record<MarketContextField, string> = {
  account_id: "Account", unique_account_id: "Account identity", crossregion_identifier: "Session",
  season: "Season", hardcore: "Character mode", beta: "Game mode",
};

export const MARKET_REGION_UNCONFIRMED_DETAIL = "Session captured, but region information could not be confirmed. Keep capture running; a later search can try preparation again.";

export function marketReadinessDisplay(readiness: MarketReadiness): { label: string; detail: string } {
  switch (readiness.phase) {
    case "ready":
      return { label: "Market ready", detail: "Current session captured. Search directly from a drop; no in-game Market search is needed." };
    case "region-required":
      return { label: "Market session captured", detail: "Your first search will prepare region information. No in-game Market search is needed." };
    case "preparing":
      return { label: "Preparing Market", detail: "Companion is preparing region information for this search." };
    case "region-error":
      return { label: "Market region not confirmed", detail: MARKET_REGION_UNCONFIRMED_DETAIL };
    case "expired":
      return { label: "Market session expired", detail: "Keep capture running while the game sends fresh account and session traffic." };
    case "waiting":
      return readiness.reason === "capture_inactive"
        ? { label: "Market waiting for capture", detail: "Start capture and keep it running during normal character and world activity." }
        : { label: "Market waiting for Hero Siege", detail: "Connect to a character with capture running so Companion can observe the current session." };
    case "collecting":
      if (readiness.reason === "source_mismatch") {
        return { label: "Market context sources disagree", detail: "Waiting for matching account, mode and connection evidence. Keep capture running during normal game activity." };
      }
      if (readiness.reason === "endpoint_mismatch") {
        return { label: "Market session changed", detail: "Waiting for matching current-session evidence. Keep capture running during normal game activity." };
      }
      return {
        label: "Market collecting context",
        detail: "Waiting for " + readiness.missingFields.map((field) => MARKET_CONTEXT_LABELS[field]).join(", ")
          + ". Keep capture running during normal character and world activity.",
      };
  }
}

export function marketContextChecklist(readiness: MarketReadiness) {
  return MARKET_CONTEXT_FIELDS.map((field) => ({
    field, label: MARKET_CONTEXT_LABELS[field], received: !readiness.missingFields.includes(field),
  }));
}
