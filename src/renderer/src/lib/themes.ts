import { isRecord, stringField } from "./text";
import { cyberpunkTheme } from "./theme-presets/cyberpunk";
import { darkTheme } from "./theme-presets/dark";
import { demonsteelTheme } from "./theme-presets/demonsteel";
import { lightTheme } from "./theme-presets/light";
import { reliquaryTheme } from "./theme-presets/reliquary";
import { voidglassTheme } from "./theme-presets/voidglass";

export const THEME_OPTIONS = [
  darkTheme,
  demonsteelTheme,
  voidglassTheme,
  reliquaryTheme,
  cyberpunkTheme,
  lightTheme,
] as const;

export type ThemeId = (typeof THEME_OPTIONS)[number]["id"];
export type ThemeAccentMap = Record<ThemeId, string>;

export const THEME_TEXTURE_DEFAULT_ID = "theme-default";
export const THEME_BACKGROUND_TEXTURE_OPTIONS = [
  { id: "none", label: "None" },
  { id: "carbon-fiber", label: "Carbon Fiber" },
  { id: "brimstone", label: "Brimstone" },
  { id: "brushed-metal", label: "Brushed Metal" },
  { id: "slate-grid", label: "Slate Grid" },
  { id: "neon-grid", label: "Neon Grid" },
  { id: "reliquary-inlay", label: "Reliquary Inlay" },
  { id: "void-fracture", label: "Void Fracture" },
  { id: "hex-mesh", label: "Hex Mesh" },
  { id: "arcane-sigil", label: "Arcane Sigil" },
  { id: "starfield-dust", label: "Starfield Dust" },
] as const;

export type ThemeBackgroundTextureId = (typeof THEME_BACKGROUND_TEXTURE_OPTIONS)[number]["id"];
export type ThemeTextureSelectionId = ThemeBackgroundTextureId | typeof THEME_TEXTURE_DEFAULT_ID;
export type ThemeTextureMap = Partial<Record<ThemeId, ThemeBackgroundTextureId>>;

export const THEME_FOREGROUND_FILL_MIN = 25;
export const THEME_FOREGROUND_FILL_MAX = 100;
export type ThemeForegroundFillMap = Partial<Record<ThemeId, number>>;

export const THEME_TOKEN_OPTIONS = [
  { key: "appBg", cssVar: "--app-bg", label: "App background" },
  { key: "appBgGradient", cssVar: "--app-bg-gradient", label: "App background gradient" },
  { key: "appText", cssVar: "--app-text", label: "Main text" },
  { key: "appHeading", cssVar: "--app-heading", label: "Headings" },
  { key: "appMuted", cssVar: "--app-muted", label: "Muted text" },
  { key: "appMutedStrong", cssVar: "--app-muted-strong", label: "Strong muted text" },
  { key: "surface", cssVar: "--surface", label: "Panel surface" },
  { key: "surfaceStrong", cssVar: "--surface-strong", label: "Strong surface" },
  { key: "surfaceSoft", cssVar: "--surface-soft", label: "Soft surface" },
  { key: "surfaceCell", cssVar: "--surface-cell", label: "Cell surface" },
  { key: "surfaceHover", cssVar: "--surface-hover", label: "Hover surface" },
  { key: "surfaceSelected", cssVar: "--surface-selected", label: "Selected surface" },
  { key: "border", cssVar: "--border", label: "Border" },
  { key: "borderStrong", cssVar: "--border-strong", label: "Strong border" },
  { key: "accentBorder", cssVar: "--accent-border", label: "Accent border" },
  { key: "accentWarm", cssVar: "--accent-warm", label: "Warm accent" },
  { key: "accentWarmBg", cssVar: "--accent-warm-bg", label: "Warm accent background" },
  { key: "inputBg", cssVar: "--input-bg", label: "Input background" },
  { key: "buttonPrimary", cssVar: "--button-primary", label: "Primary button" },
  { key: "buttonPrimaryHover", cssVar: "--button-primary-hover", label: "Primary button hover" },
  { key: "buttonPrimaryText", cssVar: "--button-primary-text", label: "Primary button text" },
  { key: "danger", cssVar: "--danger", label: "Danger" },
  { key: "dangerBg", cssVar: "--danger-bg", label: "Danger background" },
  { key: "warning", cssVar: "--warning", label: "Warning" },
  { key: "scrollbar", cssVar: "--scrollbar", label: "Scrollbar" },
  { key: "shadow", cssVar: "--shadow", label: "Shadow" },
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_OPTIONS)[number]["key"];
export type ThemeTokenMap = Partial<Record<ThemeTokenKey, string>>;
export type ThemeTokenMaps = Partial<Record<ThemeId, ThemeTokenMap>>;

