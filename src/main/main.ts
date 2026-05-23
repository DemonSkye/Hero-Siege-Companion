import { app, BrowserWindow, clipboard, crashReporter, dialog, ipcMain, nativeImage, shell, type Rectangle } from "electron";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { CaptureService, type CaptureUpdate } from "./capture";
import type { CapturePreferences, CompanionState, LogEntry, ReleaseUpdateInfo, RunArchivePreferences } from "../shared/app-state";
import { createInitialStats, hasRunActivity, StatsEngine, type PastRunSummary } from "../shared/stats";

const statsEngine = new StatsEngine();
const logs: LogEntry[] = [];
const MAX_APP_LOG_BYTES = 5 * 1024 * 1024;
const MAX_PAST_RUNS = 100;
const DEFAULT_RUN_ARCHIVE_PREFERENCES: RunArchivePreferences = {
  skipEmptyRuns: false,
  minDurationMinutes: 0,
};
const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  createDebugMode: false,
};
const NORMAL_WINDOW_BOUNDS = { width: 1180, height: 760, minWidth: 980, minHeight: 620 };
const COMPACT_WINDOW_BOUNDS = { width: 420, height: 220, minWidth: 340, minHeight: 160 };
const STEAM_HERO_SIEGE_URL = "steam://rungameid/269210";
const LAUNCH_CAPTURE_DELAY_MS = 45_000;
const GAME_PROCESS_MONITOR_MS = 12_000;
const RENDERER_RECOVERY_DELAY_MS = 500;
const MAX_RENDERER_RECOVERIES = 3;
const RENDERER_RECOVERY_WINDOW_MS = 60_000;
const APP_SESSION_HEARTBEAT_MS = 15_000;
const APP_DIAGNOSTIC_HEARTBEAT_MS = 30_000;
const STATE_PUBLISH_INTERVAL_MS = 1000;
const GITHUB_RELEASES_URL = "https://github.com/DemonSkye/Hero-Siege-Companion/releases";
const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/DemonSkye/Hero-Siege-Companion/releases/latest";
const RELEASE_CHECK_TIMEOUT_MS = 6000;

const state: CompanionState = {
  captureRunning: false,
  captureStatus: "idle",
  captureError: null,
  connections: [],
  health: {
    npcapService: "Unknown",
    winPcapCompatible: false,
    adminOnly: false,
    device: null,
    filter: "",
    packetsSeen: 0,
    payloadsAssembled: 0,
    messagesDecoded: 0,
    parsedEvents: 0,
    parserErrors: 0,
    parserRestarts: 0,
    lastParserError: null,
  },
  stats: createInitialStats(),
  pastRuns: [],
  runArchivePreferences: DEFAULT_RUN_ARCHIVE_PREFERENCES,
  capturePreferences: DEFAULT_CAPTURE_PREFERENCES,
  logs,
};

const pendingCaptureEvents: NonNullable<CaptureUpdate["events"]> = [];
let mainWindow: BrowserWindow | null = null;
let captureService: CaptureService | null = null;
let appLogPath = "";
let pastRunsPath = "";
let preferencesPath = "";
let windowBoundsPath = "";
let appSessionPath = "";
let forceExitTimer: NodeJS.Timeout | null = null;
let launchCaptureTimer: NodeJS.Timeout | null = null;
let gameProcessMonitorTimer: NodeJS.Timeout | null = null;
let compactWindowMode = false;
let windowBounds: WindowBoundsPreferences = {};
let saveWindowBoundsTimer: NodeJS.Timeout | null = null;
let rendererRecoveryTimer: NodeJS.Timeout | null = null;
let appSessionHeartbeatTimer: NodeJS.Timeout | null = null;
let appDiagnosticHeartbeatTimer: NodeJS.Timeout | null = null;
let statePublishTimer: NodeJS.Timeout | null = null;
let lastPendingCaptureEventsLogAt = 0;
let lastGameProcessAutoStartLogAt = 0;
let gameProcessMonitorActive = false;
let rendererRecoveryWindowStartedAt = 0;
let rendererRecoveriesInWindow = 0;
const appSessionId = `${Date.now()}-${process.pid}`;
const appSessionStartedAt = new Date().toISOString();
const archivedSessionStarts = new Set<number>();

