import { watch } from "vue";
import {
  THEME_FOREGROUND_FILL_MAX,
  THEME_FOREGROUND_FILL_MIN,
  themeTokenCssVar,
  type ThemeBackgroundTextureId,
  type ThemeId,
  type ThemeTokenKey,
  type ThemeTokenMaps,
} from "./themes";

interface ReadableRef<T> {
  readonly value: T;
}

export function useThemeApplication(
  effectiveThemeId: ReadableRef<ThemeId>,
  activeThemeAccent: ReadableRef<string>,
  themeTokenMaps: ReadableRef<ThemeTokenMaps>,
  activeBackgroundTexture: ReadableRef<ThemeBackgroundTextureId>,
  activeForegroundFill: ReadableRef<number>,
): void {
  const appliedThemeTokenKeys = new Set<ThemeTokenKey>();

  function applyTheme(): void {
    const foregroundFill = Math.max(THEME_FOREGROUND_FILL_MIN, Math.min(THEME_FOREGROUND_FILL_MAX, Math.trunc(activeForegroundFill.value)));
    const fillRatio = (foregroundFill - THEME_FOREGROUND_FILL_MIN) / (THEME_FOREGROUND_FILL_MAX - THEME_FOREGROUND_FILL_MIN);
    const panelAlpha = 0.08 + fillRatio * 0.92;
    const strongAlpha = 0.14 + fillRatio * 0.86;
    const softAlpha = 0.035 + fillRatio * 0.18;
    const cellAlpha = 0.028 + fillRatio * 0.17;
    const inputAlpha = 0.24 + fillRatio * 0.76;
    const hoverAlpha = 0.05 + fillRatio * 0.18;
    const selectedAlpha = 0.06 + fillRatio * 0.22;
    const backdropBlur = 3 + fillRatio * 15;
    const backdropSaturation = 1 + fillRatio * 0.16;
    const sheenScale = 0.24 + fillRatio * 0.76;
    document.documentElement.dataset.theme = effectiveThemeId.value;
    document.documentElement.dataset.backgroundTexture = activeBackgroundTexture.value;
    document.documentElement.style.setProperty("--user-accent", activeThemeAccent.value);
    document.documentElement.style.setProperty("--foreground-fill-percent", String(foregroundFill));
    document.documentElement.style.setProperty("--foreground-fill-ratio", fillRatio.toFixed(3));
    document.documentElement.style.setProperty("--foreground-fill-alpha", panelAlpha.toFixed(3));
    document.documentElement.style.setProperty("--foreground-strong-fill-alpha", strongAlpha.toFixed(3));
    document.documentElement.style.setProperty("--foreground-soft-fill-alpha", softAlpha.toFixed(3));
    document.documentElement.style.setProperty("--foreground-cell-fill-alpha", cellAlpha.toFixed(3));
    document.documentElement.style.setProperty("--foreground-input-fill-alpha", inputAlpha.toFixed(3));
    document.documentElement.style.setProperty("--foreground-hover-fill-alpha", hoverAlpha.toFixed(3));
    document.documentElement.style.setProperty("--foreground-selected-fill-alpha", selectedAlpha.toFixed(3));
    document.documentElement.style.setProperty("--foreground-backdrop-blur", `${backdropBlur.toFixed(1)}px`);
    document.documentElement.style.setProperty("--foreground-backdrop-saturation", backdropSaturation.toFixed(3));
    document.documentElement.style.setProperty("--foreground-sheen-scale", sheenScale.toFixed(3));
    for (const key of appliedThemeTokenKeys) {
      const cssVar = themeTokenCssVar(key);
      if (cssVar) document.documentElement.style.removeProperty(cssVar);
    }
    appliedThemeTokenKeys.clear();
    const tokens = themeTokenMaps.value[effectiveThemeId.value] ?? {};
    for (const [key, value] of Object.entries(tokens) as Array<[ThemeTokenKey, string]>) {
      const cssVar = themeTokenCssVar(key);
      if (!cssVar || !value) continue;
      document.documentElement.style.setProperty(cssVar, value);
      appliedThemeTokenKeys.add(key);
    }
  }

  watch([effectiveThemeId, activeThemeAccent, themeTokenMaps, activeBackgroundTexture, activeForegroundFill], applyTheme, {
    immediate: true,
    deep: true,
  });
}
