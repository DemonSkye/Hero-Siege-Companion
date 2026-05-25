import { isRecord, stringField } from "./text";
import { cyberpunkTheme } from "./theme-presets/cyberpunk";
import { darkTheme } from "./theme-presets/dark";
import { lightTheme } from "./theme-presets/light";

export const THEME_OPTIONS = [
  darkTheme,
  cyberpunkTheme,
  lightTheme,
] as const;

export type ThemeId = (typeof THEME_OPTIONS)[number]["id"];
export type ThemeAccentMap = Record<ThemeId, string>;

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
  tokens: ThemeTokenMap;
  note: string;
}

export const DEFAULT_THEME_ID: ThemeId = "dark";
export const DEFAULT_THEME_ACCENTS: ThemeAccentMap = Object.fromEntries(
  THEME_OPTIONS.map((theme) => [theme.id, theme.defaultAccent]),
) as ThemeAccentMap;

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

export function createThemeExportPayload(themeId: ThemeId, accents: ThemeAccentMap, tokenMaps: ThemeTokenMaps = {}): ThemeExportPayload {
  const normalizedId = normalizeThemeId(themeId);
  const normalizedAccents = normalizeThemeAccents(accents);
  const tokens = normalizeThemeTokens(tokenMaps[normalizedId]);
  return {
    kind: "theme",
    version: 1,
    themeId: normalizedId,
    accent: normalizedAccents[normalizedId],
    accents: normalizedAccents,
    tokens,
    note: "Theme imports support base theme, accent color, and optional app chrome tokens. Rarity colors stay game-matched.",
  };
}

export function importThemePayload(contents: string, currentThemeId: ThemeId, currentAccents: ThemeAccentMap, currentTokenMaps: ThemeTokenMaps = {}): { themeId: ThemeId; themeAccents: ThemeAccentMap; themeTokenMaps: ThemeTokenMaps } {
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
  return { themeId, themeAccents, themeTokenMaps };
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
