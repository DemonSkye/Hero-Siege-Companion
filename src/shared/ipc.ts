import type { CapturePreferences, CompanionState, ReleaseUpdateInfo, RunArchivePreferences } from "./app-state";
import type { SupportDiagnosticsInfo, SupportDiagnosticsSaveResult } from "./support-diagnostics";

export const enum IpcChannel {
  stateGet = "state:get",
  stateUpdated = "state:updated",
  captureStart = "capture:start",
  captureStop = "capture:stop",
  gameLaunchOrCapture = "game:launch-or-capture",
  gameChooseExecutable = "game:choose-executable",
  statsReset = "stats:reset",
  satanicZoneRefresh = "satanic-zone:refresh",
  runPause = "run:pause",
  runResume = "run:resume",
  pastRunsSetTags = "past-runs:set-tags",
  pastRunsDelete = "past-runs:delete",
  pastRunsDeleteAll = "past-runs:delete-all",
  preferencesSetRunArchive = "preferences:set-run-archive",
  preferencesSetCapture = "preferences:set-capture",
  preferencesSetSatanicZoneRefresh = "preferences:set-satanic-zone-refresh",
  configurationExport = "configuration:export",
  configurationImport = "configuration:import",
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
  clipboardWriteText = "clipboard:write-text",
  supportGetDiagnosticsInfo = "support:get-diagnostics-info",
  supportOpenLogsDirectory = "support:open-logs-directory",
  supportSaveDiagnostics = "support:save-diagnostics",
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
  runPause: IpcChannel.runPause,
  runResume: IpcChannel.runResume,
  pastRunsSetTags: IpcChannel.pastRunsSetTags,
  pastRunsDelete: IpcChannel.pastRunsDelete,
  pastRunsDeleteAll: IpcChannel.pastRunsDeleteAll,
  preferencesSetRunArchive: IpcChannel.preferencesSetRunArchive,
  preferencesSetCapture: IpcChannel.preferencesSetCapture,
  preferencesSetSatanicZoneRefresh: IpcChannel.preferencesSetSatanicZoneRefresh,
  configurationExport: IpcChannel.configurationExport,
  configurationImport: IpcChannel.configurationImport,
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
  clipboardWriteText: IpcChannel.clipboardWriteText,
  supportGetDiagnosticsInfo: IpcChannel.supportGetDiagnosticsInfo,
  supportOpenLogsDirectory: IpcChannel.supportOpenLogsDirectory,
  supportSaveDiagnostics: IpcChannel.supportSaveDiagnostics,
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
  pauseRun: () => Promise<CompanionState>;
  resumeRun: () => Promise<CompanionState>;
  setPastRunTags: (runId: string, tags: string[]) => Promise<CompanionState>;
  deletePastRun: (runId: string) => Promise<CompanionState>;
  deleteAllPastRuns: () => Promise<CompanionState>;
  setRunArchivePreferences: (preferences: RunArchivePreferences) => Promise<CompanionState>;
  setCapturePreferences: (preferences: CapturePreferences) => Promise<CompanionState>;
  setSatanicZoneRefreshEnabled: (enabled: boolean) => Promise<CompanionState>;
  exportConfiguration: (json: string, options?: ConfigurationExportOptions) => Promise<boolean>;
  importConfiguration: (installEmbeddedSounds?: boolean) => Promise<string | null>;
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
  setCompactMode: (enabled: boolean, lockPositions: boolean) => Promise<void>;
  writeClipboardText: (value: string) => Promise<void>;
  getSupportDiagnosticsInfo: () => Promise<SupportDiagnosticsInfo>;
  openSupportLogsDirectory: () => Promise<boolean>;
  saveSupportDiagnostics: (diagnosticsSummary: string) => Promise<SupportDiagnosticsSaveResult>;
  checkForUpdate: () => Promise<ReleaseUpdateInfo | null>;
  openRelease: (url?: string) => Promise<void>;
  openNpcapGuide: () => Promise<void>;
  onStateUpdated: (callback: (state: CompanionState) => void) => () => void;
}