interface WindowBoundsPreferences {
  normal?: Rectangle;
  compact?: Rectangle;
}

if (process.platform === "win32") app.setAppUserModelId("com.herosiege.companion");

try {
  crashReporter.start({ uploadToServer: false });
} catch (error) {
  console.error("Failed to start crash reporter", error);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
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
  const iconPath = resolveIconPath();
  mainWindow = new BrowserWindow({
    width: NORMAL_WINDOW_BOUNDS.width,
    height: NORMAL_WINDOW_BOUNDS.height,
    minWidth: NORMAL_WINDOW_BOUNDS.minWidth,
    minHeight: NORMAL_WINDOW_BOUNDS.minHeight,
    autoHideMenuBar: true,
    backgroundColor: "#101217",
    frame: false,
    icon: nativeImage.createFromPath(iconPath),
    title: "Hero Siege Companion",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadRenderer(mainWindow);
  writeAppLog("window-created", { id: mainWindow.id, bounds: mainWindow.getBounds() });
  mainWindow.on("close", () => {
    writeAppLog("window-close", { id: mainWindow?.id, captureStatus: state.captureStatus, captureRunning: state.captureRunning });
  });
  mainWindow.on("closed", () => {
    writeAppLog("window-closed", {});
    mainWindow = null;
  });
  mainWindow.on("moved", scheduleWindowBoundsSave);
  mainWindow.on("resized", scheduleWindowBoundsSave);
  mainWindow.webContents.on("unresponsive", () => {
    writeAppLog("renderer-unresponsive", {
      windowId: mainWindow?.id,
      webContentsId: mainWindow?.webContents.id,
      url: mainWindow?.webContents.getURL(),
    });
    addLog("warning", "Renderer became unresponsive.");
  });
  mainWindow.webContents.on("responsive", () => {
    writeAppLog("renderer-responsive", {
      windowId: mainWindow?.id,
      webContentsId: mainWindow?.webContents.id,
      url: mainWindow?.webContents.getURL(),
    });
    addLog("info", "Renderer became responsive again.");
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeAppLog("renderer-did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeAppLog("renderer-preload-error", { preloadPath, message: error.message, stack: error.stack });
    addLog("error", `Renderer preload failed: ${error.message}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeAppLog("render-process-gone", {
      windowId: mainWindow?.id,
      webContentsId: mainWindow?.webContents.id,
      url: mainWindow?.webContents.getURL(),
      reason: details.reason,
      exitCode: details.exitCode,
    });
    addLog("error", `Renderer stopped unexpectedly: ${details.reason}.`);
    scheduleRendererRecovery(details.reason);
  });
}

function loadRenderer(window: BrowserWindow): void {
  window.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
}

function scheduleRendererRecovery(reason: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || rendererRecoveryTimer) return;
  if (reason === "clean-exit" || reason === "killed") return;

  const now = Date.now();
  if (now - rendererRecoveryWindowStartedAt > RENDERER_RECOVERY_WINDOW_MS) {
    rendererRecoveryWindowStartedAt = now;
    rendererRecoveriesInWindow = 0;
  }

  rendererRecoveriesInWindow += 1;
  if (rendererRecoveriesInWindow > MAX_RENDERER_RECOVERIES) {
    writeAppLog("renderer-recovery-skipped", { reason, rendererRecoveriesInWindow });
    addLog("error", "Renderer crashed repeatedly; automatic recovery paused.");
    return;
  }

  writeAppLog("renderer-recovery-scheduled", { reason, rendererRecoveriesInWindow });
  rendererRecoveryTimer = setTimeout(() => {
    rendererRecoveryTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    loadRenderer(mainWindow);
    publishStateNow();
    addLog("warning", "Recovered the app window after a renderer crash.");
  }, RENDERER_RECOVERY_DELAY_MS);
  rendererRecoveryTimer.unref();
}

function resolveIconPath(): string {
  const resourceIconPath = path.join(process.resourcesPath, "icon.ico");
  if (app.isPackaged && fs.existsSync(resourceIconPath)) return resourceIconPath;
  return path.join(app.getAppPath(), "icon.ico");
}

function applyCaptureUpdate(update: CaptureUpdate): void {
  const previousCaptureStatus = state.captureStatus;
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("state:updated", state);
}

function applyPendingCaptureEvents(): void {
  if (pendingCaptureEvents.length === 0) return;
  const events = pendingCaptureEvents.splice(0);

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

ipcMain.handle("state:get", () => {
  applyPendingCaptureEvents();
  return state;
});
ipcMain.handle("capture:start", async () => {
  clearLaunchCaptureTimer();
  await captureService?.start();
  return state;
});
ipcMain.handle("game:launch-or-capture", async (_event, options: { executablePath?: string; launchThroughSteam?: boolean }) => {
  const service = captureService;
  if (service && (await service.hasHeroSiegeProcess())) {
    clearLaunchCaptureTimer();
    await service.start();
    return state;
  }

  const launchThroughSteam = Boolean(options?.launchThroughSteam);
  if (launchThroughSteam) {
    try {
      await shell.openExternal(STEAM_HERO_SIEGE_URL);
      addLog("info", "Launched Hero Siege through Steam. Capture will try to start automatically in about 45 seconds.");
      scheduleLaunchCaptureAttempt();
    } catch (error) {
      addLog("error", `Failed to launch Hero Siege through Steam: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    const normalizedPath = String(options?.executablePath ?? "").trim();
    if (!normalizedPath) {
      addLog("warning", "Hero Siege is not running. Choose a non-Steam Hero Siege executable in Settings, then click Launch Game.");
      publishState();
      return state;
    }

    if (!fs.existsSync(normalizedPath)) {
      addLog("error", `Hero Siege executable was not found: ${normalizedPath}`);
      publishState();
      return state;
    }

    const launchError = await shell.openPath(normalizedPath);
    if (launchError) {
      addLog("error", `Failed to launch Hero Siege: ${launchError}`);
    } else {
      addLog("info", "Launched Hero Siege. Capture will try to start automatically in about 45 seconds.");
      scheduleLaunchCaptureAttempt();
    }
  }
  publishState();
  return state;
});
ipcMain.handle("capture:stop", () => {
  clearLaunchCaptureTimer();
  captureService?.stop();
  return state;
});
ipcMain.handle("stats:reset", () => {
  applyPendingCaptureEvents();
  const archived = archiveCurrentRun("reset");
  state.stats = statsEngine.reset();
  addLog("info", archived ? "Run saved and session stats reset." : "Session stats reset. Run did not match save settings.");
  publishState();
  return state;
});
ipcMain.handle("preferences:set-run-archive", (_event, preferences: Partial<RunArchivePreferences>) => {
  state.runArchivePreferences = normalizeRunArchivePreferences(preferences);
  saveRunArchivePreferences(state.runArchivePreferences);
  publishState();
  return state;
});
ipcMain.handle("preferences:set-capture", (_event, preferences: Partial<CapturePreferences>) => {
  const nextPreferences = normalizeCapturePreferences(preferences);
  const changed = state.capturePreferences.createDebugMode !== nextPreferences.createDebugMode;
  state.capturePreferences = nextPreferences;
  captureService?.setCreateDebugMode(nextPreferences.createDebugMode);
  saveCapturePreferences(state.capturePreferences);
  if (changed) addLog("info", `Verbose live logging ${nextPreferences.createDebugMode ? "enabled" : "disabled"}.`);
  publishState();
  return state;
});
ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});
ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) return;
  if (compactWindowMode) {
    setCompactWindowMode(false);
    return;
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window:close", () => {
  mainWindow?.close();
});
ipcMain.handle("window:set-always-on-top", (_event, enabled: boolean) => {
  setWindowAlwaysOnTop(Boolean(enabled));
});
ipcMain.handle("window:set-compact-mode", (_event, enabled: boolean, lockPositions = false) => {
  if (!mainWindow) return;
  setCompactWindowMode(Boolean(enabled), Boolean(lockPositions));
});
ipcMain.handle("clipboard:write-text", (_event, value: string) => {
  clipboard.writeText(String(value));
});
ipcMain.handle("updates:check", async () => checkForReleaseUpdate());
ipcMain.handle("updates:open-release", async (_event, url?: string) => {
  const target = typeof url === "string" && /^https:\/\/github\.com\/DemonSkye\/Hero-Siege-Companion\/releases(?:\/|$)/i.test(url)
    ? url
    : GITHUB_RELEASES_URL;
  await shell.openExternal(target);
});
ipcMain.handle("game:choose-executable", async () => {
  const options = {
    title: "Choose Hero Siege executable",
    properties: ["openFile"],
    filters: [
      { name: "Executable", extensions: ["exe"] },
      { name: "All files", extensions: ["*"] },
    ],
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

async function checkForReleaseUpdate(): Promise<ReleaseUpdateInfo | null> {
  try {
    const release = await fetchLatestRelease();
    const version = normalizeReleaseVersion(release.tag_name || release.name || "");
    const currentVersion = normalizeReleaseVersion(app.getVersion());
    if (!version || !isNewerVersion(version, currentVersion)) return null;

    return {
      version,
      currentVersion,
      name: release.name || `Release ${version}`,
      url: release.html_url || `${GITHUB_RELEASES_URL}/tag/v${version}`,
      publishedAt: release.published_at || "",
    };
  } catch (error) {
    writeAppLog("release-check-error", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

function fetchLatestRelease(): Promise<GitHubReleasePayload> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      GITHUB_LATEST_RELEASE_API_URL,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Hero-Siege-Companion/${app.getVersion()}`,
        },
        timeout: RELEASE_CHECK_TIMEOUT_MS,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
            reject(new Error(`GitHub release check returned HTTP ${response.statusCode ?? "unknown"}.`));
            return;
          }

          try {
            resolve(JSON.parse(body) as GitHubReleasePayload);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("GitHub release check timed out."));
    });
    request.on("error", reject);
  });
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
}

function normalizeReleaseVersion(value: string): string {
  const match = value.trim().match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? "";
}

function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseVersionParts(candidate);
  const currentParts = parseVersionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] > currentParts[index]) return true;
    if (candidateParts[index] < currentParts[index]) return false;
  }
  return false;
}

function parseVersionParts(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(/[+-]/)[0].split(".");
  return [major, minor, patch].map((part) => Number.parseInt(part, 10) || 0) as [number, number, number];
}

function setWindowAlwaysOnTop(enabled: boolean): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(enabled, "screen-saver");
  if (enabled) {
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  }
}

function scheduleLaunchCaptureAttempt(): void {
  clearLaunchCaptureTimer();
  launchCaptureTimer = setTimeout(() => {
    launchCaptureTimer = null;
    void attemptCaptureAfterLaunch();
  }, LAUNCH_CAPTURE_DELAY_MS);
  launchCaptureTimer.unref();
}

function clearLaunchCaptureTimer(): void {
  if (!launchCaptureTimer) return;
  clearTimeout(launchCaptureTimer);
  launchCaptureTimer = null;
}

async function attemptCaptureAfterLaunch(): Promise<void> {
  if (!captureService || state.captureRunning) return;
  addLog("info", "Checking for Hero Siege after launch delay.");
  await captureService.start();
  publishState();
}

function startGameProcessMonitor(): void {
  if (gameProcessMonitorTimer) return;
  gameProcessMonitorTimer = setInterval(() => {
    void syncCaptureToGameProcess("monitor");
  }, GAME_PROCESS_MONITOR_MS);
  gameProcessMonitorTimer.unref();
  void syncCaptureToGameProcess("startup");
}

function stopGameProcessMonitor(): void {
  if (!gameProcessMonitorTimer) return;
  clearInterval(gameProcessMonitorTimer);
  gameProcessMonitorTimer = null;
}

async function syncCaptureToGameProcess(source: string): Promise<void> {
  if (!captureService || state.captureRunning || gameProcessMonitorActive) return;
  gameProcessMonitorActive = true;
  try {
    if (!(await captureService.hasHeroSiegeProcess())) return;
    writeAppLog("game-process-detected", { source, captureStatus: state.captureStatus });
    const now = Date.now();
    if (now - lastGameProcessAutoStartLogAt > 60_000) {
      lastGameProcessAutoStartLogAt = now;
      addLog("info", "Hero Siege is running; starting capture automatically.");
    }
    clearLaunchCaptureTimer();
    await captureService.start();
    publishState();
  } finally {
    gameProcessMonitorActive = false;
  }
}

function setCompactWindowMode(enabled: boolean, lockPositions = false): void {
  if (!mainWindow) return;
  if (compactWindowMode === enabled) {
    mainWindow.setMaximizable(!enabled);
    if (lockPositions) restoreWindowBounds(enabled ? "compact" : "normal");
    if (mainWindow.isAlwaysOnTop()) mainWindow.moveTop();
    return;
  }
  saveCurrentWindowBounds();
  compactWindowMode = enabled;
  const bounds = enabled ? COMPACT_WINDOW_BOUNDS : NORMAL_WINDOW_BOUNDS;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setMaximizable(!enabled);
  mainWindow.setMinimumSize(bounds.minWidth, bounds.minHeight);
  if (lockPositions && restoreWindowBounds(enabled ? "compact" : "normal")) {
    // Restored from the user's saved location.
  } else {
    mainWindow.setSize(bounds.width, bounds.height, true);
  }
  if (mainWindow.isAlwaysOnTop()) mainWindow.moveTop();
}

function restoreWindowBounds(mode: keyof WindowBoundsPreferences): boolean {
  if (!mainWindow) return false;
  const minimums = mode === "compact" ? COMPACT_WINDOW_BOUNDS : NORMAL_WINDOW_BOUNDS;
  const bounds = withMinimumBounds(windowBounds[mode], minimums);
  if (!bounds) return false;
  mainWindow.setBounds(bounds, true);
  return true;
}

function scheduleWindowBoundsSave(): void {
  if (saveWindowBoundsTimer) clearTimeout(saveWindowBoundsTimer);
  saveWindowBoundsTimer = setTimeout(() => {
    saveWindowBoundsTimer = null;
    saveCurrentWindowBounds();
  }, 250);
}

function saveCurrentWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  windowBounds[compactWindowMode ? "compact" : "normal"] = mainWindow.getBounds();
  saveWindowBounds();
}

app.whenReady().then(async () => {
  appLogPath = path.join(app.getPath("userData"), "app-debug.log");
  pastRunsPath = path.join(app.getPath("userData"), "past-runs.json");
  preferencesPath = path.join(app.getPath("userData"), "preferences.json");
  windowBoundsPath = path.join(app.getPath("userData"), "window-bounds.json");
  appSessionPath = path.join(app.getPath("userData"), "app-session.json");
  const debugLogPath = path.join(app.getPath("userData"), "capture-debug.log");
  const wideDebugLogPath = path.join(app.getPath("userData"), "capture-wide-debug.log");
  logPreviousAppSession();
  startAppSessionHeartbeat();
  startAppDiagnosticHeartbeat();
  state.pastRuns = loadPastRuns();
  state.runArchivePreferences = loadRunArchivePreferences();
  state.capturePreferences = loadCapturePreferences();
  windowBounds = loadWindowBounds();
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
  captureService = new CaptureService(applyCaptureUpdate, debugLogPath, wideDebugLogPath, state.capturePreferences.createDebugMode);
  state.health = { ...state.health, ...(await captureService.diagnostics()) };
  createWindow();
  addLog("info", "Hero Siege Companion started.");
  addLog("info", `Capture debug log: ${debugLogPath}`);
  addLog("info", `Wide capture log: ${wideDebugLogPath}`);
  if (await captureService.hasHeroSiegeProcess()) {
    await captureService.start();
  } else {
    addLog("info", "Hero Siege is not running yet. Launch the game, wait for the main menu, then click Launch Game.");
    publishState();
  }
  startGameProcessMonitor();
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
  clearLaunchCaptureTimer();
  stopGameProcessMonitor();
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
  try {
    if (!fs.existsSync(appSessionPath)) return;
    const previous = JSON.parse(fs.readFileSync(appSessionPath, "utf8")) as Record<string, unknown>;
    if (previous.phase === "closed" || previous.closedAt) return;
    writeAppLog("previous-non-graceful-exit", {
      previousSessionId: previous.sessionId,
      previousPid: previous.pid,
      previousPhase: previous.phase,
      previousStartedAt: previous.startedAt,
      previousLastHeartbeatAt: previous.lastHeartbeatAt,
      previousShutdownReason: previous.shutdownReason,
    });
  } catch (error) {
    writeAppLog("previous-session-read-error", { error: error instanceof Error ? error.message : String(error) });
  }
}

function startAppSessionHeartbeat(): void {
  writeAppSession("started");
  stopAppSessionHeartbeat();
  appSessionHeartbeatTimer = setInterval(() => writeAppSession("heartbeat"), APP_SESSION_HEARTBEAT_MS);
  appSessionHeartbeatTimer.unref();
}

function stopAppSessionHeartbeat(): void {
  if (!appSessionHeartbeatTimer) return;
  clearInterval(appSessionHeartbeatTimer);
  appSessionHeartbeatTimer = null;
}

function startAppDiagnosticHeartbeat(): void {
  stopAppDiagnosticHeartbeat();
  appDiagnosticHeartbeatTimer = setInterval(writeAppDiagnosticHeartbeat, APP_DIAGNOSTIC_HEARTBEAT_MS);
  appDiagnosticHeartbeatTimer.unref();
  writeAppDiagnosticHeartbeat();
}

function stopAppDiagnosticHeartbeat(): void {
  if (!appDiagnosticHeartbeatTimer) return;
  clearInterval(appDiagnosticHeartbeatTimer);
  appDiagnosticHeartbeatTimer = null;
}

function writeAppDiagnosticHeartbeat(): void {
  const memory = process.memoryUsage();
  writeAppLog("app-heartbeat", {
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    version: app.getVersion(),
    captureRunning: state.captureRunning,
    captureStatus: state.captureStatus,
    captureError: state.captureError,
    connectionCount: state.connections.length,
    pendingCaptureEvents: pendingCaptureEvents.length,
    logRows: logs.length,
    health: state.health,
    stats: {
      lastEventAt: state.stats.lastEventAt,
      itemTimeline: state.stats.itemTimeline.length,
      totalGoldEarned: state.stats.totalGoldEarned,
      totalXpEarned: state.stats.totalXpEarned,
    },
    renderer: mainWindow
      ? {
          id: mainWindow.id,
          destroyed: mainWindow.isDestroyed(),
          visible: !mainWindow.isDestroyed() ? mainWindow.isVisible() : false,
          focused: !mainWindow.isDestroyed() ? mainWindow.isFocused() : false,
          minimized: !mainWindow.isDestroyed() ? mainWindow.isMinimized() : false,
          bounds: !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
          url: !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : null,
        }
      : null,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
  });
}

function markAppSessionClosed(reason: string): void {
  writeAppSession("closed", { closedAt: new Date().toISOString(), shutdownReason: reason });
}

function writeAppSession(phase: string, extra: Record<string, unknown> = {}): void {
  if (!appSessionPath) return;
  try {
    fs.writeFileSync(
      appSessionPath,
      `${JSON.stringify(
        {
          sessionId: appSessionId,
          pid: process.pid,
          startedAt: appSessionStartedAt,
          lastHeartbeatAt: new Date().toISOString(),
          phase,
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          ...extra,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (error) {
    writeAppLog("app-session-write-error", { phase, error: error instanceof Error ? error.message : String(error) });
  }
}

function archiveCurrentRun(reason: string): boolean {
  if (!pastRunsPath) return false;
  applyPendingCaptureEvents();
  const summary = statsEngine.runSummary();
  if (archivedSessionStarts.has(summary.sessionStartedAt)) return false;
  if (!shouldArchiveRun(summary)) return false;

  archivedSessionStarts.add(summary.sessionStartedAt);
  state.pastRuns = [summary, ...state.pastRuns.filter((run) => run.sessionStartedAt !== summary.sessionStartedAt)].slice(0, MAX_PAST_RUNS);
  savePastRuns(state.pastRuns);
  writeAppLog("run-archived", { reason, id: summary.id });
  addLog("success", `Archived run summary: ${summary.totalGoldGained.toLocaleString()} gold, ${summary.totalXpGained.toLocaleString()} XP.`);
  return true;
}

function shouldArchiveRun(summary: PastRunSummary): boolean {
  const preferences = state.runArchivePreferences;
  if (preferences.skipEmptyRuns && !hasRunActivity(summary)) return false;
  return summary.durationMs >= preferences.minDurationMinutes * 60_000;
}

function loadPastRuns(): PastRunSummary[] {
  try {
    if (!fs.existsSync(pastRunsPath)) return [];
    const raw = fs.readFileSync(pastRunsPath, "utf8");
    const parsed = JSON.parse(raw) as PastRunSummary[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_PAST_RUNS).filter(isPastRunSummary);
  } catch (error) {
    writeAppLog("past-runs-load-error", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

function savePastRuns(runs: PastRunSummary[]): void {
  try {
    fs.writeFileSync(pastRunsPath, `${JSON.stringify(runs.slice(0, MAX_PAST_RUNS), null, 2)}\n`, "utf8");
  } catch (error) {
    writeAppLog("past-runs-save-error", { error: error instanceof Error ? error.message : String(error) });
  }
}

function loadWindowBounds(): WindowBoundsPreferences {
  try {
    if (!fs.existsSync(windowBoundsPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(windowBoundsPath, "utf8")) as WindowBoundsPreferences;
    return {
      normal: normalizeWindowBounds(parsed.normal),
      compact: normalizeWindowBounds(parsed.compact),
    };
  } catch (error) {
    writeAppLog("window-bounds-load-error", { error: error instanceof Error ? error.message : String(error) });
    return {};
  }
}

function saveWindowBounds(): void {
  try {
    fs.writeFileSync(windowBoundsPath, `${JSON.stringify(windowBounds, null, 2)}\n`, "utf8");
  } catch (error) {
    writeAppLog("window-bounds-save-error", { error: error instanceof Error ? error.message : String(error) });
  }
}

function normalizeWindowBounds(bounds: Rectangle | undefined): Rectangle | undefined {
  if (!bounds) return undefined;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  if (width < 120 || height < 100) return undefined;
  return { x: Math.trunc(x), y: Math.trunc(y), width: Math.trunc(width), height: Math.trunc(height) };
}

function withMinimumBounds(
  bounds: Rectangle | undefined,
  minimums: { width: number; height: number; minWidth: number; minHeight: number },
): Rectangle | undefined {
  const normalized = normalizeWindowBounds(bounds);
  if (!normalized) return undefined;
  return {
    x: normalized.x,
    y: normalized.y,
    width: Math.max(normalized.width, minimums.minWidth),
    height: Math.max(normalized.height, minimums.minHeight),
  };
}

function loadRunArchivePreferences(): RunArchivePreferences {
  try {
    if (!fs.existsSync(preferencesPath)) return DEFAULT_RUN_ARCHIVE_PREFERENCES;
    const parsed = loadPreferencesFile() as { runArchive?: Partial<RunArchivePreferences> };
    return normalizeRunArchivePreferences(parsed.runArchive ?? {});
  } catch (error) {
    writeAppLog("preferences-load-error", { error: error instanceof Error ? error.message : String(error) });
    return DEFAULT_RUN_ARCHIVE_PREFERENCES;
  }
}

function saveRunArchivePreferences(preferences: RunArchivePreferences): void {
  try {
    savePreferencesFile({ ...loadPreferencesFile(), runArchive: preferences });
  } catch (error) {
    writeAppLog("preferences-save-error", { error: error instanceof Error ? error.message : String(error) });
  }
}

function normalizeRunArchivePreferences(preferences: Partial<RunArchivePreferences>): RunArchivePreferences {
  const minDuration = Number(preferences.minDurationMinutes);
  return {
    skipEmptyRuns: Boolean(preferences.skipEmptyRuns),
    minDurationMinutes: Number.isFinite(minDuration) ? Math.max(0, Math.min(1440, Math.trunc(minDuration))) : 0,
  };
}

function loadCapturePreferences(): CapturePreferences {
  try {
    if (!fs.existsSync(preferencesPath)) return DEFAULT_CAPTURE_PREFERENCES;
    const parsed = loadPreferencesFile() as { capture?: Partial<CapturePreferences> };
    return normalizeCapturePreferences(parsed.capture ?? {});
  } catch (error) {
    writeAppLog("preferences-load-error", { error: error instanceof Error ? error.message : String(error) });
    return DEFAULT_CAPTURE_PREFERENCES;
  }
}

function saveCapturePreferences(preferences: CapturePreferences): void {
  try {
    savePreferencesFile({ ...loadPreferencesFile(), capture: preferences });
  } catch (error) {
    writeAppLog("preferences-save-error", { error: error instanceof Error ? error.message : String(error) });
  }
}

function normalizeCapturePreferences(preferences: Partial<CapturePreferences>): CapturePreferences {
  return {
    createDebugMode: Boolean(preferences.createDebugMode),
  };
}

function loadPreferencesFile(): Record<string, unknown> {
  if (!preferencesPath || !fs.existsSync(preferencesPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(preferencesPath, "utf8")) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function savePreferencesFile(preferences: Record<string, unknown>): void {
  fs.writeFileSync(preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}

function isPastRunSummary(value: unknown): value is PastRunSummary {
  const candidate = value as Partial<PastRunSummary>;
  return (
    Boolean(candidate) &&
    typeof candidate.id === "string" &&
    typeof candidate.sessionStartedAt === "number" &&
    typeof candidate.sessionEndedAt === "number" &&
    typeof candidate.durationMs === "number" &&
    typeof candidate.totalGoldGained === "number" &&
    typeof candidate.totalXpGained === "number" &&
    Array.isArray(candidate.keys) &&
    Array.isArray(candidate.ores)
  );
}

function writeAppLog(type: string, data: Record<string, unknown>): void {
  if (!appLogPath) return;
  try {
    rotateLogIfLarge(appLogPath, MAX_APP_LOG_BYTES);
    fs.appendFileSync(appLogPath, `${JSON.stringify({ at: new Date().toISOString(), ...data, type })}\n`, "utf8");
  } catch {
    // Crash diagnostics must never become the crash.
  }
}

function rotateLogIfLarge(logPath: string, maxBytes: number): void {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size <= maxBytes) return;

  const rotatedPath = `${logPath}.old`;
  if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
  fs.renameSync(logPath, rotatedPath);
}
