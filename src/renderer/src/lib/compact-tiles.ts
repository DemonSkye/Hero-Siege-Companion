import type { CompanionStats, ItemTimelineEntry } from "../../../shared/stats";
import { matchItemFilter, type ItemFilterGroup } from "./item-filters";
import { normalizeLookupText } from "./text";

export type CompactRunTileKind =
  | "duration"
  | "gold"
  | "xp"
  | "kills"
  | "sz"
  | "set"
  | "satanic"
  | "heroic"
  | "angelic"
  | "custom";

export type CompactRunCustomSource = "item" | "filterGroup";

export interface CompactRunTileConfig {
  id: string;
  kind: CompactRunTileKind;
  label?: string;
  source?: CompactRunCustomSource;
  itemName?: string;
  groupId?: string;
}

export interface CompactRunTileDisplay {
  id: string;
  kind: CompactRunTileKind;
  label: string;
  value: string;
  detail?: string;
  title?: string;
}

export const COMPACT_RUN_TILE_LIMIT = 8;

export const STANDARD_COMPACT_RUN_TILE_OPTIONS: Array<{ kind: Exclude<CompactRunTileKind, "custom">; label: string }> = [
  { kind: "duration", label: "Duration" },
  { kind: "gold", label: "Gold" },
  { kind: "xp", label: "XP" },
  { kind: "kills", label: "Kills" },
  { kind: "sz", label: "SZ" },
  { kind: "set", label: "Set" },
  { kind: "satanic", label: "Satanic" },
  { kind: "heroic", label: "Heroic" },
  { kind: "angelic", label: "Angelic" },
];

export const defaultCompactRunTiles: CompactRunTileConfig[] = [
  standardTile("duration"),
  standardTile("gold"),
  standardTile("xp"),
  standardTile("kills"),
  standardTile("sz"),
  standardTile("set"),
  standardTile("satanic"),
];

export function standardTile(kind: Exclude<CompactRunTileKind, "custom">): CompactRunTileConfig {
  return { id: kind, kind };
}

export function createCustomCompactRunTile(index: number): CompactRunTileConfig {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: "custom",
    label: `Custom ${index + 1}`,
    source: "filterGroup",
    groupId: "",
    itemName: "",
  };
}

export function normalizeCompactRunTiles(value: unknown): CompactRunTileConfig[] {
  if (!Array.isArray(value)) return structuredCloneCompat(defaultCompactRunTiles);
  const tiles: CompactRunTileConfig[] = [];
  const seenStandard = new Set<CompactRunTileKind>();

  for (const item of value) {
    const tile = normalizeCompactRunTile(item);
    if (!tile) continue;
    if (tile.kind !== "custom") {
      if (seenStandard.has(tile.kind)) continue;
      seenStandard.add(tile.kind);
    }
    tiles.push(tile);
    if (tiles.length >= COMPACT_RUN_TILE_LIMIT) break;
  }

  if (!seenStandard.has("duration")) tiles.unshift(standardTile("duration"));
  return tiles.slice(0, COMPACT_RUN_TILE_LIMIT);
}

export function compactRunCustomTileCount(tiles: CompactRunTileConfig[]): number {
  return tiles.filter((tile) => tile.kind === "custom").length;
}

export function compactCustomTileTotal(tile: CompactRunTileConfig, stats: CompanionStats, itemFilterGroups: ItemFilterGroup[]): number {
  if (tile.kind !== "custom") return 0;
  if (tile.source === "item") {
    const target = normalizeLookupText(tile.itemName ?? "");
    if (!target) return 0;
    return stats.itemTimeline.reduce((total, item) => total + (normalizeLookupText(item.label) === target ? itemAmount(item) : 0), 0);
  }

  const group = itemFilterGroups.find((candidate) => candidate.id === tile.groupId);
  if (!group) return 0;
  return stats.itemTimeline.reduce((total, item) => total + (matchItemFilter(item, [{ ...group, enabled: true }]) ? itemAmount(item) : 0), 0);
}

function normalizeCompactRunTile(value: unknown): CompactRunTileConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<CompactRunTileConfig>;
  const kind = String(candidate.kind ?? candidate.id ?? "").trim().toLowerCase() as CompactRunTileKind;
  if (!STANDARD_COMPACT_RUN_TILE_OPTIONS.some((option) => option.kind === kind) && kind !== "custom") return null;

  if (kind !== "custom") return standardTile(kind);

  const source = candidate.source === "item" ? "item" : "filterGroup";
  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: "custom",
    label: cleanLabel(candidate.label) || "Custom",
    source,
    itemName: typeof candidate.itemName === "string" ? candidate.itemName.trim().replace(/\s+/g, " ") : "",
    groupId: typeof candidate.groupId === "string" ? candidate.groupId : "",
  };
}

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 24) : "";
}

function itemAmount(item: ItemTimelineEntry): number {
  return Math.max(item.amount || 1, 1);
}

function structuredCloneCompat<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
