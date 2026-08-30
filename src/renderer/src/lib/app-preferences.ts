import { ref, type Ref } from "vue";
import { normalizeCompactRunTiles } from "./compact-tiles";
import {
  normalizeCustomItemFilterSounds,
  normalizeItemFilterGroups,
} from "./item-filters";
import {
  defaultPreferences,
  normalizePreferences,
  type UiPreferences,
} from "./preferences";
import { normalizePostRunReportConfig, type PostRunReportConfig } from "./report-config";

/**
 * Owns the renderer's durable preference refs. View-only disclosure state stays
 * with the view that uses it; this module is deliberately not a Settings draft.
 */
export function useAppPreferences() {
  const initial = normalizePreferences(defaultPreferences);

  const logLimit = ref(initial.logLimit);
  const showCaptureDetails = ref(false);
  const hideSocketables = ref(initial.hideSocketables);
  const hideKeys = ref(initial.hideKeys);
  const hideMaterials = ref(initial.hideMaterials);
  const hideUnfilteredTimelineItems = ref(initial.hideUnfilteredTimelineItems);
  const timelineType = ref(initial.timelineType);
  const gameExecutablePath = ref(initial.gameExecutablePath);
  const launchThroughSteam = ref(initial.launchThroughSteam);
  const themeId = ref(initial.themeId);
  const compactThemeId = ref(initial.compactThemeId);
  const themeCustomMode = ref(initial.themeCustomMode);
  const compactThemeCustomMode = ref(initial.compactThemeCustomMode);
  const compactThemeMatchesApp = ref(initial.compactThemeMatchesApp);
  const themeAccents = ref(initial.themeAccents);
  const themeTextures = ref(initial.themeTextures);
  const compactThemeTextures = ref(initial.compactThemeTextures);
  const themeForegroundFills = ref(initial.themeForegroundFills);
  const compactThemeForegroundFills = ref(initial.compactThemeForegroundFills);
  const themeTokenMaps = ref(initial.themeTokenMaps);
  const itemFilterGroups = ref(initial.itemFilterGroups);
  const itemFilterMuted = ref(initial.itemFilterMuted);
  const customItemFilterSounds = ref(initial.customItemFilterSounds);
  const postRunReport = ref(initial.postRunReport);
  const compactRunTiles = ref(initial.compactRunTiles);
  const hiddenDashboardPanels = ref<Array<"item-timeline" | "live-log">>(
    initial.hiddenDashboardPanels.filter((panel): panel is "item-timeline" | "live-log" => (
      panel === "item-timeline" || panel === "live-log"
    )),
  );
  const itemResearchEntries = ref(initial.itemResearchEntries);

  const preferenceWatchSources: Ref<unknown>[] = [
    hideSocketables,
    hideKeys,
    hideMaterials,
    hideUnfilteredTimelineItems,
    timelineType,
    gameExecutablePath,
    launchThroughSteam,
    themeId,
    compactThemeId,
    themeCustomMode,
    compactThemeCustomMode,
    compactThemeMatchesApp,
    themeAccents,
    themeTextures,
    compactThemeTextures,
    themeForegroundFills,
    compactThemeForegroundFills,
    themeTokenMaps,
    itemFilterGroups,
    itemFilterMuted,
    customItemFilterSounds,
    postRunReport,
    compactRunTiles,
    hiddenDashboardPanels,
    itemResearchEntries,
  ];

  function currentPreferences(shoppingListItems: string[]): UiPreferences {
    return normalizePreferences({
      ...defaultPreferences,
      hideSocketables: hideSocketables.value,
      hideKeys: hideKeys.value,
      hideMaterials: hideMaterials.value,
      hideUnfilteredTimelineItems: hideUnfilteredTimelineItems.value,
      timelineType: timelineType.value,
      shoppingListItems,
      gameExecutablePath: gameExecutablePath.value,
      launchThroughSteam: launchThroughSteam.value,
      themeId: themeId.value,
      compactThemeId: compactThemeId.value,
      themeCustomMode: themeCustomMode.value,
      compactThemeCustomMode: compactThemeCustomMode.value,
      compactThemeMatchesApp: compactThemeMatchesApp.value,
      themeAccents: themeAccents.value,
      themeTextures: themeTextures.value,
      compactThemeTextures: compactThemeTextures.value,
      themeForegroundFills: themeForegroundFills.value,
      compactThemeForegroundFills: compactThemeForegroundFills.value,
      themeTokenMaps: themeTokenMaps.value,
      itemFilterGroups: itemFilterGroups.value,
      itemFilterMuted: itemFilterMuted.value,
      customItemFilterSounds: customItemFilterSounds.value,
      postRunReport: postRunReport.value,
      compactRunTiles: compactRunTiles.value,
      hiddenDashboardPanels: hiddenDashboardPanels.value,
      itemResearchEntries: itemResearchEntries.value,
    });
  }

  function applyPreferences(preferences: UiPreferences): void {
    const next = normalizePreferences(preferences);
    logLimit.value = next.logLimit;
    showCaptureDetails.value = false;
    hideSocketables.value = next.hideSocketables;
    hideKeys.value = next.hideKeys;
    hideMaterials.value = next.hideMaterials;
    hideUnfilteredTimelineItems.value = next.hideUnfilteredTimelineItems;
    timelineType.value = next.timelineType;
    gameExecutablePath.value = next.gameExecutablePath;
    launchThroughSteam.value = next.launchThroughSteam;
    themeId.value = next.themeId;
    compactThemeId.value = next.compactThemeId;
    themeCustomMode.value = next.themeCustomMode;
    compactThemeCustomMode.value = next.compactThemeCustomMode;
    compactThemeMatchesApp.value = next.compactThemeMatchesApp;
    themeAccents.value = { ...next.themeAccents };
    themeTextures.value = { ...next.themeTextures };
    compactThemeTextures.value = { ...next.compactThemeTextures };
    themeForegroundFills.value = { ...next.themeForegroundFills };
    compactThemeForegroundFills.value = { ...next.compactThemeForegroundFills };
    themeTokenMaps.value = { ...next.themeTokenMaps };
    customItemFilterSounds.value = normalizeCustomItemFilterSounds(next.customItemFilterSounds);
    itemFilterGroups.value = normalizeItemFilterGroups(next.itemFilterGroups, customItemFilterSounds.value);
    itemFilterMuted.value = next.itemFilterMuted;
    postRunReport.value = normalizePostRunReportConfig(next.postRunReport);
    compactRunTiles.value = normalizeCompactRunTiles(next.compactRunTiles);
    hiddenDashboardPanels.value = next.hiddenDashboardPanels.filter((panel): panel is "item-timeline" | "live-log" => (
      panel === "item-timeline" || panel === "live-log"
    ));
    itemResearchEntries.value = [...next.itemResearchEntries];
  }

  function updatePostRunReportConfig(next: PostRunReportConfig): void {
    postRunReport.value = normalizePostRunReportConfig(next);
  }

  return {
    logLimit,
    showCaptureDetails,
    hideSocketables,
    hideKeys,
    hideMaterials,
    hideUnfilteredTimelineItems,
    timelineType,
    gameExecutablePath,
    launchThroughSteam,
    themeId,
    compactThemeId,
    themeCustomMode,
    compactThemeCustomMode,
    compactThemeMatchesApp,
    themeAccents,
    themeTextures,
    compactThemeTextures,
    themeForegroundFills,
    compactThemeForegroundFills,
    themeTokenMaps,
    itemFilterGroups,
    itemFilterMuted,
    customItemFilterSounds,
    postRunReport,
    compactRunTiles,
    hiddenDashboardPanels,
    itemResearchEntries,
    preferenceWatchSources,
    currentPreferences,
    applyPreferences,
    updatePostRunReportConfig,
  };
}
