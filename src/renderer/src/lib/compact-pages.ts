import {
  cleanLabel,
  compactRunTileDisplay,
  compactRunTilesEqual,
  defaultCompactRunTiles,
  normalizeCompactRunTile,
  standardTile,
  type CompactRunTileConfig,
  type CompactRunTileDisplay,
  type CompactRunTileDisplayContext,
} from "./compact-tiles";

export type CompactPageKind = "tiles" | "zone";

export interface CompactPageConfig {
  id: string;
  name: string;
  kind: CompactPageKind;
  tiles: CompactRunTileConfig[];
}

export interface CompactPageDisplay {
  id: string;
  name: string;
  kind: CompactPageKind;
  tiles: CompactRunTileDisplay[];
}

export interface CompactNavigationConfig {
  wheel: boolean;
  arrowKeys: boolean;
  pageKeys: boolean;
  wrap: boolean;
}

export interface CompactPagePreset {
  id: string;
  name: string;
  description: string;
  pages: CompactPageConfig[];
}

export const COMPACT_PAGE_LIMIT = 6;
export const COMPACT_PAGE_TILE_LIMIT = 4;
const PAGE_NAME_LENGTH = 20;

export const defaultCompactNavigation: CompactNavigationConfig = { wheel: true, arrowKeys: true, pageKeys: true, wrap: true };

const runPage = (): CompactPageConfig => tilesPage("run", "Run", ["duration", "gold", "xp", "kills"]);
const lootPage = (): CompactPageConfig => tilesPage("loot", "Loot", ["set", "satanic", "heroic", "angelic"]);
const resourcesPage = (): CompactPageConfig => tilesPage("resources", "Resources", ["keys", "ores", "materials", "gold"]);
const zonePage = (): CompactPageConfig => ({ id: "zone", name: "Satanic Zone", kind: "zone", tiles: [] });

export const defaultCompactPages: CompactPageConfig[] = [runPage(), lootPage(), zonePage()];

export const COMPACT_PAGE_PRESETS: CompactPagePreset[] = [
  { id: "default", name: "Run, Loot, Zone", description: "Run pace, high-value drops and the Satanic Zone.", pages: defaultCompactPages },
  { id: "farming", name: "Farming", description: "Run pace, resources and the Satanic Zone.", pages: [runPage(), resourcesPage(), zonePage()] },
  { id: "everything", name: "Everything", description: "Run, loot, resources and zone pages.", pages: [runPage(), lootPage(), resourcesPage(), zonePage()] },
  { id: "single", name: "Single Page", description: "One page with run pace only. Nothing to scroll.", pages: [runPage()] },
];

export function cloneCompactPages(pages: CompactPageConfig[]): CompactPageConfig[] {
  return pages.map((page) => ({ ...page, tiles: page.tiles.map((tile) => ({ ...tile })) }));
}

export function compactPagesEqual(left: CompactPageConfig[], right: CompactPageConfig[]): boolean {
  return left.length === right.length && left.every((page, index) => {
    const other = right[index];
    return other !== undefined && page.id === other.id && page.name === other.name && page.kind === other.kind
      && compactRunTilesEqual(page.tiles, other.tiles);
  });
}

export function compactPageTiles(pages: CompactPageConfig[]): CompactRunTileConfig[] {
  return pages.flatMap((page) => page.tiles);
}

export function createCompactPage(existing: CompactPageConfig[]): CompactPageConfig {
  return { id: uniquePageId(existing, "page"), name: `Page ${existing.length + 1}`, kind: "tiles", tiles: [] };
}

/** Reads saved pages, or migrates the pre-pages flat tile list when no pages were saved. */
export function normalizeCompactPages(value: unknown, legacyTiles?: unknown): CompactPageConfig[] {
  if (!Array.isArray(value)) return migrateLegacyTiles(legacyTiles);
  const pages: CompactPageConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const candidate = item as Partial<CompactPageConfig>;
    const kind: CompactPageKind = candidate.kind === "zone" ? "zone" : "tiles";
    const requestedId = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 64) : "";
    const id = requestedId && !pages.some((page) => page.id === requestedId) ? requestedId : uniquePageId(pages, kind === "zone" ? "zone" : "page");
    const name = cleanLabel(candidate.name).slice(0, PAGE_NAME_LENGTH).trim() || (kind === "zone" ? "Satanic Zone" : `Page ${pages.length + 1}`);
    pages.push({ id, name, kind, tiles: kind === "zone" ? [] : normalizePageTiles(candidate.tiles) });
    if (pages.length >= COMPACT_PAGE_LIMIT) break;
  }
  return pages.length ? pages : cloneCompactPages(defaultCompactPages);
}

export function normalizeCompactNavigation(value: unknown): CompactNavigationConfig {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<CompactNavigationConfig> : {};
  const flag = (key: keyof CompactNavigationConfig) => typeof candidate[key] === "boolean" ? candidate[key] as boolean : defaultCompactNavigation[key];
  return { wheel: flag("wheel"), arrowKeys: flag("arrowKeys"), pageKeys: flag("pageKeys"), wrap: flag("wrap") };
}

export function compactPageDisplays(pages: CompactPageConfig[], context: CompactRunTileDisplayContext): CompactPageDisplay[] {
  return pages.map((page) => ({
    id: page.id, name: page.name, kind: page.kind,
    tiles: page.tiles.map((tile) => compactRunTileDisplay(tile, context)),
  }));
}

function normalizePageTiles(value: unknown): CompactRunTileConfig[] {
  if (!Array.isArray(value)) return [];
  const tiles: CompactRunTileConfig[] = [];
  for (const item of value) {
    const tile = normalizeCompactRunTile(item);
    if (!tile || (tile.kind !== "custom" && tiles.some((existing) => existing.kind === tile.kind))) continue;
    tiles.push(tile);
    if (tiles.length >= COMPACT_PAGE_TILE_LIMIT) break;
  }
  return tiles;
}

function migrateLegacyTiles(value: unknown): CompactPageConfig[] {
  if (!Array.isArray(value)) return cloneCompactPages(defaultCompactPages);
  const tiles = normalizePageTiles(value.length > COMPACT_PAGE_TILE_LIMIT ? value.slice(0, COMPACT_PAGE_TILE_LIMIT) : value);
  const rest = value.length > COMPACT_PAGE_TILE_LIMIT ? normalizePageTiles(value.slice(COMPACT_PAGE_TILE_LIMIT)) : [];
  const legacy = value.map((item) => normalizeCompactRunTile(item)).filter((tile): tile is CompactRunTileConfig => tile !== null);
  if (compactRunTilesEqual(legacy, defaultCompactRunTiles)) return cloneCompactPages(defaultCompactPages);
  const pages: CompactPageConfig[] = [];
  if (tiles.length) pages.push({ id: "run", name: "Run", kind: "tiles", tiles });
  if (rest.length) pages.push({ id: "run-2", name: "Run 2", kind: "tiles", tiles: rest });
  pages.push(zonePage());
  return pages;
}

function tilesPage(id: string, name: string, kinds: Array<Exclude<CompactRunTileConfig["kind"], "custom">>): CompactPageConfig {
  return { id, name, kind: "tiles", tiles: kinds.map((kind) => standardTile(kind)) };
}

function uniquePageId(pages: CompactPageConfig[], prefix: string): string {
  for (let index = 1; ; index += 1) {
    const id = index === 1 && prefix === "zone" ? "zone" : `${prefix}-${index}`;
    if (!pages.some((page) => page.id === id)) return id;
  }
}
