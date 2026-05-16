import type { CompanionState } from "../../shared/app-state";

declare global {
  interface Window {
    heroSiegeCompanion: {
      getState: () => Promise<CompanionState>;
      startCapture: () => Promise<CompanionState>;
      stopCapture: () => Promise<CompanionState>;
      resetStats: () => Promise<CompanionState>;
      onStateUpdated: (callback: (state: CompanionState) => void) => () => void;
    };
  }
}

export {};
