import { createHash } from "node:crypto";

export const MARKET_FETCH_ITEMS_API_SCRIPT = "market/market_fetch_items";

const MARKET_MULTIPASS_SALT = "IoksbAf67bHlX10snbfB4be3x0z9";

/**
 * Reproduces Hero Siege's route signature for the one direct market operation
 * the Companion permits. This value is route-derived, not player/session data.
 */
export function buildMarketFetchItemsMultipass(): string {
  return createHash("sha256")
    .update(`${MARKET_MULTIPASS_SALT}${MARKET_FETCH_ITEMS_API_SCRIPT}`, "utf8")
    .digest("hex");
}
