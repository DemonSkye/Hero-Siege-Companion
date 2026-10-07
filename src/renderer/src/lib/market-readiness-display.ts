import { MARKET_CONTEXT_FIELDS, type MarketContextField, type MarketReadiness } from "../../../shared/market-readiness";

export const MARKET_CONTEXT_LABELS: Record<MarketContextField, string> = {
  account_id: "Account", unique_account_id: "Account identity", crossregion_identifier: "Session",
  season: "Season", hardcore: "Character mode", beta: "Game mode",
};

export const MARKET_REGION_UNCONFIRMED_DETAIL = "Session captured, but region information could not be confirmed. Keep capture running; a later search can try preparation again.";
const MARKET_CONTEXT_RECOVERY_DETAIL = "With capture running, search for an item in Hero Siege's Market to collect context.";

export function marketReadinessDisplay(readiness: MarketReadiness): { label: string; detail: string } {
  switch (readiness.phase) {
    case "ready":
      return { label: "Market ready", detail: "Local prerequisites are present. Press Search to ask the server; accepted authentication is confirmed only by a successful response." };
    case "region-required":
      return { label: "Market ready", detail: "Your first search will prepare region information." };
    case "preparing":
      return { label: "Preparing Market", detail: "Companion is preparing region information for this search." };
    case "region-error":
      return { label: "Market not ready", detail: MARKET_REGION_UNCONFIRMED_DETAIL };
    case "expired":
      return { label: "Market not ready", detail: "Current session information expired. " + MARKET_CONTEXT_RECOVERY_DETAIL };
    case "waiting":
      return readiness.reason === "capture_inactive"
        ? { label: "Market not ready", detail: "Start capture. " + MARKET_CONTEXT_RECOVERY_DETAIL }
        : { label: "Market not ready", detail: "Connect to Hero Siege. " + MARKET_CONTEXT_RECOVERY_DETAIL };
    case "collecting":
      if (readiness.reason === "endpoint_mismatch") {
        return { label: "Market not ready", detail: "Waiting for matching session information. " + MARKET_CONTEXT_RECOVERY_DETAIL };
      }
      return {
        label: "Market not ready",
        detail: "Waiting for current game information. " + MARKET_CONTEXT_RECOVERY_DETAIL,
      };
  }
}

export function marketContextChecklist(readiness: MarketReadiness) {
  return MARKET_CONTEXT_FIELDS.map((field) => ({
    field, label: MARKET_CONTEXT_LABELS[field], received: !readiness.missingFields.includes(field),
  }));
}
