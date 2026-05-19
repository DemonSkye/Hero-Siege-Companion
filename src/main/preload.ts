import { contextBridge, ipcRenderer } from "electron";
import type { CompanionState, RunArchivePreferences } from "../shared/app-state";

contextBridge.exposeInMainWorld("heroSiegeCompanion", {
  getState: (): Promise<CompanionState> => ipcRenderer.invoke("state:get"),
  startCapture: (): Promise<CompanionState> => ipcRenderer.invoke("capture:start"),
  launchGameOrCapture: (options: { executablePath?: string; launchThroughSteam?: boolean }): Promise<CompanionState> =>
    ipcRenderer.invoke("game:launch-or-capture", options),
  stopCapture: (): Promise<CompanionState> => ipcRenderer.invoke("capture:stop"),
  chooseGameExecutable: (): Promise<string | null> => ipcRenderer.invoke("game:choose-executable"),
  resetStats: (): Promise<CompanionState> => ipcRenderer.invoke("stats:reset"),
  setRunArchivePreferences: (preferences: RunArchivePreferences): Promise<CompanionState> =>
    ipcRenderer.invoke("preferences:set-run-archive", preferences),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  setAlwaysOnTop: (enabled: boolean): Promise<void> => ipcRenderer.invoke("window:set-always-on-top", enabled),
  setCompactMode: (enabled: boolean, lockPositions: boolean): Promise<void> => ipcRenderer.invoke("window:set-compact-mode", enabled, lockPositions),
  writeClipboardText: (value: string): Promise<void> => ipcRenderer.invoke("clipboard:write-text", value),
  onStateUpdated: (callback: (state: CompanionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CompanionState) => callback(state);
    ipcRenderer.on("state:updated", listener);
    return () => ipcRenderer.removeListener("state:updated", listener);
  },
});
