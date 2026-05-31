import type { RunStatus } from "../../../shared/app-state";
import type { CompanionStats, ItemTimelineEntry } from "../../../shared/stats";
import { formatMagicFindFlagCount, formatNumber } from "./format";
import { matchItemFilter, type ItemFilterGroup } from "./item-filters";
import { normalizeLookupText } from "./text";

export type CompactRunTileKind =
  | "duration"
  | "gold"
  | "xp"
  | "kills"
  | "sz"
  | "keys"
  | "ores"
  | "materials"
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

export interface CompactRunTileDisplayContext {
  stats: CompanionStats;
  runStatus: RunStatus;
  sessionDuration: string;
  runPausedLabel: string;
  currentGoldLabel: string;
  zoneCountdown: string;
  zoneResetLabel: string;
  itemFilterGroups: ItemFilterGroup[];
}

export interface CompactFilterGroupRecoveryOption {
  id: string;
  name: string;
  tileCount: number;
}

export interface CompactRunTilePreset {
  id: string;
  name: string;
  description: string;
  tiles: CompactRunTileConfig[];
}

export const COMPACT_RUN_TILE_LIMIT = 8;

export const STANDARD_COMPACT_RUN_TILE_OPTIONS: Array<{ kind: Exclude<CompactRunTileKind, "custom">; label: string }> = [
  { kind: "duration", label: "Duration" },
  { kind: "gold", label: "Gold" },
  { kind: "xp", label: "XP" },
  { kind: "kills", label: "Kills" },
  { kind: "sz", label: "SZ" },
  { kind: "keys", label: "Keys" },
  { kind: "ores", label: "Ore" },
  { kind: "materials", label: "Materials" },
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

export const COMPACT_RUN_TILE_PRESETS: CompactRunTilePreset[] = [
  {
    id: "default-run",
    name: "Default Run",
    description: "Core run stats with zone and high-value drop counters.",
    tiles: defaultCompactRunTiles,
  },
  {
    id: "loot-focused",
    name: "Loot Focused",
    description: "Tracked rarity counters for gear farming sessions.",
    tiles: [standardTile("duration"), standardTile("gold"), standardTile("sz"), standardTile("set"), standardTile("satanic"), standardTile("heroic"), standardTile("angelic")],
  },
  {
    id: "resource-focused",
    name: "Resource Focused",
    description: "Keys, ore, materials, and gold in a compact farming view.",
    tiles: [standardTile("duration"), standardTile("gold"), standardTile("keys"), standardTile("ores"), standardTile("materials"), standardTile("sz")],
  },
  {
    id: "xp-kills-focused",
    name: "XP / Kills",
    description: "Progress and pace for leveling or density checks.",
    tiles: [standardTile("duration"), standardTile("xp"), standardTile("kills"), standardTile("gold"), standardTile("sz")],
  },
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

export function cloneCompactRunTiles(tiles: CompactRunTileConfig[]): CompactRunTileConfig[] {
  return tiles.map((tile) => ({ ...tile }));
}

export function compactRunTilesEqual(left: CompactRunTileConfig[], right: CompactRunTileConfig[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((tile, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      tile.id === other.id &&
      tile.kind === other.kind &&
      (tile.label ?? "") === (other.label ?? "") &&
      (tile.source ?? "") === (other.source ?? "") &&
      (tile.itemName ?? "") === (other.itemName ?? "") &&
      (tile.groupId ?? "") === (other.groupId ?? "")
    );
  });
}

export function compactRunTilesHaveCustomSources(tiles: CompactRunTileConfig[]): boolean {
  return tiles.some((tile) => tile.kind === "custom");
}

export function compactFilterGroupRecoveryOptions(tiles: CompactRunTileConfig[], itemFilterGroups: ItemFilterGroup[]): CompactFilterGroupRecoveryOption[] {
  const existingGroupIds = new Set(itemFilterGroups.map((group) => group.id));
  const options = new Map<string, CompactFilterGroupRecoveryOption>();

  for (const tile of tiles) {
    if (tile.kind !== "custom" || tile.source === "item" || !tile.groupId || existingGroupIds.has(tile.groupId)) continue;
    const name = cleanLabel(tile.label) || "Recovered Group";
    const existing = options.get(tile.groupId);
    if (existing) {
      existing.tileCount += 1;
      if (existing.name === "Recovered Group" && name !== "Recovered Group") existing.name = name;
      continue;
    }
    options.set(tile.groupId, { id: tile.groupId, name, tileCount: 1 });
  }

  return Array.from(options.values()).sort((a, b) => a.name.localeCompare(b.name));
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

export function compactRunTileDisplay(tile: CompactRunTileConfig, context: CompactRunTileDisplayContext): CompactRunTileDisplay {
  const { stats } = context;
  const standardLabels = new Map(STANDARD_COMPACT_RUN_TILE_OPTIONS.map((option) => [option.kind, option.label]));

  switch (tile.kind) {
    case "duration":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "This Run",
        value: context.sessionDuration,
        detail: stats.accountName || "No character packet yet",
        title: context.runStatus === "paused" ? context.runPausedLabel : "Recording",
      };
    case "gold":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "Gold",
        value: formatCompactNumber(stats.totalGoldEarned),
        detail: `${formatNumber(stats.goldPerHour)}/h - Current ${context.currentGoldLabel}`,
        title: `Current ${context.currentGoldLabel} - ${formatNumber(stats.goldPerHour)}/h`,
      };
    case "xp":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "XP",
        value: `${formatCompactNumber(stats.xpPerHour)}/h`,
        detail: `${formatNumber(stats.totalXpEarned)} earned`,
        title: `${formatNumber(stats.totalXpEarned)} earned - ${formatNumber(stats.xpPerHour)}/h`,
      };
    case "kills":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "Kills",
        value: formatCompactNumber(stats.totalKillsEarned),
        detail: `${formatNumber(stats.killsPerHour)}/h`,
        title: `${formatNumber(stats.totalKillsEarned)} kills - ${formatNumber(stats.killsPerHour)}/h`,
      };
    case "sz":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "SZ",
        value: context.zoneCountdown,
        detail: stats.satanicZone?.zone ?? `Resets ${context.zoneResetLabel}`,
        title: "Satanic zone details",
      };
    case "keys":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "Keys",
        value: formatCompactNumber(compactResourceTotal(stats.keys)),
        detail: "Non-basic keys",
        title: `${formatNumber(compactResourceTotal(stats.keys))} non-basic keys`,
      };
    case "ores":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "Ore",
        value: formatCompactNumber(compactResourceTotal(stats.ores)),
        detail: "Ore mined",
        title: `${formatNumber(compactResourceTotal(stats.ores))} ore mined`,
      };
    case "materials":
      return {
        id: tile.id,
        kind: tile.kind,
        label: "Materials",
        value: formatCompactNumber(compactResourceTotal(stats.materials)),
        detail: "Collected",
        title: `${formatNumber(compactResourceTotal(stats.materials))} materials collected`,
      };
    case "set":
    case "satanic":
    case "heroic":
    case "angelic": {
      const label = standardLabels.get(tile.kind) ?? tile.kind;
      return {
        id: tile.id,
        kind: tile.kind,
        label,
        value: formatCompactNumber(stats.items[label]?.total ?? 0),
        detail: `${formatMagicFindFlagCount(stats.items[label]?.mf ?? 0, { short: true })} - ${formatNumber(stats.itemsPerHour[label] ?? 0)}/h`,
        title: `${label} drops`,
      };
    }
    case "custom": {
      const group = context.itemFilterGroups.find((candidate) => candidate.id === tile.groupId);
      const label = tile.label?.trim() || (tile.source === "item" ? tile.itemName : group?.name) || "Custom";
      return {
        id: tile.id,
        kind: tile.kind,
        label,
        value: formatCompactNumber(compactCustomTileTotal(tile, stats, context.itemFilterGroups)),
        detail: tile.source === "item" ? "Exact item" : "Item filter group",
        title: tile.source === "item" ? tile.itemName || label : group?.name ?? label,
      };
    }
  }
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value || 0);
  if (abs >= 1_000_000_000) return `${trimCompact(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trimCompact(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${trimCompact(value / 1_000)}k`;
  return String(Math.trunc(value || 0));
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

function compactResourceTotal(resources: CompanionStats["keys"]): number {
  return Object.values(resources).reduce((total, resource) => total + resource.total, 0);
}

function trimCompact(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function structuredCloneCompat<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
