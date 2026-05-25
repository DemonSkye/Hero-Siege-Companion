import { BrowserWindow, nativeImage, shell } from "electron";
import { saveWindowBounds, withMinimumBounds, type WindowBoundsPreferences } from "./persistence";
import type { LogEntry } from "../shared/app-state";

const NORMAL_WINDOW_BOUNDS = { width: 1180, height: 760, minWidth: 980, minHeight: 620 };
const COMPACT_WINDOW_BOUNDS = { width: 420, height: 220, minWidth: 340, minHeight: 160 };
const RENDERER_RECOVERY_DELAY_MS = 500;
const MAX_RENDERER_RECOVERIES = 3;
const RENDERER_RECOVERY_WINDOW_MS = 60_000;
const WINDOW_BOUNDS_SAVE_DELAY_MS = 250;

interface CaptureSnapshot {
  captureStatus: string;
  captureRunning: boolean;
}

interface MainWindowManagerOptions {
  preloadPath: string;
  rendererIndexPath: string;
  iconPath: string;
  windowBoundsPath: string;
  windowBounds: WindowBoundsPreferences;
  writeAppLog: (type: string, data: Record<string, unknown>) => void;
  addLog: (level: LogEntry["level"], message: string) => void;
  publishStateNow: () => void;
  getCaptureSnapshot: () => CaptureSnapshot;
}

export class MainWindowManager {
  private mainWindow: BrowserWindow | null = null;
  private compactWindowMode = false;
  private saveWindowBoundsTimer: NodeJS.Timeout | null = null;
  private rendererRecoveryTimer: NodeJS.Timeout | null = null;
  private rendererRecoveryWindowStartedAt = 0;
  private rendererRecoveriesInWindow = 0;

  constructor(private readonly options: MainWindowManagerOptions) {}

  get window(): BrowserWindow | null {
    return this.mainWindow;
  }

  get isCompactMode(): boolean {
    return this.compactWindowMode;
  }

  create(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.focusExistingWindow();
      return this.mainWindow;
    }

