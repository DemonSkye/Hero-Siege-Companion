import type { CapturePreferences, CompanionState, ReleaseUpdateInfo, RunArchivePreferences } from "./app-state";
import type { SupportDiagnosticsInfo, SupportDiagnosticsSaveResult } from "./support-diagnostics";

export const IPC_CHANNELS = {
  stateGet: "state:get",
  stateUpdated: "state:updated",
  captureStart: "capture:start",
  captureStop: "capture:stop",
  gameLaunchOrCapture: "game:launch-or-capture",
  gameChooseExecutable: "game:choose-executable",
  statsReset: "stats:reset",
  runPause: "run:pause",
  runResume: "run:resume",
  pastRunsSetTags: "past-runs:set-tags",
  preferencesSetRunArchive: "preferences:set-run-archive",
  preferencesSetCapture: "preferences:set-capture",
  configurationExport: "configuration:export",
  configurationImport: "configuration:import",
  itemResearchExport: "item-research:export",
  soundsImport: "sounds:import",
  soundsExport: "sounds:export",
  soundsRemove: "sounds:remove",
  pastRunsExportJson: "past-runs:export-json",
  pastRunsExportCsv: "past-runs:export-csv",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowSetAlwaysOnTop: "window:set-always-on-top",
  windowSetCompactMode: "window:set-compact-mode",
  clipboardWriteText: "clipboard:write-text",
  supportGetDiagnosticsInfo: "support:get-diagnostics-info",
  supportSaveDiagnostics: "support:save-diagnostics",
  updatesCheck: "updates:check",
  updatesOpenRelease: "updates:open-release",
  docsOpenNpcapGuide: "docs:open-npcap-guide",
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
  pauseRun: () => Promise<CompanionState>;
  resumeRun: () => Promise<CompanionState>;
  setPastRunTags: (runId: string, tags: string[]) => Promise<CompanionState>;
  setRunArchivePreferences: (preferences: RunArchivePreferences) => Promise<CompanionState>;
  setCapturePreferences: (preferences: CapturePreferences) => Promise<CompanionState>;
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
  saveSupportDiagnostics: (diagnosticsSummary: string) => Promise<SupportDiagnosticsSaveResult>;
  checkForUpdate: () => Promise<ReleaseUpdateInfo | null>;
  openRelease: (url?: string) => Promise<void>;
  openNpcapGuide: () => Promise<void>;
  onStateUpdated: (callback: (state: CompanionState) => void) => () => void;
}
