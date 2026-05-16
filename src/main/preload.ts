import { contextBridge, ipcRenderer } from "electron";
import type { CompanionState } from "../shared/app-state";

contextBridge.exposeInMainWorld("heroSiegeCompanion", {
  getState: (): Promise<CompanionState> => ipcRenderer.invoke("state:get"),
  startCapture: (): Promise<CompanionState> => ipcRenderer.invoke("capture:start"),
  stopCapture: (): Promise<CompanionState> => ipcRenderer.invoke("capture:stop"),
  resetStats: (): Promise<CompanionState> => ipcRenderer.invoke("stats:reset"),
  onStateUpdated: (callback: (state: CompanionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CompanionState) => callback(state);
    ipcRenderer.on("state:updated", listener);
    return () => ipcRenderer.removeListener("state:updated", listener);
  },
});
