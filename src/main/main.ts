import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";
import { CaptureService, type CaptureUpdate } from "./capture";
import type { CompanionState, LogEntry, RunArchivePreferences } from "../shared/app-state";
import { createInitialStats, hasRunActivity, StatsEngine, type PastRunSummary } from "../shared/stats";

const statsEngine = new StatsEngine();
const logs: LogEntry[] = [];
const MAX_APP_LOG_BYTES = 2 * 1024 * 1024;
const MAX_PAST_RUNS = 100;
const DEFAULT_RUN_ARCHIVE_PREFERENCES: RunArchivePreferences = {
  skipEmptyRuns: false,
  minDurationMinutes: 0,
};
const NORMAL_WINDOW_BOUNDS = { width: 1180, height: 760, minWidth: 980, minHeight: 620 };
const COMPACT_WINDOW_BOUNDS = { width: 420, height: 220, minWidth: 340, minHeight: 160 };
const STEAM_HERO_SIEGE_URL = "steam://rungameid/269210";
const LAUNCH_CAPTURE_DELAY_MS = 45_000;

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
  },
  stats: createInitialStats(),
  pastRuns: [],
  runArchivePreferences: DEFAULT_RUN_ARCHIVE_PREFERENCES,
  logs,
};

let mainWindow: BrowserWindow | null = null;
let captureService: CaptureService | null = null;
let appLogPath = "";
let pastRunsPath = "";
let preferencesPath = "";
let windowBoundsPath = "";
let forceExitTimer: NodeJS.Timeout | null = null;
let launchCaptureTimer: NodeJS.Timeout | null = null;
let compactWindowMode = false;
let windowBounds: WindowBoundsPreferences = {};
let saveWindowBoundsTimer: NodeJS.Timeout | null = null;
const archivedSessionStarts = new Set<number>();

interface WindowBoundsPreferences {
  normal?: Rectangle;
  compact?: Rectangle;
}

if (process.platform === "win32") app.setAppUserModelId("com.herosiege.companion");

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

process.on("exit", () => {
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

  mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("moved", scheduleWindowBoundsSave);
  mainWindow.on("resized", scheduleWindowBoundsSave);
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeAppLog("render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    addLog("error", `Renderer stopped unexpectedly: ${details.reason}.`);
  });
}

function resolveIconPath(): string {
  const resourceIconPath = path.join(process.resourcesPath, "icon.ico");
  if (app.isPackaged && fs.existsSync(resourceIconPath)) return resourceIconPath;
  return path.join(app.getAppPath(), "icon.ico");
}

function applyCaptureUpdate(update: CaptureUpdate): void {
  if (update.running !== undefined) state.captureRunning = update.running;
  if (update.status) state.captureStatus = update.status;
  if (update.error !== undefined) state.captureError = update.error;
  if (update.connections) state.connections = update.connections;
  if (update.health) state.health = { ...state.health, ...update.health };

  if (update.events?.length) {
    state.stats = statsEngine.applyEvents(update.events);
  }

  if (update.log) addLog(update.log.level, update.log.message);
  publishState();
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("state:updated", state);
}

ipcMain.handle("state:get", () => state);
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
  const debugLogPath = path.join(app.getPath("userData"), "capture-debug.log");
  state.pastRuns = loadPastRuns();
  state.runArchivePreferences = loadRunArchivePreferences();
  windowBounds = loadWindowBounds();
  writeAppLog("app-ready", { appLogPath, debugLogPath, pastRunsPath, preferencesPath, windowBoundsPath });
  captureService = new CaptureService(applyCaptureUpdate, debugLogPath);
  state.health = { ...state.health, ...(await captureService.diagnostics()) };
  createWindow();
  addLog("info", "Hero Siege Companion started.");
  addLog("info", `Capture debug log: ${debugLogPath}`);
  if (await captureService.hasHeroSiegeProcess()) {
    await captureService.start();
  } else {
    addLog("info", "Hero Siege is not running yet. Launch the game, wait for the main menu, then click Launch Game.");
    publishState();
  }
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
  shutdownCapture("before-quit");
});

app.on("will-quit", () => {
  shutdownCapture("will-quit");
});

app.on("window-all-closed", () => {
  shutdownCapture("window-all-closed");
  app.quit();
  scheduleForceExit();
});

function shutdownCapture(reason: string): void {
  writeAppLog("shutdown-capture", { reason });
  clearLaunchCaptureTimer();
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
    writeAppLog("force-exit", {});
    app.exit(0);
  }, 1500);
  forceExitTimer.unref();
}

function archiveCurrentRun(reason: string): boolean {
  if (!pastRunsPath) return false;
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
    const parsed = JSON.parse(fs.readFileSync(preferencesPath, "utf8")) as { runArchive?: Partial<RunArchivePreferences> };
    return normalizeRunArchivePreferences(parsed.runArchive ?? {});
  } catch (error) {
    writeAppLog("preferences-load-error", { error: error instanceof Error ? error.message : String(error) });
    return DEFAULT_RUN_ARCHIVE_PREFERENCES;
  }
}

function saveRunArchivePreferences(preferences: RunArchivePreferences): void {
  try {
    fs.writeFileSync(preferencesPath, `${JSON.stringify({ runArchive: preferences }, null, 2)}\n`, "utf8");
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
