import type { BrowserWindow } from "electron";
import fs from "node:fs";
import type { CompanionState, LogEntry } from "../shared/app-state";

const DEFAULT_APP_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_SESSION_HEARTBEAT_MS = 15_000;
const DEFAULT_DIAGNOSTIC_HEARTBEAT_MS = 30_000;

export interface AppDiagnosticsSnapshot {
  state: CompanionState;
  logs: LogEntry[];
  pendingCaptureEvents: number;
  mainWindow: BrowserWindow | null;
}

export interface AppDiagnosticsOptions {
  appLogPath: string;
  appSessionPath: string;
  appVersion: string;
  sessionId?: string;
  startedAt?: string;
  sessionHeartbeatMs?: number;
  diagnosticHeartbeatMs?: number;
  appLogMaxBytes?: number;
  getSnapshot: () => AppDiagnosticsSnapshot;
}

export interface AppDiagnostics {
  writeLog(type: string, data: Record<string, unknown>): void;
  logPreviousSession(): void;
  startSessionHeartbeat(): void;
  stopSessionHeartbeat(): void;
  startDiagnosticHeartbeat(): void;
  stopDiagnosticHeartbeat(): void;
  writeDiagnosticHeartbeat(): void;
  writeSession(phase: string, extra?: Record<string, unknown>): void;
  markSessionClosed(reason: string): void;
}

export function createAppDiagnostics(options: AppDiagnosticsOptions): AppDiagnostics {
  const sessionId = options.sessionId ?? `${Date.now()}-${process.pid}`;
  const startedAt = options.startedAt ?? new Date().toISOString();
  const sessionHeartbeatMs = options.sessionHeartbeatMs ?? DEFAULT_SESSION_HEARTBEAT_MS;
  const diagnosticHeartbeatMs = options.diagnosticHeartbeatMs ?? DEFAULT_DIAGNOSTIC_HEARTBEAT_MS;
  const appLogMaxBytes = options.appLogMaxBytes ?? DEFAULT_APP_LOG_MAX_BYTES;
  let sessionHeartbeatTimer: NodeJS.Timeout | null = null;
  let diagnosticHeartbeatTimer: NodeJS.Timeout | null = null;

  function writeLog(type: string, data: Record<string, unknown>): void {
    if (!options.appLogPath) return;
    try {
      rotateLogIfLarge(options.appLogPath, appLogMaxBytes);
      fs.appendFileSync(options.appLogPath, `${JSON.stringify({ at: new Date().toISOString(), ...data, type })}\n`, "utf8");
    } catch {
      // Crash diagnostics must never become the crash.
    }
  }

  function logPreviousSession(): void {
    try {
      if (!fs.existsSync(options.appSessionPath)) return;
      const previous = JSON.parse(fs.readFileSync(options.appSessionPath, "utf8")) as Record<string, unknown>;
      if (previous.phase === "closed" || previous.closedAt) return;
      writeLog("previous-non-graceful-exit", {
        previousSessionId: previous.sessionId,
        previousPid: previous.pid,
        previousPhase: previous.phase,
        previousStartedAt: previous.startedAt,
        previousLastHeartbeatAt: previous.lastHeartbeatAt,
        previousShutdownReason: previous.shutdownReason,
      });
    } catch (error) {
      writeLog("previous-session-read-error", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function startSessionHeartbeat(): void {
    writeSession("started");
    stopSessionHeartbeat();
    sessionHeartbeatTimer = setInterval(() => writeSession("heartbeat"), sessionHeartbeatMs);
    sessionHeartbeatTimer.unref();
  }

  function stopSessionHeartbeat(): void {
    if (!sessionHeartbeatTimer) return;
    clearInterval(sessionHeartbeatTimer);
    sessionHeartbeatTimer = null;
  }

  function startDiagnosticHeartbeat(): void {
    stopDiagnosticHeartbeat();
    diagnosticHeartbeatTimer = setInterval(writeDiagnosticHeartbeat, diagnosticHeartbeatMs);
    diagnosticHeartbeatTimer.unref();
    writeDiagnosticHeartbeat();
  }

  function stopDiagnosticHeartbeat(): void {
    if (!diagnosticHeartbeatTimer) return;
    clearInterval(diagnosticHeartbeatTimer);
    diagnosticHeartbeatTimer = null;
  }

  function writeDiagnosticHeartbeat(): void {
    const snapshot = options.getSnapshot();
    const memory = process.memoryUsage();
    writeLog("app-heartbeat", {
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
      version: options.appVersion,
      runtime: runtimeVersionSnapshot(),
      captureRunning: snapshot.state.captureRunning,
      captureStatus: snapshot.state.captureStatus,
      captureError: snapshot.state.captureError,
      connectionCount: snapshot.state.connections.length,
      pendingCaptureEvents: snapshot.pendingCaptureEvents,
      logRows: snapshot.logs.length,
      health: snapshot.state.health,
      stats: {
        lastEventAt: snapshot.state.stats.lastEventAt,
        itemTimeline: snapshot.state.stats.itemTimeline.length,
        totalGoldEarned: snapshot.state.stats.totalGoldEarned,
        totalXpEarned: snapshot.state.stats.totalXpEarned,
      },
      renderer: windowSnapshot(snapshot.mainWindow),
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
    });
  }

  function markSessionClosed(reason: string): void {
    writeSession("closed", { closedAt: new Date().toISOString(), shutdownReason: reason });
  }

  function writeSession(phase: string, extra: Record<string, unknown> = {}): void {
    if (!options.appSessionPath) return;
    try {
      fs.writeFileSync(
        options.appSessionPath,
        `${JSON.stringify(
          {
            sessionId,
            pid: process.pid,
            startedAt,
            lastHeartbeatAt: new Date().toISOString(),
            phase,
            version: options.appVersion,
            platform: process.platform,
            arch: process.arch,
            electronVersion: process.versions.electron ?? "unknown",
            nodeVersion: process.versions.node,
            nodeModulesAbi: process.versions.modules,
            chromeVersion: process.versions.chrome ?? "unknown",
            ...extra,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } catch (error) {
      writeLog("app-session-write-error", { phase, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    writeLog,
    logPreviousSession,
    startSessionHeartbeat,
    stopSessionHeartbeat,
    startDiagnosticHeartbeat,
    stopDiagnosticHeartbeat,
    writeDiagnosticHeartbeat,
    writeSession,
    markSessionClosed,
  };
}

function runtimeVersionSnapshot(): Record<string, string> {
  return {
    electron: process.versions.electron ?? "unknown",
    node: process.versions.node,
    nodeModulesAbi: process.versions.modules,
    chrome: process.versions.chrome ?? "unknown",
  };
}

function windowSnapshot(window: BrowserWindow | null): Record<string, unknown> | null {
  if (!window) return null;
  return {
    id: window.id,
    destroyed: window.isDestroyed(),
    visible: !window.isDestroyed() ? window.isVisible() : false,
    focused: !window.isDestroyed() ? window.isFocused() : false,
    minimized: !window.isDestroyed() ? window.isMinimized() : false,
    bounds: !window.isDestroyed() ? window.getBounds() : null,
    url: !window.isDestroyed() ? window.webContents.getURL() : null,
  };
}

function rotateLogIfLarge(logPath: string, maxBytes: number): void {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size <= maxBytes) return;

  const rotatedPath = `${logPath}.old`;
  if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
  fs.renameSync(logPath, rotatedPath);
}
