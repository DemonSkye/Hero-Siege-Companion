import { shell } from "electron";
import fs from "node:fs";
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
}

export class GameCaptureCoordinator {
  private launchCaptureTimer: NodeJS.Timeout | null = null;
  private gameProcessMonitorTimer: NodeJS.Timeout | null = null;
  private gameProcessMonitorActive = false;
  private lastGameProcessAutoStartLogAt = 0;
  private manualCaptureStopped = false;
  private generation = 0;
  private monitorEnabled = false;

  constructor(private readonly options: GameCaptureCoordinatorOptions) {}

  async launchOrCapture(launchOptions: LaunchGameOptions): Promise<CompanionState> {
    this.manualCaptureStopped = false;
    const generation = ++this.generation;
    const service = this.options.getCaptureService();
    const gameRunning = service && (await service.hasHeroSiegeProcess());
    if (generation !== this.generation) return this.options.state;
    if (service && gameRunning) {
      this.clearLaunchCaptureTimer();
      await service.start();
      return this.options.state;
    }

    if (launchOptions?.launchThroughSteam) {
      await this.launchThroughSteam(generation);
    } else {
      await this.launchExecutable(String(launchOptions?.executablePath ?? "").trim(), generation);
    }

    if (generation === this.generation) this.options.publishState();
    return this.options.state;
  }

  async startCapture(): Promise<void> {
    this.manualCaptureStopped = false;
    this.generation += 1;
    this.clearLaunchCaptureTimer();
    await this.options.getCaptureService()?.start();
  }

  stopCapture(): void {
    // Explicit stop lasts for this Companion process, including game restarts.
    // An explicit Start Capture/Launch Game action opts back into automatic capture.
    this.manualCaptureStopped = true;
    this.generation += 1;
    this.clearLaunchCaptureTimer();
    this.options.getCaptureService()?.stop();
  }

  clearLaunchCaptureTimer(): void {
    if (!this.launchCaptureTimer) return;
    clearTimeout(this.launchCaptureTimer);
    this.launchCaptureTimer = null;
  }

  startMonitor(): void {
    if (this.gameProcessMonitorTimer) return;
    this.monitorEnabled = true;
    this.gameProcessMonitorTimer = setInterval(() => {
      void this.syncCaptureToGameProcess("monitor");
    }, GAME_PROCESS_MONITOR_MS);
    this.gameProcessMonitorTimer.unref();
    void this.syncCaptureToGameProcess("startup");
  }

  stopMonitor(): void {
    this.monitorEnabled = false;
    this.generation += 1;
    if (this.gameProcessMonitorTimer) clearInterval(this.gameProcessMonitorTimer);
    this.gameProcessMonitorTimer = null;
  }

  private async launchThroughSteam(generation: number): Promise<void> {
    try {
      await shell.openExternal(STEAM_HERO_SIEGE_URL);
      if (generation !== this.generation) return;
      this.options.addLog("info", "Launched Hero Siege through Steam. Capture will try to start automatically in about 45 seconds.");
      this.scheduleLaunchCaptureAttempt();
    } catch (error) {
      if (generation !== this.generation) return;
      this.options.addLog("error", `Failed to launch Hero Siege through Steam: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async launchExecutable(executablePath: string, generation: number): Promise<void> {
    if (!executablePath) {
      this.options.addLog("warning", "Hero Siege is not running. Choose a non-Steam Hero Siege executable in Settings, then click Launch Game.");
      this.options.publishState();
      return;
    }

    if (!fs.existsSync(executablePath)) {
      this.options.addLog("error", `Hero Siege executable was not found: ${executablePath}`);
      this.options.publishState();
      return;
    }

    const launchError = await shell.openPath(executablePath);
    if (generation !== this.generation) return;
    if (launchError) {
      this.options.addLog("error", `Failed to launch Hero Siege: ${launchError}`);
      return;
    }

    this.options.addLog("info", "Launched Hero Siege. Capture will try to start automatically in about 45 seconds.");
    this.scheduleLaunchCaptureAttempt();
  }

  private scheduleLaunchCaptureAttempt(): void {
    this.clearLaunchCaptureTimer();
    this.launchCaptureTimer = setTimeout(() => {
      this.launchCaptureTimer = null;
      void this.attemptCaptureAfterLaunch();
    }, LAUNCH_CAPTURE_DELAY_MS);
    this.launchCaptureTimer.unref();
  }

  private async attemptCaptureAfterLaunch(): Promise<void> {
    const service = this.options.getCaptureService();
    if (!service || this.manualCaptureStopped || this.options.state.captureRunning) return;
    this.options.addLog("info", "Checking for Hero Siege after launch delay.");
    await service.start();
    this.options.publishState();
  }

  private async syncCaptureToGameProcess(source: string): Promise<void> {
    const service = this.options.getCaptureService();
    if (!service || !this.monitorEnabled || this.manualCaptureStopped || this.options.state.captureRunning || this.gameProcessMonitorActive) return;
    const generation = this.generation;
    this.gameProcessMonitorActive = true;
    try {
      const gameRunning = await service.hasHeroSiegeProcess();
      if (!this.isCurrentMonitor(generation)) return;
      if (!gameRunning) {
        if (source === "startup") {
          this.options.addLog("info", "Hero Siege is not running yet. Launch the game, wait for the main menu, then click Launch Game.");
          this.options.publishState();
        }
        return;
      }
      this.options.writeAppLog("game-process-detected", { source, captureStatus: this.options.state.captureStatus });
      const now = Date.now();
      if (now - this.lastGameProcessAutoStartLogAt > 60_000) {
        this.lastGameProcessAutoStartLogAt = now;
        this.options.addLog("info", "Hero Siege is running; starting capture automatically.");
      }
      this.clearLaunchCaptureTimer();
      await service.start();
      if (this.isCurrentMonitor(generation)) this.options.publishState();
    } catch {
      if (!this.isCurrentMonitor(generation)) return;
      this.options.addLog("warning", "Could not inspect Hero Siege for automatic capture. The next monitor check will retry.");
      this.options.publishState();
    } finally {
      this.gameProcessMonitorActive = false;
    }
  }

  private isCurrentMonitor(generation: number): boolean {
    return this.monitorEnabled && !this.manualCaptureStopped && generation === this.generation;
  }
}