export interface ThemeExportPayload {
  kind: "theme";
  version: 1;
  themeId: ThemeId;
  accent: string;
  accents: ThemeAccentMap;
  texture: ThemeBackgroundTextureId;
  textures: ThemeTextureMap;
  foregroundFill: number;
  foregroundFills: ThemeForegroundFillMap;
  tokens: ThemeTokenMap;
  note: string;
}

export interface ThemeTemplatePayload extends ThemeExportPayload {
  template: true;
  editableFields: string[];
  tokenReference: Array<{ key: ThemeTokenKey; cssVar: string; label: string }>;
}

export const DEFAULT_THEME_ID: ThemeId = "voidglass";
export const DEFAULT_THEME_ACCENTS: ThemeAccentMap = Object.fromEntries(
  THEME_OPTIONS.map((theme) => [theme.id, theme.defaultAccent]),
) as ThemeAccentMap;
export const DEFAULT_THEME_TEXTURES: Record<ThemeId, ThemeBackgroundTextureId> = {
  dark: "slate-grid",
  demonsteel: "brimstone",
  voidglass: "carbon-fiber",
  reliquary: "reliquary-inlay",
  cyberpunk: "neon-grid",
  light: "brushed-metal",
};
export const DEFAULT_THEME_FOREGROUND_FILLS: Record<ThemeId, number> = {
  dark: 88,
  demonsteel: 72,
  voidglass: 58,
  reliquary: 74,
  cyberpunk: 68,
  light: 82,
};

export function normalizeThemeId(value: unknown): ThemeId {
  return THEME_OPTIONS.some((theme) => theme.id === value) ? value as ThemeId : DEFAULT_THEME_ID;
}

export function normalizeThemeAccents(value: unknown): ThemeAccentMap {
  const source = isRecord(value) ? value : {};
  const next = { ...DEFAULT_THEME_ACCENTS };
  for (const theme of THEME_OPTIONS) {
    const color = normalizeThemeAccent(stringField(source, theme.id));
    if (color) next[theme.id] = color;
  }
  return next;
}

export function normalizeThemeAccent(value: string): string {
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : "";
}

export function normalizeThemeTexture(value: unknown): ThemeBackgroundTextureId | "" {
  const candidate = typeof value === "string" ? value : "";
  return THEME_BACKGROUND_TEXTURE_OPTIONS.some((texture) => texture.id === candidate)
    ? candidate as ThemeBackgroundTextureId
    : "";
}

export function normalizeThemeTextureMap(value: unknown): ThemeTextureMap {
  const source = isRecord(value) ? value : {};
  const next: ThemeTextureMap = {};
  for (const theme of THEME_OPTIONS) {
    const texture = normalizeThemeTexture(source[theme.id]);
    if (texture) next[theme.id] = texture;
  }
  return next;
}

export function effectiveThemeTexture(themeId: ThemeId, textures: ThemeTextureMap = {}): ThemeBackgroundTextureId {
  return textures[themeId] ?? DEFAULT_THEME_TEXTURES[themeId];
}

