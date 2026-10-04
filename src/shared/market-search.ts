import { MARKET_STAT_CATALOG_BUILD_24868792_DATA } from "./data/market-stat-catalog-build-24868792";
import { resolveItemDefinition } from "./item-catalog";

export const MARKET_PRICE_ASCENDING_SORT = 2 as const;
export const MARKET_SEARCH_LISTING_LIMIT = 2 as const;
export const MARKET_SEARCH_COOLDOWN_MS = 15_000 as const;
export const MARKET_SEARCH_MAX_SOCKETS = 6 as const;
export const MARKET_SEARCH_MAX_STAT_FILTERS = 16 as const;
export const MARKET_SEARCH_MAX_ABSOLUTE_STAT_VALUE = 1_000_000_000 as const;

const MARKET_MASK_REPOSITORY_FACTOR = 2 ** 30;
const MARKET_MASK_WEAPON_TYPE_FACTOR = 2 ** 22;
const MARKET_MASK_ITEM_TYPE_FACTOR = 2 ** 12;
const MARKET_MASK_MAX_WEAPON_TYPE = 0xff;
const MARKET_MASK_MAX_ITEM_TYPE = 0x3ff;
const MARKET_MASK_MAX_GAME_ID = 0xfff;
const MARKET_MASK_MAX_VALUE = 0xffff_ffff;

export interface MarketStatOption {
  statId: number;
  localizationKey: string;
  name: string;
}

export interface MarketStatFilter {
  statId: number;
  minimum: number;
}

export interface MarketSearchRequest {
  itemMask: number;
  minSockets?: number;
  statFilters: MarketStatFilter[];
}

export interface MarketListing {
  price: number;
  unitPrice?: number;
}

export interface MarketSearchResult {
  listings: MarketListing[];
  totalMatches?: number;
}

export type MarketSearchErrorCode =
  | "template_unavailable"
  | "helper_unavailable"
  | "market_unreachable"
  | "cached_request_rejected"
  | "search_pending"
  | "request_rejected"
  | "timed_out";

export type MarketSearchResponse =
  | {
      ok: true;
      result: MarketSearchResult;
      observedAt?: number;
      cached?: boolean;
      nextAllowedSearchAt?: number;
    }
  | {
      ok: false;
      errorCode: MarketSearchErrorCode;
      nextAllowedSearchAt?: number;
    };

export interface MarketItemIdentity {
  repository: "normal" | "unique" | "runeword" | "unknown";
  type: number;
  id: number;
  weaponType: number;
}

export const MARKET_STAT_OPTIONS: readonly MarketStatOption[] = Object.freeze(
  MARKET_STAT_CATALOG_BUILD_24868792_DATA.stats.map(([statId, localizationKey, name]) =>
    Object.freeze({ statId, localizationKey, name }),
  ).sort((left, right) => left.name.localeCompare(right.name)),
);

const MARKET_STAT_OPTIONS_BY_ID = new Map(MARKET_STAT_OPTIONS.map((option) => [option.statId, option]));

export function marketStatOption(statId: number): MarketStatOption | null {
  return MARKET_STAT_OPTIONS_BY_ID.get(statId) ?? null;
}

export type MarketItemMaskRejectionReason =
  | "unknown-repository"
  | "runeword-unproven"
  | "invalid-identity"
  | "unclassified-identity"
  | "out-of-range-identity"
  | "quarantined-identity";

export type MarketItemMaskResolution =
  | { ok: true; itemMask: number }
  | { ok: false; reason: MarketItemMaskRejectionReason };

export function resolveMarketItemMask(identity: MarketItemIdentity): MarketItemMaskResolution {
  if (identity?.repository === "unknown") return { ok: false, reason: "unknown-repository" };
  if (identity?.repository === "runeword") return { ok: false, reason: "runeword-unproven" };
  if (identity?.repository !== "normal" && identity?.repository !== "unique") {
    return { ok: false, reason: "unknown-repository" };
  }
  if (
    !isIntegerInRange(identity.type, 0, MARKET_MASK_MAX_ITEM_TYPE)
    || !isIntegerInRange(identity.id, 0, MARKET_MASK_MAX_GAME_ID)
    || !isIntegerInRange(identity.weaponType, 0, MARKET_MASK_MAX_WEAPON_TYPE)
  ) {
    return { ok: false, reason: "invalid-identity" };
  }

  const resolution = resolveItemDefinition({
    repository: identity.repository,
    type: identity.type,
    gameId: identity.id,
    weaponType: identity.weaponType,
  });
  if (resolution.status === "unclassified") return { ok: false, reason: "unclassified-identity" };
  if (resolution.status === "out-of-range") return { ok: false, reason: "out-of-range-identity" };
  if (resolution.status === "quarantined") return { ok: false, reason: "quarantined-identity" };

  const repositoryCode = resolution.key.repository === "unique" ? 1 : 0;
  const itemMask =
    repositoryCode * MARKET_MASK_REPOSITORY_FACTOR
    + resolution.key.weaponType * MARKET_MASK_WEAPON_TYPE_FACTOR
    + resolution.key.type * MARKET_MASK_ITEM_TYPE_FACTOR
    + resolution.key.gameId;
  return { ok: true, itemMask };
}

