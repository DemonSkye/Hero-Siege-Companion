import { afterEach, describe, expect, test, vi } from "vitest";
import { GameCaptureCoordinator } from "../../src/main/game-capture-coordinator";
import { createInitialCompanionState } from "../../src/shared/initial-state";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined), openPath: vi.fn().mockResolvedValue("") } }));

afterEach(() => vi.useRealTimers());

describe("game capture intent", () => {
  test("a manual stop remains stopped across game-monitor ticks", async () => {
    vi.useFakeTimers();
    const state = createInitialCompanionState();
    state.captureRunning = true;
    const service = {
      hasHeroSiegeProcess: vi.fn().mockResolvedValue(true),
      start: vi.fn(async () => { state.captureRunning = true; }),
      stop: vi.fn(() => { state.captureRunning = false; }),
      diagnostics: vi.fn(), setCapturePreferences: vi.fn(),
    };
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service, addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    coordinator.startMonitor();
    coordinator.stopCapture();
    await vi.advanceTimersByTimeAsync(24_000);
    expect(service.start).not.toHaveBeenCalled();
    expect(state.captureRunning).toBe(false);
    coordinator.stopMonitor();
  });

  test("an explicit restart opts back into capture after a manual stop", async () => {
    const state = createInitialCompanionState();
    const service = { hasHeroSiegeProcess: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn(), diagnostics: vi.fn(), setCapturePreferences: vi.fn() };
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service, addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    coordinator.stopCapture();
    await coordinator.startCapture();
    expect(service.start).toHaveBeenCalledOnce();
  });

  test("stopping while a monitor discovery is pending suppresses its late start", async () => {
    vi.useFakeTimers();
    let completeDiscovery!: (value: boolean) => void;
    const state = createInitialCompanionState();
    const service = { hasHeroSiegeProcess: vi.fn().mockReturnValue(new Promise<boolean>((resolve) => { completeDiscovery = resolve; })), start: vi.fn(), stop: vi.fn(), diagnostics: vi.fn(), setCapturePreferences: vi.fn() };
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service, addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    coordinator.startMonitor();
    coordinator.stopCapture();
    completeDiscovery(true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(service.start).not.toHaveBeenCalled();
    coordinator.stopMonitor();
  });

  test("eligible startup still starts capture and monitor disposal suppresses pending work", async () => {
    vi.useFakeTimers();
    const state = createInitialCompanionState();
    const service = { hasHeroSiegeProcess: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn(), diagnostics: vi.fn(), setCapturePreferences: vi.fn() };
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service, addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    coordinator.startMonitor();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.start).toHaveBeenCalledOnce();
    coordinator.stopMonitor();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("startup without the game preserves launch guidance", async () => {
    vi.useFakeTimers();
    const state = createInitialCompanionState();
    const service = { hasHeroSiegeProcess: vi.fn().mockResolvedValue(false), start: vi.fn(), stop: vi.fn(), diagnostics: vi.fn(), setCapturePreferences: vi.fn() };
    const addLog = vi.fn();
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service, addLog, publishState: vi.fn(), writeAppLog: vi.fn() });
    coordinator.startMonitor();
    await vi.advanceTimersByTimeAsync(24_000);
    expect(addLog).toHaveBeenCalledExactlyOnceWith("info", "Hero Siege is not running yet. Launch the game, wait for the main menu, then click Launch Game.");
    expect(service.start).not.toHaveBeenCalled();
    coordinator.stopMonitor();
  });

  test("stopping suppresses a late monitor discovery failure", async () => {
    vi.useFakeTimers();
    let failDiscovery!: (error: Error) => void;
    const state = createInitialCompanionState();
    const service = { hasHeroSiegeProcess: vi.fn().mockReturnValue(new Promise<boolean>((_resolve, reject) => { failDiscovery = reject; })), start: vi.fn(), stop: vi.fn(), diagnostics: vi.fn(), setCapturePreferences: vi.fn() };
    const addLog = vi.fn();
    const publishState = vi.fn();
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service, addLog, publishState, writeAppLog: vi.fn() });
    coordinator.startMonitor();
    coordinator.stopCapture();
    failDiscovery(new Error("stale discovery"));
    await vi.advanceTimersByTimeAsync(0);
    expect(addLog).not.toHaveBeenCalled();
    expect(publishState).not.toHaveBeenCalled();
    coordinator.stopMonitor();
  });
});