export function themeTextureLabel(textureId: ThemeBackgroundTextureId): string {
  return THEME_BACKGROUND_TEXTURE_OPTIONS.find((texture) => texture.id === textureId)?.label ?? textureId;
}

export function normalizeThemeForegroundFill(value: unknown): number | null {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  return Math.max(THEME_FOREGROUND_FILL_MIN, Math.min(THEME_FOREGROUND_FILL_MAX, Math.trunc(amount)));
}

export function normalizeThemeForegroundFillMap(value: unknown): ThemeForegroundFillMap {
  const source = isRecord(value) ? value : {};
  const next: ThemeForegroundFillMap = {};
  for (const theme of THEME_OPTIONS) {
    const fill = normalizeThemeForegroundFill(source[theme.id]);
    if (fill !== null) next[theme.id] = fill;
  }
  return next;
}

export function effectiveThemeForegroundFill(themeId: ThemeId, fills: ThemeForegroundFillMap = {}): number {
  return fills[themeId] ?? DEFAULT_THEME_FOREGROUND_FILLS[themeId];
}

export function normalizeThemeTokenMaps(value: unknown): ThemeTokenMaps {
  const source = isRecord(value) ? value : {};
  const next: ThemeTokenMaps = {};
  for (const theme of THEME_OPTIONS) {
    const tokens = normalizeThemeTokens(source[theme.id]);
    if (Object.keys(tokens).length > 0) next[theme.id] = tokens;
  }
  return next;
}

export function normalizeThemeTokens(value: unknown): ThemeTokenMap {
  const source = isRecord(value) ? value : {};
  const next: ThemeTokenMap = {};
  for (const token of THEME_TOKEN_OPTIONS) {
    const normalized = normalizeThemeTokenValue(stringField(source, token.key));
    if (normalized) next[token.key] = normalized;
  }
  return next;
}

export function createThemeExportPayload(
  themeId: ThemeId,
  accents: ThemeAccentMap,
  tokenMaps: ThemeTokenMaps = {},
  textureMaps: ThemeTextureMap = {},
  foregroundFillMaps: ThemeForegroundFillMap = {},
): ThemeExportPayload {
  const normalizedId = normalizeThemeId(themeId);
  const normalizedAccents = normalizeThemeAccents(accents);
  const tokens = normalizeThemeTokens(tokenMaps[normalizedId]);
  const textures = normalizeThemeTextureMap(textureMaps);
  const foregroundFills = normalizeThemeForegroundFillMap(foregroundFillMaps);
  return {
    kind: "theme",
    version: 1,
    themeId: normalizedId,
    accent: normalizedAccents[normalizedId],
    accents: normalizedAccents,
    texture: effectiveThemeTexture(normalizedId, textures),
    textures,
    foregroundFill: effectiveThemeForegroundFill(normalizedId, foregroundFills),
    foregroundFills,
    tokens,
    note: "Import Theme reads this JSON. It supports base theme, accent color, background texture, foreground fill, and optional app chrome tokens; rarity colors stay game-matched.",
  };
}

