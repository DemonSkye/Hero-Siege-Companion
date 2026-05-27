import type { App } from "electron";
import fs from "node:fs";
import type { CompanionState } from "../shared/app-state";
import type { ParsedEvent } from "../shared/parser";

const E2E_ENV_FLAG = "HERO_SIEGE_COMPANION_E2E";
const E2E_USER_DATA_ENV = "HERO_SIEGE_COMPANION_E2E_USER_DATA";

export interface ElectronE2eWindowState {
  compactMode: boolean;
  bounds: Electron.Rectangle | null;
  alwaysOnTop: boolean;
}

export interface ElectronE2eMainHooks {
  emitCaptureEvents: (events: ParsedEvent[]) => void;
  emitCapturePayloads: (payloads: string[]) => void;
  getState: () => CompanionState;
  getWindowState: () => ElectronE2eWindowState;
}

declare global {
  var heroSiegeCompanionE2e: ElectronE2eMainHooks | undefined;
}

export function isElectronE2eTestMode(): boolean {
  return process.env[E2E_ENV_FLAG] === "1";
}

export function configureElectronE2eApp(app: App): void {
  if (!isElectronE2eTestMode()) return;

  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("no-sandbox");

  const userDataPath = process.env[E2E_USER_DATA_ENV]?.trim();
  if (userDataPath) {
    fs.mkdirSync(userDataPath, { recursive: true });
    app.setPath("userData", userDataPath);
  }
}

export function installElectronE2eMainHooks(hooks: ElectronE2eMainHooks): void {
  if (!isElectronE2eTestMode()) return;
  globalThis.heroSiegeCompanionE2e = hooks;
}
