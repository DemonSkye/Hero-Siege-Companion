import { app, clipboard, crashReporter, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createAppDiagnostics, type AppDiagnostics } from "./app-diagnostics";
import {
  createCaptureRuntime,
  emitElectronE2eCaptureEvents,
  emitElectronE2eCapturePayloads,
  type CaptureRuntime,
  type CaptureUpdate,
} from "./capture-runtime";
import { configureElectronE2eApp, installElectronE2eMainHooks, isElectronE2eTestMode } from "./electron-test-mode";
import { showOpenDialogWithParent } from "./electron-dialogs";
import { GameCaptureCoordinator } from "./game-capture-coordinator";
import { readJsonFileWithDialog, saveJsonFileWithDialog } from "./json-file-dialogs";
import {
  MAX_PAST_RUNS,
  loadCapturePreferences,
  loadPastRuns,
  loadRunArchivePreferences,
  loadWindowBounds,
  normalizeCapturePreferences,
  normalizeRunArchivePreferences,
  saveCapturePreferences,
  savePastRuns,
  saveRunArchivePreferences,
  type WindowBoundsPreferences,
} from "./persistence";
import { checkForReleaseUpdate } from "./release-updates";
import {
  embedConfigurationSoundData,
  exportLootSoundPackWithDialog,
  importLootSounds,
  installEmbeddedConfigurationSounds,
  removeImportedLootSound,
} from "./sound-import";
import { getSupportDiagnosticsInfo, saveSupportDiagnosticsBundle } from "./support-diagnostics";
import { MainWindowManager } from "./window-manager";
import type { CapturePreferences, CompanionState, LogEntry, RunArchivePreferences, RunPausedReason } from "../shared/app-state";
import { IPC_CHANNELS } from "../shared/ipc";
import { createInitialCompanionState } from "../shared/initial-state";
import { hasRunActivity, normalizePastRunTags, StatsEngine, type PastRunSummary } from "../shared/stats";
import type { SupportDiagnosticsSaveResult } from "../shared/support-diagnostics";

const statsEngine = new StatsEngine();
const logs: LogEntry[] = [];
const STATE_PUBLISH_INTERVAL_MS = 1000;
const GITHUB_RELEASES_URL = "https://github.com/DemonSkye/Hero-Siege-Companion/releases";
const GITHUB_NPCAP_GUIDE_URL = "https://github.com/DemonSkye/Hero-Siege-Companion#required-install-npcap";
const MAX_CONFIGURATION_IMPORT_BYTES = 128 * 1024 * 1024;

const state: CompanionState = createInitialCompanionState(logs);

const pendingCaptureEvents: NonNullable<CaptureUpdate["events"]> = [];
let windowManager: MainWindowManager | null = null;
let captureService: CaptureRuntime | null = null;
let appLogPath = "";
let pastRunsPath = "";
let preferencesPath = "";
let windowBoundsPath = "";
let appSessionPath = "";
let forceExitTimer: NodeJS.Timeout | null = null;
let windowBounds: WindowBoundsPreferences = {};
let statePublishTimer: NodeJS.Timeout | null = null;
let lastPendingCaptureEventsLogAt = 0;
let appDiagnostics: AppDiagnostics | null = null;
const archivedSessionStarts = new Set<number>();
const gameCaptureCoordinator = new GameCaptureCoordinator({
  state,
  getCaptureService: () => captureService,
  addLog,
  publishState,
  writeAppLog,
});

if (process.platform === "win32") app.setAppUserModelId("com.herosiege.companion");
configureElectronE2eApp(app);

try {
  crashReporter.start({ uploadToServer: false });
} catch (error) {
  console.error("Failed to start crash reporter", error);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
  windowManager?.focusExistingWindow();
});

process.on("uncaughtException", (error) => {
  writeAppLog("uncaughtException", { message: error.message, stack: error.stack });
  addLog("error", `Uncaught exception: ${error.message}`);
  console.error(error.stack);
});

