import type {
  CaptureDiagnosticsLevel,
  CaptureDiagnosticsMode,
  CompanionState,
  CompanionStateUpdate,
  ReleaseUpdateInfo,
} from "./app-state";
import type { SupportDiagnosticsInfo, SupportDiagnosticsSaveResult } from "./support-diagnostics";
import type { MarketSearchRequest, MarketSearchResponse } from "./market-search";
import type { MarketPrivateDiagnosticState } from "./market-private-diagnostic";

export const enum IpcChannel {
  stateGet = "state:get",
  stateUpdated = "state:updated",
  captureStart = "capture:start",
  captureStop = "capture:stop",
  gameLaunchOrCapture = "game:launch-or-capture",
  gameChooseExecutable = "game:choose-executable",
  statsReset = "stats:reset",
  satanicZoneRefresh = "satanic-zone:refresh",
  satanicZoneLoginCacheSet = "satanic-zone-login-cache:set",
  satanicZoneLoginCacheClear = "satanic-zone-login-cache:clear",
  satanicZoneLoginCacheUnlock = "satanic-zone-login-cache:unlock",
  satanicZoneLoginCacheAutomatic = "satanic-zone-login-cache:automatic",
  satanicZoneLoginCacheLock = "satanic-zone-login-cache:lock",
  marketSearch = "market:search",
  marketPrivateDiagnosticGet = "market-private-diagnostic:get",
  marketPrivateDiagnosticSet = "market-private-diagnostic:set",
  marketPrivateDiagnosticOpen = "market-private-diagnostic:open",
  marketPrivateDiagnosticUpdated = "market-private-diagnostic:updated",
  runPause = "run:pause",
  runResume = "run:resume",
  pastRunsSetTags = "past-runs:set-tags",
  pastRunsDelete = "past-runs:delete",
  pastRunsDeleteAll = "past-runs:delete-all",
  preferencesSetSatanicZoneRefresh = "preferences:set-satanic-zone-refresh",
  configurationExport = "configuration:export",
  configurationImport = "configuration:import",
  configurationInstallSounds = "configuration:install-sounds",
  itemResearchExport = "item-research:export",
  soundsImport = "sounds:import",
  soundsExport = "sounds:export",
  soundsRemove = "sounds:remove",
  pastRunsExportJson = "past-runs:export-json",
  pastRunsExportCsv = "past-runs:export-csv",
  windowMinimize = "window:minimize",
  windowToggleMaximize = "window:toggle-maximize",
  windowClose = "window:close",
  windowSetAlwaysOnTop = "window:set-always-on-top",
  windowSetCompactMode = "window:set-compact-mode",
  windowResetBounds = "window:reset-bounds",
  clipboardWriteText = "clipboard:write-text",
  supportGetDiagnosticsInfo = "support:get-diagnostics-info",
  supportOpenLogsDirectory = "support:open-logs-directory",
  supportSaveDiagnostics = "support:save-diagnostics",
  supportSetDiagnosticsMode = "support:set-diagnostics-mode",
  satanicZoneDiagnosticArm = "satanic-zone-diagnostic:arm",
  satanicZoneDiagnosticStart = "satanic-zone-diagnostic:start",
  satanicZoneDiagnosticCancel = "satanic-zone-diagnostic:cancel",
  updatesCheck = "updates:check",
  updatesOpenRelease = "updates:open-release",
  docsOpenNpcapGuide = "docs:open-npcap-guide",
}

