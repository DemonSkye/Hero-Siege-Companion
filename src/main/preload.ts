import { contextBridge, ipcRenderer } from "electron";
import type { CompanionState, RunArchivePreferences } from "../shared/app-state";

contextBridge.exposeInMainWorld("heroSiegeCompanion", {
  getState: (): Promise<CompanionState> => ipcRenderer.invoke("state:get"),
  startCapture: (): Promise<CompanionState> => ipcRenderer.invoke("capture:start"),
  stopCapture: (): Promise<CompanionState> => ipcRenderer.invoke("capture:stop"),
  resetStats: (): Promise<CompanionState> => ipcRenderer.invoke("stats:reset"),
  setRunArchivePreferences: (preferences: RunArchivePreferences): Promise<CompanionState> =>
    ipcRenderer.invoke("preferences:set-run-archive", preferences),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  setAlwaysOnTop: (enabled: boolean): Promise<void> => ipcRenderer.invoke("window:set-always-on-top", enabled),
  setCompactMode: (enabled: boolean): Promise<void> => ipcRenderer.invoke("window:set-compact-mode", enabled),
  onStateUpdated: (callback: (state: CompanionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CompanionState) => callback(state);
    ipcRenderer.on("state:updated", listener);
    return () => ipcRenderer.removeListener("state:updated", listener);
  },
});
