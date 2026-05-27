import { contextBridge, ipcRenderer } from "electron";
import type { CompanionState } from "../shared/app-state";
import { IPC_CHANNELS, type HeroSiegeCompanionApi } from "../shared/ipc";

const api: HeroSiegeCompanionApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.stateGet),
  startCapture: () => ipcRenderer.invoke(IPC_CHANNELS.captureStart),
  launchGameOrCapture: (options) => ipcRenderer.invoke(IPC_CHANNELS.gameLaunchOrCapture, options),
  stopCapture: () => ipcRenderer.invoke(IPC_CHANNELS.captureStop),
  chooseGameExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.gameChooseExecutable),
  resetStats: () => ipcRenderer.invoke(IPC_CHANNELS.statsReset),
  pauseRun: () => ipcRenderer.invoke(IPC_CHANNELS.runPause),
  resumeRun: () => ipcRenderer.invoke(IPC_CHANNELS.runResume),
  setPastRunTags: (runId: string, tags: string[]): Promise<CompanionState> =>
    ipcRenderer.invoke(IPC_CHANNELS.pastRunsSetTags, runId, tags),
  setRunArchivePreferences: (preferences) => ipcRenderer.invoke(IPC_CHANNELS.preferencesSetRunArchive, preferences),
  setCapturePreferences: (preferences) => ipcRenderer.invoke(IPC_CHANNELS.preferencesSetCapture, preferences),
  exportConfiguration: (json) => ipcRenderer.invoke(IPC_CHANNELS.configurationExport, json),
  importConfiguration: () => ipcRenderer.invoke(IPC_CHANNELS.configurationImport),
  exportItemResearch: (json) => ipcRenderer.invoke(IPC_CHANNELS.itemResearchExport, json),
  importSounds: () => ipcRenderer.invoke(IPC_CHANNELS.soundsImport),
  exportSoundPack: (sounds) => ipcRenderer.invoke(IPC_CHANNELS.soundsExport, sounds),
  removeSound: (src) => ipcRenderer.invoke(IPC_CHANNELS.soundsRemove, src),
  exportPastRunsJson: (json) => ipcRenderer.invoke(IPC_CHANNELS.pastRunsExportJson, json),
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.windowSetAlwaysOnTop, enabled),
  setCompactMode: (enabled, lockPositions) => ipcRenderer.invoke(IPC_CHANNELS.windowSetCompactMode, enabled, lockPositions),
  writeClipboardText: (value) => ipcRenderer.invoke(IPC_CHANNELS.clipboardWriteText, value),
  getSupportDiagnosticsInfo: () => ipcRenderer.invoke(IPC_CHANNELS.supportGetDiagnosticsInfo),
  saveSupportDiagnostics: (diagnosticsSummary) => ipcRenderer.invoke(IPC_CHANNELS.supportSaveDiagnostics, diagnosticsSummary),
  checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updatesCheck),
  openRelease: (url) => ipcRenderer.invoke(IPC_CHANNELS.updatesOpenRelease, url),
  openNpcapGuide: () => ipcRenderer.invoke(IPC_CHANNELS.docsOpenNpcapGuide),
  onStateUpdated: (callback: (state: CompanionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CompanionState) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.stateUpdated, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.stateUpdated, listener);
  },
};

contextBridge.exposeInMainWorld("heroSiegeCompanion", api);
