import { watch } from "vue";
import { themeTokenCssVar, type ThemeId, type ThemeTokenKey, type ThemeTokenMaps } from "./themes";

interface ReadableRef<T> {
  readonly value: T;
}

export function useThemeApplication(
  effectiveThemeId: ReadableRef<ThemeId>,
  activeThemeAccent: ReadableRef<string>,
  themeTokenMaps: ReadableRef<ThemeTokenMaps>,
): void {
  const appliedThemeTokenKeys = new Set<ThemeTokenKey>();

  function applyTheme(): void {
    document.documentElement.dataset.theme = effectiveThemeId.value;
    document.documentElement.style.setProperty("--user-accent", activeThemeAccent.value);
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

  watch([effectiveThemeId, activeThemeAccent, themeTokenMaps], applyTheme, { immediate: true, deep: true });
}
