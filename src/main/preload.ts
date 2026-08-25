import { contextBridge, ipcRenderer } from "electron";
import type { CompanionState } from "../shared/app-state";
import { IpcChannel, type HeroSiegeCompanionApi } from "../shared/ipc";

const api: HeroSiegeCompanionApi = {
  getState: () => ipcRenderer.invoke(IpcChannel.stateGet),
  startCapture: () => ipcRenderer.invoke(IpcChannel.captureStart),
  launchGameOrCapture: (options) => ipcRenderer.invoke(IpcChannel.gameLaunchOrCapture, options),
  stopCapture: () => ipcRenderer.invoke(IpcChannel.captureStop),
  chooseGameExecutable: () => ipcRenderer.invoke(IpcChannel.gameChooseExecutable),
  resetStats: () => ipcRenderer.invoke(IpcChannel.statsReset),
  refreshSatanicZone: () => ipcRenderer.invoke(IpcChannel.satanicZoneRefresh),
  pauseRun: () => ipcRenderer.invoke(IpcChannel.runPause),
  resumeRun: () => ipcRenderer.invoke(IpcChannel.runResume),
  setPastRunTags: (runId: string, tags: string[]): Promise<CompanionState> =>
    ipcRenderer.invoke(IpcChannel.pastRunsSetTags, runId, tags),
  deletePastRun: (runId: string): Promise<CompanionState> =>
    ipcRenderer.invoke(IpcChannel.pastRunsDelete, runId),
  deleteAllPastRuns: (): Promise<CompanionState> =>
    ipcRenderer.invoke(IpcChannel.pastRunsDeleteAll),
  setRunArchivePreferences: (preferences) => ipcRenderer.invoke(IpcChannel.preferencesSetRunArchive, preferences),
  setCapturePreferences: (preferences) => ipcRenderer.invoke(IpcChannel.preferencesSetCapture, preferences),
  setSatanicZoneRefreshEnabled: (enabled) => ipcRenderer.invoke(IpcChannel.preferencesSetSatanicZoneRefresh, enabled),
  exportConfiguration: (json, options) => ipcRenderer.invoke(IpcChannel.configurationExport, json, options),
  importConfiguration: (installEmbeddedSounds) => ipcRenderer.invoke(IpcChannel.configurationImport, installEmbeddedSounds === true),
  exportItemResearch: (json) => ipcRenderer.invoke(IpcChannel.itemResearchExport, json),
  importSounds: () => ipcRenderer.invoke(IpcChannel.soundsImport),
  exportSoundPack: (sounds) => ipcRenderer.invoke(IpcChannel.soundsExport, sounds),
  removeSound: (src) => ipcRenderer.invoke(IpcChannel.soundsRemove, src),
  exportPastRunsJson: (json) => ipcRenderer.invoke(IpcChannel.pastRunsExportJson, json),
  exportPastRunsCsv: (csv) => ipcRenderer.invoke(IpcChannel.pastRunsExportCsv, csv),
  minimizeWindow: () => ipcRenderer.invoke(IpcChannel.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IpcChannel.windowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IpcChannel.windowClose),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke(IpcChannel.windowSetAlwaysOnTop, enabled),
  setCompactMode: (enabled, lockPositions) => ipcRenderer.invoke(IpcChannel.windowSetCompactMode, enabled, lockPositions),
  writeClipboardText: (value) => ipcRenderer.invoke(IpcChannel.clipboardWriteText, value),
  getSupportDiagnosticsInfo: () => ipcRenderer.invoke(IpcChannel.supportGetDiagnosticsInfo),
  openSupportLogsDirectory: () => ipcRenderer.invoke(IpcChannel.supportOpenLogsDirectory),
  saveSupportDiagnostics: (diagnosticsSummary) => ipcRenderer.invoke(IpcChannel.supportSaveDiagnostics, diagnosticsSummary),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannel.updatesCheck),
  openRelease: (url) => ipcRenderer.invoke(IpcChannel.updatesOpenRelease, url),
  openNpcapGuide: () => ipcRenderer.invoke(IpcChannel.docsOpenNpcapGuide),
  onStateUpdated: (callback: (state: CompanionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CompanionState) => callback(state);
    ipcRenderer.on(IpcChannel.stateUpdated, listener);
    return () => ipcRenderer.removeListener(IpcChannel.stateUpdated, listener);
  },
};

contextBridge.exposeInMainWorld("heroSiegeCompanion", api);