export const IPC_CHANNELS = {
  stateGet: IpcChannel.stateGet,
  stateUpdated: IpcChannel.stateUpdated,
  captureStart: IpcChannel.captureStart,
  captureStop: IpcChannel.captureStop,
  gameLaunchOrCapture: IpcChannel.gameLaunchOrCapture,
  gameChooseExecutable: IpcChannel.gameChooseExecutable,
  statsReset: IpcChannel.statsReset,
  satanicZoneRefresh: IpcChannel.satanicZoneRefresh,
  satanicZoneLoginCacheSet: IpcChannel.satanicZoneLoginCacheSet,
  satanicZoneLoginCacheClear: IpcChannel.satanicZoneLoginCacheClear,
  satanicZoneLoginCacheUnlock: IpcChannel.satanicZoneLoginCacheUnlock,
  satanicZoneLoginCacheAutomatic: IpcChannel.satanicZoneLoginCacheAutomatic,
  satanicZoneLoginCacheLock: IpcChannel.satanicZoneLoginCacheLock,
  marketSearch: IpcChannel.marketSearch,
  marketPrivateDiagnosticGet: IpcChannel.marketPrivateDiagnosticGet,
  marketPrivateDiagnosticSet: IpcChannel.marketPrivateDiagnosticSet,
  marketPrivateDiagnosticOpen: IpcChannel.marketPrivateDiagnosticOpen,
  marketPrivateDiagnosticUpdated: IpcChannel.marketPrivateDiagnosticUpdated,
  runPause: IpcChannel.runPause,
  runResume: IpcChannel.runResume,
  pastRunsSetTags: IpcChannel.pastRunsSetTags,
  pastRunsDelete: IpcChannel.pastRunsDelete,
  pastRunsDeleteAll: IpcChannel.pastRunsDeleteAll,
  preferencesSetSatanicZoneRefresh: IpcChannel.preferencesSetSatanicZoneRefresh,
  configurationExport: IpcChannel.configurationExport,
  configurationImport: IpcChannel.configurationImport,
  configurationInstallSounds: IpcChannel.configurationInstallSounds,
  itemResearchExport: IpcChannel.itemResearchExport,
  soundsImport: IpcChannel.soundsImport,
  soundsExport: IpcChannel.soundsExport,
  soundsRemove: IpcChannel.soundsRemove,
  pastRunsExportJson: IpcChannel.pastRunsExportJson,
  pastRunsExportCsv: IpcChannel.pastRunsExportCsv,
  windowMinimize: IpcChannel.windowMinimize,
  windowToggleMaximize: IpcChannel.windowToggleMaximize,
  windowClose: IpcChannel.windowClose,
  windowSetAlwaysOnTop: IpcChannel.windowSetAlwaysOnTop,
  windowSetCompactMode: IpcChannel.windowSetCompactMode,
  windowResetBounds: IpcChannel.windowResetBounds,
  clipboardWriteText: IpcChannel.clipboardWriteText,
  supportGetDiagnosticsInfo: IpcChannel.supportGetDiagnosticsInfo,
  supportOpenLogsDirectory: IpcChannel.supportOpenLogsDirectory,
  supportSaveDiagnostics: IpcChannel.supportSaveDiagnostics,
  supportSetDiagnosticsMode: IpcChannel.supportSetDiagnosticsMode,
  satanicZoneDiagnosticArm: IpcChannel.satanicZoneDiagnosticArm,
  satanicZoneDiagnosticStart: IpcChannel.satanicZoneDiagnosticStart,
  satanicZoneDiagnosticCancel: IpcChannel.satanicZoneDiagnosticCancel,
  updatesCheck: IpcChannel.updatesCheck,
  updatesOpenRelease: IpcChannel.updatesOpenRelease,
  docsOpenNpcapGuide: IpcChannel.docsOpenNpcapGuide,
} as const;

export interface LaunchGameOptions {
  executablePath?: string;
  launchThroughSteam?: boolean;
}

export interface ImportedSoundReference {
  fileName: string;
  mimeType: string;
  src: string;
}

export interface ExportableSoundReference {
  fileName: string;
  name: string;
  src: string;
}

export interface SoundPackExportResult {
  exported: boolean;
  canceled: boolean;
  filePath: string | null;
  includedFiles: string[];
}

export interface ConfigurationExportOptions {
  title?: string;
  defaultPath?: string;
}