process.on("unhandledRejection", (reason) => {
  writeAppLog("unhandledRejection", { reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason) });
  addLog("error", `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  console.error(reason);
});

process.on("warning", (warning) => {
  writeAppLog("process-warning", { name: warning.name, message: warning.message, stack: warning.stack });
});

process.on("beforeExit", (code) => {
  writeAppLog("process-before-exit", { code });
});

process.on("exit", (code) => {
  writeAppLog("process-exit", { code });
  stopAppSessionHeartbeat();
  stopAppDiagnosticHeartbeat();
  markAppSessionClosed("process-exit");
  shutdownCapture("process-exit");
});

function createWindow(): void {
  windowManager = new MainWindowManager({
    preloadPath: path.join(__dirname, "preload.js"),
    rendererIndexPath: path.join(__dirname, "..", "..", "renderer", "index.html"),
    iconPath: resolveIconPath(),
    windowBoundsPath,
    windowBounds,
    writeAppLog,
    addLog,
    publishStateNow,
    getCaptureSnapshot: () => ({ captureStatus: state.captureStatus, captureRunning: state.captureRunning }),
  });
  windowManager.create();
}

function currentWindow() {
  return windowManager?.window ?? null;
}

function resolveIconPath(): string {
  const resourceIconPath = path.join(process.resourcesPath, "icon.ico");
  if (app.isPackaged && fs.existsSync(resourceIconPath)) return resourceIconPath;
  return path.join(app.getAppPath(), "icon.ico");
}

function applyCaptureUpdate(update: CaptureUpdate): void {
  const previousCaptureStatus = state.captureStatus;
  const previousCaptureRunning = state.captureRunning;
  if (update.running !== undefined) state.captureRunning = update.running;
  if (update.status) state.captureStatus = update.status;
  if (update.error !== undefined) state.captureError = update.error;
  if (update.connections) state.connections = update.connections;
  if (update.health) state.health = { ...state.health, ...update.health };

  if (update.status && update.status !== previousCaptureStatus) {
    writeAppLog("capture-status-changed", {
      previousStatus: previousCaptureStatus,
      nextStatus: update.status,
      captureRunning: state.captureRunning,
      captureError: state.captureError,
    });
  }

  if (update.events?.length) {
    pendingCaptureEvents.push(...update.events);
    maybeLogPendingCaptureBacklog(update.events.length);
  }

  if (previousCaptureRunning && !state.captureRunning) {
    applyPendingCaptureEvents();
    pauseRun("captureStopped");
  } else if (!previousCaptureRunning && state.captureRunning && state.runStatus === "paused" && state.runPausedReason === "captureStopped") {
    resumeRun();
  }

  if (update.logs?.length) {
    for (const log of update.logs) addLog(log.level, log.message);
  }
  if (update.log) addLog(update.log.level, update.log.message);
  publishState();
}

function maybeLogPendingCaptureBacklog(addedEvents: number): void {
  if (pendingCaptureEvents.length < 250) return;
  const now = Date.now();
  if (now - lastPendingCaptureEventsLogAt < 10_000) return;
  lastPendingCaptureEventsLogAt = now;
  writeAppLog("capture-event-backlog", {
    pendingCaptureEvents: pendingCaptureEvents.length,
    addedEvents,
    captureStatus: state.captureStatus,
    health: state.health,
  });
}

function addLog(level: LogEntry["level"], message: string): void {
  const output = level === "error" || level === "warning" ? console.error : console.log;
  output(`[${level}] ${message}`);
  logs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message,
    createdAt: Date.now(),
  });
  logs.splice(500);
}

function publishState(): void {
  if (statePublishTimer) return;
  statePublishTimer = setTimeout(() => {
    statePublishTimer = null;
    publishStateNow();
  }, STATE_PUBLISH_INTERVAL_MS);
  statePublishTimer.unref();
}

function publishStateNow(): void {
  applyPendingCaptureEvents();
  const window = currentWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.stateUpdated, state);
}

function applyPendingCaptureEvents(): void {
  if (pendingCaptureEvents.length === 0) return;
  const events = pendingCaptureEvents.splice(0);
  if (state.runStatus !== "recording") return;

  try {
    state.stats = statsEngine.applyEvents(events);
  } catch (error) {
    writeAppLog("stats-apply-error", {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      eventNames: events.map((event) => event.name),
    });
    addLog("error", `Parsed events were dropped after stats update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pauseRun(reason: Exclude<RunPausedReason, null>): void {
  if (state.runStatus === "paused") return;
  const now = Date.now();
  statsEngine.pause(now);
  state.runStatus = "paused";
  state.runPausedReason = reason;
  state.runPausedAt = now;
  state.runPausedDurationMs = statsEngine.pausedDurationMs(now);
  addLog("info", reason === "captureStopped" ? "Run paused because capture stopped." : "Run paused.");
}

function resumeRun(): void {
  if (state.runStatus !== "paused") return;
  const now = Date.now();
  statsEngine.resume(now);
  state.runStatus = "recording";
  state.runPausedReason = null;
  state.runPausedAt = null;
  state.runPausedDurationMs = statsEngine.pausedDurationMs(now);
  addLog("info", "Run resumed.");
}

ipcMain.handle(IPC_CHANNELS.stateGet, () => {
  applyPendingCaptureEvents();
  return state;
});
ipcMain.handle(IPC_CHANNELS.captureStart, async () => {
  gameCaptureCoordinator.clearLaunchCaptureTimer();
  await captureService?.start();
  return state;
});
ipcMain.handle(IPC_CHANNELS.gameLaunchOrCapture, async (_event, options) => gameCaptureCoordinator.launchOrCapture(options));
ipcMain.handle(IPC_CHANNELS.captureStop, () => {
  gameCaptureCoordinator.clearLaunchCaptureTimer();
  applyPendingCaptureEvents();
  pauseRun("captureStopped");
  captureService?.stop();
  return state;
});
ipcMain.handle(IPC_CHANNELS.statsReset, () => {
  applyPendingCaptureEvents();
  const archived = archiveCurrentRun("reset");
  state.stats = statsEngine.reset();
  state.runStatus = "recording";
  state.runPausedReason = null;
  state.runPausedAt = null;
  state.runPausedDurationMs = 0;
  addLog("info", archived ? "Run saved and session stats reset." : "Session stats reset. Run did not match save settings.");
  publishState();
  return state;
});
ipcMain.handle(IPC_CHANNELS.runPause, () => {
  applyPendingCaptureEvents();
  pauseRun("manual");
  publishState();
  return state;
});
ipcMain.handle(IPC_CHANNELS.runResume, () => {
  resumeRun();
  publishState();
  return state;
});
ipcMain.handle(IPC_CHANNELS.pastRunsSetTags, (_event, runId: string, tags: unknown) => {
  const normalizedRunId = String(runId ?? "");
  const nextTags = normalizePastRunTags(tags);
  if (!normalizedRunId || !state.pastRuns.some((run) => run.id === normalizedRunId)) return state;

  state.pastRuns = state.pastRuns.map((run) => (run.id === normalizedRunId ? { ...run, tags: nextTags } : run));
  savePastRuns(pastRunsPath, state.pastRuns, writeAppLog);
  publishState();
  return state;
});
ipcMain.handle(IPC_CHANNELS.preferencesSetRunArchive, (_event, preferences: Partial<RunArchivePreferences>) => {
  state.runArchivePreferences = normalizeRunArchivePreferences(preferences);
  saveRunArchivePreferences(preferencesPath, state.runArchivePreferences, writeAppLog);
  publishState();
  return state;
});
ipcMain.handle(IPC_CHANNELS.preferencesSetCapture, (_event, preferences: Partial<CapturePreferences>) => {
  const nextPreferences = normalizeCapturePreferences(preferences);
  const changed = state.capturePreferences.createDebugMode !== nextPreferences.createDebugMode;
  state.capturePreferences = nextPreferences;
  captureService?.setCreateDebugMode(nextPreferences.createDebugMode);
  saveCapturePreferences(preferencesPath, state.capturePreferences, writeAppLog);
  if (changed) addLog("info", `Verbose live logging ${nextPreferences.createDebugMode ? "enabled" : "disabled"}.`);
  publishState();
  return state;
});
ipcMain.handle(IPC_CHANNELS.configurationExport, async (_event, json: string) => {
  const contents = embedConfigurationSoundData(String(json ?? ""), app.getPath("userData"));
  const exported = await saveJsonFileWithDialog(currentWindow(), {
    title: "Export Hero Siege Companion configuration",
    defaultPath: "hero-siege-companion-config.json",
    contents,
  });
  if (exported) addLog("success", "Configuration exported.");
  return exported;
});
ipcMain.handle(IPC_CHANNELS.configurationImport, async (_event, installEmbeddedSounds?: boolean) => {
  const contents = await readJsonFileWithDialog(currentWindow(), {
    title: "Import Hero Siege Companion configuration",
    maxBytes: MAX_CONFIGURATION_IMPORT_BYTES,
    tooLargeMessage: "Configuration file is too large.",
  });
  if (contents) addLog("info", "Configuration selected for import.");
  return contents && installEmbeddedSounds === true ? installEmbeddedConfigurationSounds(contents, app.getPath("userData")) : contents;
});
ipcMain.handle(IPC_CHANNELS.itemResearchExport, async (_event, json: string) => {
  const exported = await saveJsonFileWithDialog(currentWindow(), {
    title: "Export Hero Siege item research JSON",
    defaultPath: "hero-siege-item-research.json",
    contents: json,
  });
  if (exported) addLog("success", "Item research JSON exported.");
  return exported;
});
ipcMain.handle(IPC_CHANNELS.soundsImport, async () => {
  const options = {
    title: "Import loot alert sounds",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Sound files or soundpacks", extensions: ["wav", "mp3", "ogg", "zip"] },
      { name: "Extra audio formats", extensions: ["m4a", "aac", "flac", "webm"] },
      { name: "All files", extensions: ["*"] },
    ],
  } satisfies Electron.OpenDialogOptions;
  const result = await showOpenDialogWithParent(currentWindow(), options);
  if (result.canceled) return [];

  const imported = importLootSounds(result.filePaths, app.getPath("userData"));
  if (imported.length) addLog("success", `${imported.length} custom loot sound${imported.length === 1 ? "" : "s"} imported.`);
  return imported;
});

ipcMain.handle(IPC_CHANNELS.soundsExport, async (_event, sounds = []) => {
  const result = await exportLootSoundPackWithDialog(currentWindow(), Array.isArray(sounds) ? sounds : [], app.getPath("userData"));
  if (result.exported) addLog("success", `Soundpack ZIP exported with ${result.includedFiles.length} sound${result.includedFiles.length === 1 ? "" : "s"}.`);
  return result;
});

ipcMain.handle(IPC_CHANNELS.soundsRemove, async (_event, src?: string) => {
  try {
    if (typeof src !== "string" || !removeImportedLootSound(src, app.getPath("userData"))) return false;
    addLog("info", "Custom loot sound removed.");
    return true;
  } catch (error) {
    addLog("warning", `Custom loot sound could not be removed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
});

ipcMain.handle(IPC_CHANNELS.pastRunsExportJson, async (_event, json: string) => {
  const exported = await saveJsonFileWithDialog(currentWindow(), {
    title: "Export Hero Siege past runs JSON",
    defaultPath: "hero-siege-past-runs.json",
    contents: json,
  });
  if (exported) addLog("success", "Past runs JSON exported.");
  return exported;
});

ipcMain.handle(IPC_CHANNELS.windowMinimize, () => {
  windowManager?.minimize();
});
ipcMain.handle(IPC_CHANNELS.windowToggleMaximize, () => {
  windowManager?.toggleMaximize();
});
ipcMain.handle(IPC_CHANNELS.windowClose, () => {
  windowManager?.close();
});
ipcMain.handle(IPC_CHANNELS.windowSetAlwaysOnTop, (_event, enabled: boolean) => {
  windowManager?.setAlwaysOnTop(Boolean(enabled));
});
ipcMain.handle(IPC_CHANNELS.windowSetCompactMode, (_event, enabled: boolean, lockPositions = false) => {
  windowManager?.setCompactMode(Boolean(enabled), Boolean(lockPositions));
});
ipcMain.handle(IPC_CHANNELS.clipboardWriteText, (_event, value: string) => {
  clipboard.writeText(String(value));
});
ipcMain.handle(IPC_CHANNELS.supportGetDiagnosticsInfo, () => getSupportDiagnosticsInfo(app.getPath("userData"), app.getVersion()));
ipcMain.handle(IPC_CHANNELS.supportSaveDiagnostics, async (_event, diagnosticsSummary: string): Promise<SupportDiagnosticsSaveResult> =>
  saveSupportDiagnostics(String(diagnosticsSummary ?? "")),
);
ipcMain.handle(IPC_CHANNELS.updatesCheck, async () => {
  if (isElectronE2eTestMode()) return null;
  return checkForReleaseUpdate(app.getVersion(), (error) => writeAppLog("release-check-error", { error: error.message }));
});
ipcMain.handle(IPC_CHANNELS.updatesOpenRelease, async (_event, url?: string) => {
  const target = typeof url === "string" && /^https:\/\/github\.com\/DemonSkye\/Hero-Siege-Companion\/releases(?:\/|$)/i.test(url)
    ? url
    : GITHUB_RELEASES_URL;
  await shell.openExternal(target);
});
ipcMain.handle(IPC_CHANNELS.docsOpenNpcapGuide, async () => {
  await shell.openExternal(GITHUB_NPCAP_GUIDE_URL);
});
ipcMain.handle(IPC_CHANNELS.gameChooseExecutable, async () => {
  const options = {
    title: "Choose Hero Siege executable",
    properties: ["openFile"],
    filters: [
      { name: "Executable", extensions: ["exe"] },
      { name: "All files", extensions: ["*"] },
    ],
  } satisfies Electron.OpenDialogOptions;
  const result = await showOpenDialogWithParent(currentWindow(), options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

async function saveSupportDiagnostics(diagnosticsSummary: string): Promise<SupportDiagnosticsSaveResult> {
  const result = await saveSupportDiagnosticsBundle({
    diagnosticsSummary,
    appVersion: app.getVersion(),
    ownerWindow: currentWindow(),
    userDataPath: app.getPath("userData"),
    onLogReadFailed: (file) => writeAppLog("support-diagnostics-log-read-failed", file),
  });
  if (!result.saved) return result;

  addLog("success", `Diagnostics ZIP saved with ${result.includedFiles.length} file${result.includedFiles.length === 1 ? "" : "s"}.`);
  writeAppLog("support-diagnostics-saved", {
    path: result.filePath,
    includedFiles: result.includedFiles,
  });
  return result;
}

app.whenReady().then(async () => {
  appLogPath = path.join(app.getPath("userData"), "app-debug.log");
  pastRunsPath = path.join(app.getPath("userData"), "past-runs.json");
  preferencesPath = path.join(app.getPath("userData"), "preferences.json");
  windowBoundsPath = path.join(app.getPath("userData"), "window-bounds.json");
  appSessionPath = path.join(app.getPath("userData"), "app-session.json");
  const debugLogPath = path.join(app.getPath("userData"), "capture-debug.log");
  const wideDebugLogPath = path.join(app.getPath("userData"), "capture-wide-debug.log");
  appDiagnostics = createAppDiagnostics({
    appLogPath,
    appSessionPath,
    appVersion: app.getVersion(),
    getSnapshot: () => ({
      state,
      logs,
      pendingCaptureEvents: pendingCaptureEvents.length,
      mainWindow: currentWindow(),
    }),
  });
  logPreviousAppSession();
  startAppSessionHeartbeat();
  startAppDiagnosticHeartbeat();
  state.pastRuns = loadPastRuns(pastRunsPath, writeAppLog);
  state.runArchivePreferences = loadRunArchivePreferences(preferencesPath, writeAppLog);
  state.capturePreferences = loadCapturePreferences(preferencesPath, writeAppLog);
  windowBounds = loadWindowBounds(windowBoundsPath, writeAppLog);
  writeAppLog("app-ready", {
    appLogPath,
    debugLogPath,
    wideDebugLogPath,
    pastRunsPath,
    preferencesPath,
    windowBoundsPath,
    appSessionPath,
    crashDumpsPath: app.getPath("crashDumps"),
    lastCrashReport: crashReporter.getLastCrashReport(),
  });
  captureService = await createCaptureRuntime(
    applyCaptureUpdate,
    debugLogPath,
    wideDebugLogPath,
    state.capturePreferences.createDebugMode,
  );
  state.health = { ...state.health, ...(await captureService.diagnostics()) };
  createWindow();
  installElectronE2eMainHooks({
    emitCaptureEvents: (events) => {
      if (!emitElectronE2eCaptureEvents(captureService, events)) applyCaptureUpdate({ events });
      publishStateNow();
    },
    emitCapturePayloads: (payloads) => {
      emitElectronE2eCapturePayloads(captureService, payloads);
      publishStateNow();
    },
    getState: () => state,
    getWindowState: () => {
      const window = currentWindow();
      return {
        compactMode: windowManager?.isCompactMode ?? false,
        bounds: window && !window.isDestroyed() ? window.getBounds() : null,
        alwaysOnTop: window && !window.isDestroyed() ? window.isAlwaysOnTop() : false,
      };
    },
  });
  addLog("info", "Hero Siege Companion started.");
  addLog("info", `Capture debug log: ${debugLogPath}`);
  addLog("info", `Wide capture log: ${wideDebugLogPath}`);
  if (await captureService.hasHeroSiegeProcess()) {
    await captureService.start();
  } else {
    addLog("info", "Hero Siege is not running yet. Launch the game, wait for the main menu, then click Launch Game.");
    publishState();
  }
  gameCaptureCoordinator.startMonitor();
});

app.on("child-process-gone", (_event, details) => {
  writeAppLog("child-process-gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });
  addLog("warning", `Electron child process stopped: ${details.type} (${details.reason}).`);
});

app.on("before-quit", () => {
  writeAppLog("before-quit", { exitCode: process.exitCode ?? null });
  writeAppSession("before-quit");
  shutdownCapture("before-quit");
});

app.on("will-quit", () => {
  writeAppLog("will-quit", { exitCode: process.exitCode ?? null });
  writeAppSession("will-quit");
  shutdownCapture("will-quit");
});

app.on("window-all-closed", () => {
  writeAppLog("window-all-closed", {});
  shutdownCapture("window-all-closed");
  app.quit();
  scheduleForceExit();
});

function shutdownCapture(reason: string): void {
  writeAppLog("shutdown-capture", { reason, captureStatus: state.captureStatus, captureRunning: state.captureRunning });
  gameCaptureCoordinator.clearLaunchCaptureTimer();
  gameCaptureCoordinator.stopMonitor();
  archiveCurrentRun(reason);
  try {
    captureService?.stop();
  } catch (error) {
    writeAppLog("shutdown-capture-error", { reason, error: error instanceof Error ? error.message : String(error) });
  }
}

function scheduleForceExit(): void {
  if (forceExitTimer) return;
  forceExitTimer = setTimeout(() => {
    writeAppLog("force-exit", { captureStatus: state.captureStatus, captureRunning: state.captureRunning });
    writeAppSession("force-exit");
    app.exit(0);
  }, 1500);
  forceExitTimer.unref();
}

function logPreviousAppSession(): void {
  appDiagnostics?.logPreviousSession();
}

function startAppSessionHeartbeat(): void {
  appDiagnostics?.startSessionHeartbeat();
}

function stopAppSessionHeartbeat(): void {
  appDiagnostics?.stopSessionHeartbeat();
}

function startAppDiagnosticHeartbeat(): void {
  appDiagnostics?.startDiagnosticHeartbeat();
}

function stopAppDiagnosticHeartbeat(): void {
  appDiagnostics?.stopDiagnosticHeartbeat();
}

function markAppSessionClosed(reason: string): void {
  appDiagnostics?.markSessionClosed(reason);
}

function writeAppSession(phase: string, extra: Record<string, unknown> = {}): void {
  appDiagnostics?.writeSession(phase, extra);
}

function archiveCurrentRun(reason: string): boolean {
  if (!pastRunsPath) return false;
  applyPendingCaptureEvents();
  const summary = statsEngine.runSummary();
  if (archivedSessionStarts.has(summary.sessionStartedAt)) return false;
  if (!shouldArchiveRun(summary)) return false;

  archivedSessionStarts.add(summary.sessionStartedAt);
  state.pastRuns = [summary, ...state.pastRuns.filter((run) => run.sessionStartedAt !== summary.sessionStartedAt)].slice(0, MAX_PAST_RUNS);
  savePastRuns(pastRunsPath, state.pastRuns, writeAppLog);
  writeAppLog("run-archived", { reason, id: summary.id });
  addLog("success", `Archived run summary: ${summary.totalGoldGained.toLocaleString()} gold, ${summary.totalXpGained.toLocaleString()} XP, ${(summary.totalKillsGained ?? 0).toLocaleString()} kills.`);
  return true;
}

function shouldArchiveRun(summary: PastRunSummary): boolean {
  const preferences = state.runArchivePreferences;
  if (preferences.skipEmptyRuns && !hasRunActivity(summary)) return false;
  return summary.durationMs >= preferences.minDurationMinutes * 60_000;
}

function writeAppLog(type: string, data: Record<string, unknown>): void {
  appDiagnostics?.writeLog(type, data);
}