    this.mainWindow = new BrowserWindow({
      width: NORMAL_WINDOW_BOUNDS.width,
      height: NORMAL_WINDOW_BOUNDS.height,
      minWidth: NORMAL_WINDOW_BOUNDS.minWidth,
      minHeight: NORMAL_WINDOW_BOUNDS.minHeight,
      autoHideMenuBar: true,
      backgroundColor: "#101217",
      frame: false,
      icon: nativeImage.createFromPath(this.options.iconPath),
      title: "Hero Siege Companion",
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        // The preload imports compiled shared IPC contracts. Electron's sandboxed
        // preload resolver cannot load sibling app modules from the packaged ASAR.
        sandbox: false,
      },
    });

    this.attachWindowHandlers(this.mainWindow);
    this.loadRenderer(this.mainWindow);
    this.options.writeAppLog("window-created", { id: this.mainWindow.id, bounds: this.mainWindow.getBounds() });
    return this.mainWindow;
  }

  focusExistingWindow(): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  }

  minimize(): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;
    window.minimize();
  }

  toggleMaximize(): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;
    if (this.compactWindowMode) {
      this.setCompactMode(false);
      return;
    }
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }

  close(): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;
    window.close();
  }

  setAlwaysOnTop(enabled: boolean): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(enabled, "screen-saver");
    if (!enabled) return;
    window.show();
    window.moveTop();
    window.focus();
  }

  setCompactMode(enabled: boolean, lockPositions = false): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;

    if (this.compactWindowMode === enabled) {
      window.setMaximizable(!enabled);
      if (lockPositions) this.restoreWindowBounds(enabled ? "compact" : "normal");
      if (window.isAlwaysOnTop()) window.moveTop();
      return;
    }

    this.saveCurrentWindowBounds();
    this.compactWindowMode = enabled;
    const bounds = enabled ? COMPACT_WINDOW_BOUNDS : NORMAL_WINDOW_BOUNDS;
    if (window.isMaximized()) window.unmaximize();
    window.setMaximizable(!enabled);
    window.setMinimumSize(bounds.minWidth, bounds.minHeight);
    if (!lockPositions || !this.restoreWindowBounds(enabled ? "compact" : "normal")) {
      window.setSize(bounds.width, bounds.height, true);
    }
    if (window.isAlwaysOnTop()) window.moveTop();
  }

  saveCurrentWindowBounds(): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed() || window.isMinimized()) return;
    this.options.windowBounds[this.compactWindowMode ? "compact" : "normal"] = window.getBounds();
    saveWindowBounds(this.options.windowBoundsPath, this.options.windowBounds, this.options.writeAppLog);
  }

  private attachWindowHandlers(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (this.isExternalWebUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });

    window.on("close", () => {
      this.options.writeAppLog("window-close", { id: window.id, ...this.options.getCaptureSnapshot() });
    });
    window.on("closed", () => {
      this.options.writeAppLog("window-closed", {});
      this.mainWindow = null;
    });
    window.on("moved", () => this.scheduleWindowBoundsSave());
    window.on("resized", () => this.scheduleWindowBoundsSave());
    window.webContents.on("unresponsive", () => {
      this.options.writeAppLog("renderer-unresponsive", this.rendererSnapshot(window));
      this.options.addLog("warning", "Renderer became unresponsive.");
    });
    window.webContents.on("responsive", () => {
      this.options.writeAppLog("renderer-responsive", this.rendererSnapshot(window));
      this.options.addLog("info", "Renderer became responsive again.");
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.options.writeAppLog("renderer-did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
    });
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      this.options.writeAppLog("renderer-preload-error", { preloadPath, message: error.message, stack: error.stack });
      this.options.addLog("error", `Renderer preload failed: ${error.message}`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      this.options.writeAppLog("render-process-gone", {
        ...this.rendererSnapshot(window),
        reason: details.reason,
        exitCode: details.exitCode,
      });
      this.options.addLog("error", `Renderer stopped unexpectedly: ${details.reason}.`);
      this.scheduleRendererRecovery(details.reason);
    });
  }

  private loadRenderer(window: BrowserWindow): void {
    window.loadFile(this.options.rendererIndexPath);
  }

  private isExternalWebUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }

  private scheduleRendererRecovery(reason: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || this.rendererRecoveryTimer) return;
    if (reason === "clean-exit" || reason === "killed") return;

    const now = Date.now();
    if (now - this.rendererRecoveryWindowStartedAt > RENDERER_RECOVERY_WINDOW_MS) {
      this.rendererRecoveryWindowStartedAt = now;
      this.rendererRecoveriesInWindow = 0;
    }

    this.rendererRecoveriesInWindow += 1;
    if (this.rendererRecoveriesInWindow > MAX_RENDERER_RECOVERIES) {
      this.options.writeAppLog("renderer-recovery-skipped", { reason, rendererRecoveriesInWindow: this.rendererRecoveriesInWindow });
      this.options.addLog("error", "Renderer crashed repeatedly; automatic recovery paused.");
      return;
    }

    this.options.writeAppLog("renderer-recovery-scheduled", { reason, rendererRecoveriesInWindow: this.rendererRecoveriesInWindow });
    this.rendererRecoveryTimer = setTimeout(() => {
      this.rendererRecoveryTimer = null;
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
      this.loadRenderer(this.mainWindow);
      this.options.publishStateNow();
      this.options.addLog("warning", "Recovered the app window after a renderer crash.");
    }, RENDERER_RECOVERY_DELAY_MS);
    this.rendererRecoveryTimer.unref();
  }

  private restoreWindowBounds(mode: keyof WindowBoundsPreferences): boolean {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return false;
    const minimums = mode === "compact" ? COMPACT_WINDOW_BOUNDS : NORMAL_WINDOW_BOUNDS;
    const bounds = withMinimumBounds(this.options.windowBounds[mode], minimums);
    if (!bounds) return false;
    window.setBounds(bounds, true);
    return true;
  }

  private scheduleWindowBoundsSave(): void {
    if (this.saveWindowBoundsTimer) clearTimeout(this.saveWindowBoundsTimer);
    this.saveWindowBoundsTimer = setTimeout(() => {
      this.saveWindowBoundsTimer = null;
      this.saveCurrentWindowBounds();
    }, WINDOW_BOUNDS_SAVE_DELAY_MS);
  }

  private rendererSnapshot(window: BrowserWindow): Record<string, unknown> {
    const destroyed = window.isDestroyed();
    return {
      windowId: window.id,
      webContentsId: destroyed ? null : window.webContents.id,
      url: destroyed ? null : window.webContents.getURL(),
    };
  }
}
