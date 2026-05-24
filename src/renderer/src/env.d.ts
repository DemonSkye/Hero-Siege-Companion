import type { CapturePreferences, CompanionState, ReleaseUpdateInfo, RunArchivePreferences } from "../../shared/app-state";

declare global {
  interface Window {
    heroSiegeCompanion: {
      getState: () => Promise<CompanionState>;
      startCapture: () => Promise<CompanionState>;
      launchGameOrCapture: (options: { executablePath?: string; launchThroughSteam?: boolean }) => Promise<CompanionState>;
      stopCapture: () => Promise<CompanionState>;
      chooseGameExecutable: () => Promise<string | null>;
      resetStats: () => Promise<CompanionState>;
      pauseRun: () => Promise<CompanionState>;
      resumeRun: () => Promise<CompanionState>;
      setRunArchivePreferences: (preferences: RunArchivePreferences) => Promise<CompanionState>;
      setCapturePreferences: (preferences: CapturePreferences) => Promise<CompanionState>;
      exportConfiguration: (json: string) => Promise<boolean>;
      importConfiguration: () => Promise<string | null>;
      exportItemResearch: (json: string) => Promise<boolean>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      setAlwaysOnTop: (enabled: boolean) => Promise<void>;
      setCompactMode: (enabled: boolean, lockPositions: boolean) => Promise<void>;
      writeClipboardText: (value: string) => Promise<void>;
      checkForUpdate: () => Promise<ReleaseUpdateInfo | null>;
      openRelease: (url?: string) => Promise<void>;
      onStateUpdated: (callback: (state: CompanionState) => void) => () => void;
    };
  }
}

export {};
