import { createHash } from "node:crypto";

const MARKET_CHECKSUM_SALT = "qmR9xbft3ZPvE3Ab";

export interface MarketChecksumContext {
  account_id: string;
  season: string;
  hardcore: string;
  beta: string;
}

/**
 * Reproduces Hero Siege's market checksum for the current account/season mode.
 * The posted account_id may include a region prefix, while the native checksum
 * uses only the underlying account-id suffix.
 */
export function buildMarketFetchItemsChecksum(context: MarketChecksumContext): string {
  const accountId = context.account_id.slice(context.account_id.lastIndexOf("-") + 1);
  return createHash("sha256")
    .update(`${accountId}${MARKET_CHECKSUM_SALT}${context.season}${context.hardcore}${context.beta}`, "utf8")
    .digest("hex");
}