export function createThemeTemplatePayload(themeId: ThemeId = DEFAULT_THEME_ID): ThemeTemplatePayload {
  const normalizedId = normalizeThemeId(themeId);
  return {
    kind: "theme",
    version: 1,
    template: true,
    themeId: normalizedId,
    accent: DEFAULT_THEME_ACCENTS[normalizedId],
    accents: { ...DEFAULT_THEME_ACCENTS },
    texture: DEFAULT_THEME_TEXTURES[normalizedId],
    textures: { ...DEFAULT_THEME_TEXTURES },
    foregroundFill: DEFAULT_THEME_FOREGROUND_FILLS[normalizedId],
    foregroundFills: { ...DEFAULT_THEME_FOREGROUND_FILLS },
    tokens: {},
    editableFields: [
      "themeId selects a built-in base theme: dark, demonsteel, voidglass, reliquary, cyberpunk, or light.",
      "accent changes the selected theme's primary highlight color.",
      "texture selects a built-in background texture. Omit it to keep the base theme default.",
      `foregroundFill controls main foreground material fill from ${THEME_FOREGROUND_FILL_MIN} to ${THEME_FOREGROUND_FILL_MAX}.`,
      "tokens overrides app chrome CSS variables. Omit a token to keep the base theme value.",
      "Use hex, rgb(), rgba(), linear-gradient(), or radial-gradient() values. Invalid token values are ignored.",
    ],
    tokenReference: THEME_TOKEN_OPTIONS.map(({ key, cssVar, label }) => ({ key, cssVar, label })),
    note: "Starter theme template. Edit values, remove tokens, textures, and foreground fills you do not want to override, then import this JSON with Settings > Appearance > Import Theme. Rarity colors stay game-matched.",
  };
}

export function importThemePayload(
  contents: string,
  currentThemeId: ThemeId,
  currentAccents: ThemeAccentMap,
  currentTokenMaps: ThemeTokenMaps = {},
  currentTextureMaps: ThemeTextureMap = {},
  currentForegroundFillMaps: ThemeForegroundFillMap = {},
): {
  themeId: ThemeId;
  themeAccents: ThemeAccentMap;
  themeTokenMaps: ThemeTokenMaps;
  themeTextureMaps: ThemeTextureMap;
  themeForegroundFillMaps: ThemeForegroundFillMap;
} {
  const parsed = JSON.parse(contents) as unknown;
  if (!isRecord(parsed)) throw new Error("Theme JSON must be an object.");
  const source = isRecord(parsed.theme) ? parsed.theme : parsed;
  const rawThemeId = stringField(source, "themeId") || stringField(source, "baseTheme") || stringField(source, "id") || currentThemeId;
  const themeId = normalizeThemeId(rawThemeId);
  const themeAccents = normalizeThemeAccents(isRecord(source.accents) ? source.accents : currentAccents);
  const accent = normalizeThemeAccent(stringField(source, "accent") || stringField(source, "accentColor"));
  if (accent) themeAccents[themeId] = accent;
  const importedTokens = normalizeThemeTokens(source.tokens);
  const themeTokenMaps = normalizeThemeTokenMaps(currentTokenMaps);
  if (Object.keys(importedTokens).length > 0) themeTokenMaps[themeId] = importedTokens;
  const importedTextureMaps = normalizeThemeTextureMap(source.textures);
  const themeTextureMaps = { ...normalizeThemeTextureMap(currentTextureMaps), ...importedTextureMaps };
  const texture = normalizeThemeTexture(stringField(source, "texture") || stringField(source, "backgroundTexture"));
  if (texture) themeTextureMaps[themeId] = texture;
  const importedForegroundFillMaps = normalizeThemeForegroundFillMap(source.foregroundFills);
  const themeForegroundFillMaps = { ...normalizeThemeForegroundFillMap(currentForegroundFillMaps), ...importedForegroundFillMaps };
  const foregroundFill = normalizeThemeForegroundFill(source.foregroundFill ?? source.panelFill ?? source.surfaceFill);
  if (foregroundFill !== null) themeForegroundFillMaps[themeId] = foregroundFill;
  return { themeId, themeAccents, themeTokenMaps, themeTextureMaps, themeForegroundFillMaps };
}

export function themeTokenCssVar(key: ThemeTokenKey): string {
  return THEME_TOKEN_OPTIONS.find((token) => token.key === key)?.cssVar ?? "";
}

function normalizeThemeTokenValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return "";
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  if (/^(?:linear-gradient|radial-gradient)\([^;{}<>]*\)(?:\s*,\s*(?:linear-gradient|radial-gradient)\([^;{}<>]*\))*$/i.test(trimmed)) return trimmed;
  return "";
}
