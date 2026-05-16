import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { CaptureService, type CaptureUpdate } from "./capture";
import type { CompanionState, LogEntry } from "../shared/app-state";
import { createInitialStats, StatsEngine } from "../shared/stats";

const statsEngine = new StatsEngine();
const logs: LogEntry[] = [];
const MAX_APP_LOG_BYTES = 2 * 1024 * 1024;

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
  logs,
};

let mainWindow: BrowserWindow | null = null;
let captureService: CaptureService | null = null;
let appLogPath = "";
let forceExitTimer: NodeJS.Timeout | null = null;

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
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
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
  await captureService?.start();
  return state;
});
ipcMain.handle("capture:stop", () => {
  captureService?.stop();
  return state;
});
ipcMain.handle("stats:reset", () => {
  state.stats = statsEngine.reset();
  addLog("info", "Session stats reset.");
  publishState();
  return state;
});
ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});
ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

app.whenReady().then(async () => {
  appLogPath = path.join(app.getPath("userData"), "app-debug.log");
  const debugLogPath = path.join(app.getPath("userData"), "capture-debug.log");
  writeAppLog("app-ready", { appLogPath, debugLogPath });
  captureService = new CaptureService(applyCaptureUpdate, debugLogPath);
  state.health = { ...state.health, ...(await captureService.diagnostics()) };
  createWindow();
  addLog("info", "Hero Siege Companion started.");
  addLog("info", `Capture debug log: ${debugLogPath}`);
  await captureService.start();
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