export type MarketSearchRequestRejectionReason =
  | "invalid-request"
  | "invalid-item-mask"
  | "invalid-min-sockets"
  | "invalid-stat-filters"
  | "too-many-stat-filters"
  | "invalid-stat-filter"
  | "unknown-stat-id"
  | "duplicate-stat-id";

export type MarketSearchRequestNormalization =
  | { ok: true; request: MarketSearchRequest }
  | { ok: false; reason: MarketSearchRequestRejectionReason };

export function normalizeMarketSearchRequest(value: unknown): MarketSearchRequestNormalization {
  if (!isRecord(value)) return { ok: false, reason: "invalid-request" };
  if (!isIntegerInRange(value.itemMask, 0, MARKET_MASK_MAX_VALUE)) {
    return { ok: false, reason: "invalid-item-mask" };
  }
  if (!Array.isArray(value.statFilters)) return { ok: false, reason: "invalid-stat-filters" };
  if (value.statFilters.length > MARKET_SEARCH_MAX_STAT_FILTERS) {
    return { ok: false, reason: "too-many-stat-filters" };
  }

  const statFilters: MarketStatFilter[] = [];
  const seenStatIds = new Set<number>();
  for (const filter of value.statFilters) {
    if (
      !isRecord(filter)
      || !isSafeInteger(filter.statId)
      || !isFiniteNumber(filter.minimum)
      || Math.abs(filter.minimum) > MARKET_SEARCH_MAX_ABSOLUTE_STAT_VALUE
    ) {
      return { ok: false, reason: "invalid-stat-filter" };
    }
    if (!MARKET_STAT_OPTIONS_BY_ID.has(filter.statId)) return { ok: false, reason: "unknown-stat-id" };
    if (seenStatIds.has(filter.statId)) return { ok: false, reason: "duplicate-stat-id" };
    seenStatIds.add(filter.statId);
    statFilters.push({
      statId: filter.statId,
      minimum: Object.is(filter.minimum, -0) ? 0 : filter.minimum,
    });
  }
  statFilters.sort((left, right) => left.statId - right.statId);

  if (
    value.minSockets !== undefined
    && !isIntegerInRange(value.minSockets, 1, MARKET_SEARCH_MAX_SOCKETS)
  ) {
    return { ok: false, reason: "invalid-min-sockets" };
  }

  const request: MarketSearchRequest = {
    itemMask: value.itemMask,
    statFilters,
  };
  if (value.minSockets !== undefined) request.minSockets = value.minSockets;
  return { ok: true, request };
}

export function sanitizeMarketSearchResult(value: unknown): MarketSearchResult {
  if (!isRecord(value) || !Array.isArray(value.listings)) return { listings: [] };

  const listings = value.listings
    .map((candidate, sourceIndex) => sanitizeListing(candidate, sourceIndex))
    .filter((candidate): candidate is SanitizedListing => candidate !== null)
    .sort((left, right) => left.price - right.price || left.sourceIndex - right.sourceIndex)
    .slice(0, MARKET_SEARCH_LISTING_LIMIT)
    .map(({ sourceIndex: _sourceIndex, ...listing }) => listing);

  if (
    typeof value.totalMatches === "number"
    && Number.isSafeInteger(value.totalMatches)
    && value.totalMatches >= 0
  ) {
    return { listings, totalMatches: value.totalMatches };
  }
  return { listings };
}

interface SanitizedListing extends MarketListing {
  sourceIndex: number;
}

function sanitizeListing(value: unknown, sourceIndex: number): SanitizedListing | null {
  if (!isRecord(value) || !isNonNegativeFiniteNumber(value.price)) return null;
  const listing: SanitizedListing = { price: value.price, sourceIndex };
  if (isNonNegativeFiniteNumber(value.unitPrice)) listing.unitPrice = value.unitPrice;
  return listing;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