export interface HeroSiegeCompanionApi {
  getState: () => Promise<CompanionState>;
  startCapture: () => Promise<CompanionState>;
  launchGameOrCapture: (options: LaunchGameOptions) => Promise<CompanionState>;
  stopCapture: () => Promise<CompanionState>;
  chooseGameExecutable: () => Promise<string | null>;
  resetStats: () => Promise<CompanionState>;
  refreshSatanicZone: () => Promise<CompanionState>;
  setSatanicZoneLoginCacheEnabled: (enabled: boolean) => Promise<CompanionState>;
  clearSatanicZoneLoginCache: () => Promise<CompanionState>;
  unlockSatanicZoneLoginCache: (passphrase: string) => Promise<CompanionState>;
  enableSatanicZoneLoginCacheAutomatic: (passphrase: string) => Promise<CompanionState>;
  lockSatanicZoneLoginCache: () => Promise<CompanionState>;
  armSatanicZoneDiagnostic: () => Promise<import("./satanic-zone-diagnostic").SatanicZoneDiagnosticState>;
  startSatanicZoneDiagnostic: () => Promise<import("./satanic-zone-diagnostic").SatanicZoneDiagnosticState>;
  cancelSatanicZoneDiagnostic: () => Promise<import("./satanic-zone-diagnostic").SatanicZoneDiagnosticState>;
  searchMarket: (request: MarketSearchRequest) => Promise<MarketSearchResponse>;
  getMarketPrivateDiagnosticState: () => Promise<MarketPrivateDiagnosticState>;
  setMarketPrivateDiagnosticEnabled: (enabled: boolean) => Promise<MarketPrivateDiagnosticState>;
  openMarketPrivateDiagnosticDirectory: () => Promise<boolean>;
  onMarketPrivateDiagnosticUpdated: (callback: (state: MarketPrivateDiagnosticState) => void) => () => void;
  pauseRun: () => Promise<CompanionState>;
  resumeRun: () => Promise<CompanionState>;
  setPastRunTags: (runId: string, tags: string[]) => Promise<CompanionState>;
  deletePastRun: (runId: string) => Promise<CompanionState>;
  deleteAllPastRuns: () => Promise<CompanionState>;
  setSatanicZoneRefreshEnabled: (enabled: boolean) => Promise<CompanionState>;
  exportConfiguration: (json: string, options?: ConfigurationExportOptions) => Promise<boolean>;
  importConfiguration: (legacyInstallEmbeddedSounds?: boolean) => Promise<string | null>;
  installConfigurationSounds: (json: string) => Promise<string>;
  exportItemResearch: (json: string) => Promise<boolean>;
  importSounds: () => Promise<ImportedSoundReference[]>;
  exportSoundPack: (sounds: ExportableSoundReference[]) => Promise<SoundPackExportResult>;
  removeSound: (src: string) => Promise<boolean>;
  exportPastRunsJson: (json: string) => Promise<boolean>;
  exportPastRunsCsv: (csv: string) => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;
  setCompactMode: (enabled: boolean, legacyLockPositions?: boolean) => Promise<void>;
  resetWindowBounds: () => Promise<void>;
  writeClipboardText: (value: string) => Promise<void>;
  getSupportDiagnosticsInfo: () => Promise<SupportDiagnosticsInfo>;
  openSupportLogsDirectory: () => Promise<boolean>;
  saveSupportDiagnostics: (diagnosticsSummary: string) => Promise<SupportDiagnosticsSaveResult>;
  setCaptureDiagnosticsMode: (
    level: CaptureDiagnosticsLevel,
    mode: CaptureDiagnosticsMode,
  ) => Promise<CompanionState>;
  checkForUpdate: () => Promise<ReleaseUpdateInfo | null>;
  openRelease: (url?: string) => Promise<void>;
  openNpcapGuide: () => Promise<void>;
  onStateUpdated: (callback: (state: CompanionStateUpdate) => void) => () => void;
}
