import { MARKET_STAT_CATALOG_BUILD_24868792_DATA } from "./data/market-stat-catalog-build-24868792";
import { ITEM_BASE_STAT_CATALOG, itemBaseStatDefinition } from "./item-base-stat-catalog";
import { runewordMarketById } from "./runeword-market-catalog";
import { resolveItemDefinition } from "./item-catalog";
import { sanitizeMarketListingItem, type MarketListingItem } from "./market-listing-item";

export const MARKET_PRICE_ASCENDING_SORT = 2 as const;
export const MARKET_SEARCH_LISTING_LIMIT = 20 as const;
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
  /** Grounded numeric ID outside the retained native Market menu. */
  experimental?: true;
}

export interface MarketStatFilter {
  statId: number;
  minimum: number;
}

export interface MarketFilterCriteria {
  minSockets?: number;
  statFilters: MarketStatFilter[];
}
export type MarketSearchTarget =
  | { itemMask: number; runewordId?: never }
  | { runewordId: number; itemMask?: never };
export type MarketSearchRequest = MarketFilterCriteria & MarketSearchTarget;

export interface MarketListing {
  price: number;
  unitPrice?: number;
  item?: MarketListingItem;
}

export interface MarketSearchResult {
  listings: MarketListing[];
  totalMatches?: number;
  /** Decoded rows in this one page, before invalid-price filtering/display cap. */
  returnedCount?: number;
}

export type MarketSearchErrorCode =
  | "template_unavailable"
  | "helper_unavailable"
  | "market_unreachable"
  | "cached_request_rejected"
  | "checksum_rejected"
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
  [
    ...MARKET_STAT_CATALOG_BUILD_24868792_DATA.stats.map(([statId, localizationKey, name]) =>
      Object.freeze({ statId, localizationKey, name })),
    ...ITEM_BASE_STAT_CATALOG.stats.filter(stat => !stat.nativeMarketMenu).map(stat =>
      Object.freeze({ statId: stat.statId, localizationKey: stat.localizationKey,
        name: `${stat.name} (experimental)`, experimental: true as const })),
  ].sort((left, right) => left.name.localeCompare(right.name)),
);

const MARKET_STAT_OPTIONS_BY_ID = new Map(MARKET_STAT_OPTIONS.map((option) => [option.statId, option]));

export function marketStatOption(statId: number): MarketStatOption | null {
  return MARKET_STAT_OPTIONS_BY_ID.get(statId) ?? null;
}

// Frozen labels-v5 classification (SHA256 d91c8cfe8322850e00c63465a783a99c3039d5116e43214d62cd605551aff558).
// Discovery and durable criteria include these IDs; scalar wire clauses do not.
const UNKNOWN_VALUE_SHAPE_IDS = new Set([10, 11, 12, 13, 14, 15, 98, 100, 120, 299]);
export function marketStatMinimumIssue(statId: number, itemKey: string | null = null): string | null {
  if (!marketStatOption(statId)) return "Unknown stat ID.";
  if (statId === 20) return "Use Minimum sockets above; sockets have a separate native control.";
  if (statId === 185) return "Skill identifier metadata cannot be searched as a roll minimum.";
  if (statId === 186 || statId === 187) return "Proc parameter meaning is verified only for Bob's Piece of Plywood; minimum matching is unproved.";
  if (statId === 347) return "Zone collections cannot be searched as numeric minimums.";
  if (UNKNOWN_VALUE_SHAPE_IDS.has(statId)) return "Value shape is unresolved; a scalar minimum is not supported.";
  const stat = itemBaseStatDefinition(itemKey)?.stats.find(value => value.statId === statId);
  if (!itemBaseStatMetadataIsNative(statId) && stat?.kind === "series") {
    return "This item's value is a table, not a scalar roll minimum.";
  }
  return null;
}
function itemBaseStatMetadataIsNative(statId: number): boolean {
  return ITEM_BASE_STAT_CATALOG.stats.find(stat => stat.statId === statId)?.nativeMarketMenu === true;
}

function itemKeyForSearchTarget(target: MarketSearchTarget): string {
  if (target.runewordId !== undefined) return `runeword-repository:${target.runewordId}`;
  const mask = target.itemMask;
  const repository = Math.floor(mask / MARKET_MASK_REPOSITORY_FACTOR) === 1 ? "unique" : "normal";
  const weaponType = Math.floor(mask % MARKET_MASK_REPOSITORY_FACTOR / MARKET_MASK_WEAPON_TYPE_FACTOR);
  const type = Math.floor(mask % MARKET_MASK_WEAPON_TYPE_FACTOR / MARKET_MASK_ITEM_TYPE_FACTOR);
  const id = mask % MARKET_MASK_ITEM_TYPE_FACTOR;
  return `${repository}:${type}:${weaponType}:${id}`;
}

