import type { CompanionState, RunArchivePreferences } from "../../shared/app-state";

declare global {
  interface Window {
    heroSiegeCompanion: {
      getState: () => Promise<CompanionState>;
      startCapture: () => Promise<CompanionState>;
      stopCapture: () => Promise<CompanionState>;
      resetStats: () => Promise<CompanionState>;
      setRunArchivePreferences: (preferences: RunArchivePreferences) => Promise<CompanionState>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      setAlwaysOnTop: (enabled: boolean) => Promise<void>;
      setCompactMode: (enabled: boolean) => Promise<void>;
      onStateUpdated: (callback: (state: CompanionState) => void) => () => void;
    };
  }
}

export {};
