import { shell } from "electron";
import type { CaptureRuntime } from "./capture-runtime";
import type { CompanionState, LogEntry } from "../shared/app-state";
import type { LaunchGameOptions } from "../shared/ipc";

const STEAM_HERO_SIEGE_URL = "steam://rungameid/269210";
const LAUNCH_CAPTURE_DELAY_MS = 45_000;
const GAME_PROCESS_MONITOR_MS = 12_000;

interface GameCaptureCoordinatorOptions {
  state: CompanionState;
  getCaptureService: () => CaptureRuntime | null;
  addLog: (level: LogEntry["level"], message: string) => void;
  publishState: () => void;
  writeAppLog: (type: string, data: Record<string, unknown>) => void;
  beforeCapture?: () => Promise<boolean>;
  launchExecutable?: (authorized: () => boolean) => Promise<void>;
}

export class GameCaptureCoordinator {
  captureEnabled = true;
  private launchCaptureTimer: NodeJS.Timeout | null = null;
  private gameProcessMonitorTimer: NodeJS.Timeout | null = null;
  private gameProcessMonitorActive = false;
  private lastGameProcessAutoStartLogAt = 0;

  constructor(private readonly options: GameCaptureCoordinatorOptions) {}

  async launchOrCapture(launchOptions: LaunchGameOptions, authorized: () => boolean = () => true): Promise<CompanionState> {
    this.options.writeAppLog("game-launch-stage", { stage: "requested", throughSteam: launchOptions?.launchThroughSteam === true });
    this.captureEnabled = true;
    const service = this.options.getCaptureService();
    if (service && (await service.hasHeroSiegeProcess())) {
      if (!authorized()) return this.options.state;
      this.options.writeAppLog("game-launch-stage", { stage: "game_present" });
      this.clearLaunchCaptureTimer();
      if (!this.captureEnabled) return this.options.state;
      await this.options.beforeCapture?.();
      if (this.captureEnabled && authorized()) await service.start();
      return this.options.state;
    }

    if (launchOptions?.launchThroughSteam) {
      await this.launchThroughSteam(authorized);
    } else {
      await this.launchExecutable(authorized);
    }

    this.options.publishState();
    return this.options.state;
  }

  clearLaunchCaptureTimer(): void {
    if (!this.launchCaptureTimer) return;
    clearTimeout(this.launchCaptureTimer);
    this.launchCaptureTimer = null;
  }
  setCaptureEnabled(enabled: boolean): void { this.captureEnabled = enabled; if (!enabled) this.clearLaunchCaptureTimer(); }

  startMonitor(): void {
    if (this.gameProcessMonitorTimer) return;
    this.gameProcessMonitorTimer = setInterval(() => {
      void this.syncCaptureToGameProcess("monitor");
    }, GAME_PROCESS_MONITOR_MS);
    this.gameProcessMonitorTimer.unref();
    void this.syncCaptureToGameProcess("startup");
  }

  stopMonitor(): void {
    if (!this.gameProcessMonitorTimer) return;
    clearInterval(this.gameProcessMonitorTimer);
    this.gameProcessMonitorTimer = null;
  }

  private async launchThroughSteam(authorized: () => boolean): Promise<void> {
    try {
      if (!await this.prepareForLaunch() || !authorized()) return;
      this.options.writeAppLog("game-launch-stage", { stage: "shell_invoked", throughSteam: true });
      await shell.openExternal(STEAM_HERO_SIEGE_URL);
      this.options.addLog("info", "Launched Hero Siege through Steam. Capture is watching for the game.");
      this.scheduleLaunchCaptureAttempt();
    } catch (error) {
      this.options.addLog("error", `Failed to launch Hero Siege through Steam: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async launchExecutable(authorized: () => boolean): Promise<void> {
    try {
      if (!await this.prepareForLaunch() || !authorized()) return;
      if (!this.options.launchExecutable) throw new Error("Choose the Hero Siege executable with Browse in Settings first.");
      await this.options.launchExecutable(() => authorized() && this.captureEnabled);
      this.options.writeAppLog("game-launch-stage", { stage: "executable_started", throughSteam: false });
      this.options.addLog("info", "Launched Hero Siege. Capture is watching for the game.");
      this.scheduleLaunchCaptureAttempt();
    } catch (error) {
      this.options.addLog("error", error instanceof Error ? error.message : "Could not launch the selected Hero Siege executable.");
    }
  }

  private async prepareForLaunch(): Promise<boolean> {
    let opened = false;
    try { opened = await this.options.beforeCapture?.() ?? true; } catch {}
    this.options.writeAppLog("game-launch-stage", { stage: "listener_checked", refreshEnabled: this.options.state.satanicZone.refreshEnabled,
      opened, captureEnabled: this.captureEnabled });
    if (!this.captureEnabled) {
      this.options.addLog("info", "Game launch cancelled."); return false;
    }
    if (!opened) {
      this.options.addLog("warning", "Game launch paused because SZ Refresh could not start watching. Try again, or turn off SZ Refresh in Settings.");
      return false;
    }
    return true;
  }

  private scheduleLaunchCaptureAttempt(): void {
    this.clearLaunchCaptureTimer();
    if (!this.captureEnabled) return;
    this.launchCaptureTimer = setTimeout(() => {
      this.launchCaptureTimer = null;
      void this.attemptCaptureAfterLaunch();
    }, LAUNCH_CAPTURE_DELAY_MS);
    this.launchCaptureTimer.unref();
  }

  private async attemptCaptureAfterLaunch(): Promise<void> {
    const service = this.options.getCaptureService();
    if (!service || !this.captureEnabled || this.options.state.captureRunning) return;
    this.options.addLog("info", "Checking for Hero Siege after launch delay.");
    await service.start();
    this.options.publishState();
  }

  private async syncCaptureToGameProcess(source: string): Promise<void> {
    const service = this.options.getCaptureService();
    if (!service || !this.captureEnabled || this.options.state.captureRunning || this.gameProcessMonitorActive) return;
    this.gameProcessMonitorActive = true;
    try {
      if (!(await service.hasHeroSiegeProcess()) || !this.monitorEligible()) return;
      this.options.writeAppLog("game-process-detected", { source, captureStatus: this.options.state.captureStatus });
      const now = Date.now();
      if (now - this.lastGameProcessAutoStartLogAt > 60_000) {
        this.lastGameProcessAutoStartLogAt = now;
        this.options.addLog("info", "Hero Siege is running; starting capture automatically.");
      }
      this.clearLaunchCaptureTimer();
      await this.options.beforeCapture?.();
      if (!this.monitorEligible()) return;
      await service.start();
      this.options.publishState();
    } catch {
      if (!this.monitorEligible()) return;
      this.options.addLog("warning", "Could not inspect Hero Siege for automatic capture. The next monitor check will retry.");
      this.options.publishState();
    } finally {
      this.gameProcessMonitorActive = false;
    }
  }

  private monitorEligible(): boolean {
    return this.captureEnabled && this.gameProcessMonitorTimer !== null;
  }
}