export type MarketItemMaskRejectionReason =
  | "unknown-repository"
  | "runeword-requires-selector"
  | "invalid-identity"
  | "unclassified-identity"
  | "out-of-range-identity"
  | "quarantined-identity";

export type MarketItemMaskResolution =
  | { ok: true; itemMask: number }
  | { ok: false; reason: MarketItemMaskRejectionReason };

export function resolveMarketItemMask(identity: MarketItemIdentity): MarketItemMaskResolution {
  if (identity?.repository === "unknown") return { ok: false, reason: "unknown-repository" };
  if (identity?.repository === "runeword") return { ok: false, reason: "runeword-requires-selector" };
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
  | "invalid-runeword-id"
  | "mixed-item-target"
  | "invalid-min-sockets"
  | "invalid-stat-filters"
  | "too-many-stat-filters"
  | "invalid-stat-filter"
  | "unknown-stat-id"
  | "unsupported-stat-minimum"
  | "duplicate-stat-id";

export type MarketSearchRequestNormalization =
  | { ok: true; request: MarketSearchRequest }
  | { ok: false; reason: MarketSearchRequestRejectionReason };

export function normalizeMarketSearchRequest(value: unknown): MarketSearchRequestNormalization {
  if (!isRecord(value)) return { ok: false, reason: "invalid-request" };
  if (value.itemMask !== undefined && value.runewordId !== undefined) return { ok:false,reason:"mixed-item-target" };
  let target: MarketSearchTarget;
  if (value.runewordId !== undefined) {
    if (!isSafeInteger(value.runewordId) || !runewordMarketById(value.runewordId)) return {ok:false,reason:"invalid-runeword-id"};
    target = {runewordId:value.runewordId};
  } else {
    if (!isIntegerInRange(value.itemMask, 0, MARKET_MASK_MAX_VALUE)) return { ok: false, reason: "invalid-item-mask" };
    target = {itemMask:value.itemMask};
  }
  const filters = normalizeMarketFilterCriteria(value);
  if (filters.ok && filters.criteria.statFilters.some(filter => marketStatMinimumIssue(filter.statId, itemKeyForSearchTarget(target)))) {
    return { ok: false, reason: "unsupported-stat-minimum" };
  }
  return filters.ok ? { ok: true, request: { ...target, ...filters.criteria } } : filters;
}

export function normalizeMarketFilterCriteria(value: unknown):
  | { ok: true; criteria: MarketFilterCriteria }
  | { ok: false; reason: MarketSearchRequestRejectionReason } {
  if (!isRecord(value)) return { ok: false, reason: "invalid-request" };
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

  const criteria: MarketFilterCriteria = { statFilters };
  if (value.minSockets !== undefined) criteria.minSockets = value.minSockets;
  return { ok: true, criteria };
}

export function sanitizeMarketSearchResult(value: unknown): MarketSearchResult {
  if (!isRecord(value) || !Array.isArray(value.listings)) return { listings: [] };

  const listings = value.listings
    .map((candidate, sourceIndex) => sanitizeListing(candidate, sourceIndex))
    .filter((candidate): candidate is SanitizedListing => candidate !== null)
    .sort((left, right) => left.price - right.price || left.sourceIndex - right.sourceIndex)
    .slice(0, MARKET_SEARCH_LISTING_LIMIT)
    .map(({ sourceIndex: _sourceIndex, ...listing }) => listing);

  const result: MarketSearchResult = { listings };
  for (const field of ["totalMatches", "returnedCount"] as const) {
    if (typeof value[field] === "number" && Number.isSafeInteger(value[field]) && value[field] >= 0) {
      result[field] = value[field];
    }
  }
  return result;
}

interface SanitizedListing extends MarketListing {
  sourceIndex: number;
}

function sanitizeListing(value: unknown, sourceIndex: number): SanitizedListing | null {
  if (!isRecord(value) || !isNonNegativeFiniteNumber(value.price)) return null;
  const listing: SanitizedListing = { price: value.price, sourceIndex };
  if (isNonNegativeFiniteNumber(value.unitPrice)) listing.unitPrice = value.unitPrice;
  const item = sanitizeMarketListingItem(value.item);
  if (item) listing.item = item;
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
