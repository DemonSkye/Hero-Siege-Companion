import { afterEach, describe, expect, test, vi } from "vitest";
const shell = vi.hoisted(() => ({ openExternal: vi.fn(), openPath: vi.fn() }));
vi.mock("electron", () => ({ shell }));
import { GameCaptureCoordinator } from "../../src/main/game-capture-coordinator";
import { createInitialCompanionState } from "../../src/shared/initial-state";
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function fixture() {
  vi.useFakeTimers();
  const service = { hasHeroSiegeProcess: vi.fn(async () => false), start: vi.fn(async () => {}), stop: vi.fn(),
    diagnostics: vi.fn(async () => ({})), setCapturePreferences: vi.fn() };
  const beforeCapture = vi.fn(async () => true), addLog = vi.fn();
  const launchExecutable = vi.fn(async () => {});
  const coordinator = new GameCaptureCoordinator({ state: createInitialCompanionState(), getCaptureService: () => service,
    beforeCapture, launchExecutable, addLog, publishState: vi.fn(), writeAppLog: vi.fn() });
  return { service, beforeCapture, launchExecutable, coordinator, addLog };
}
afterEach(() => vi.useRealTimers());
describe("launch and capture coordination with mocked Electron", () => {
  test.each([true, false])("listener failure blocks launch (Steam=%s) without a false watching log", async steam => {
    const f = fixture(); f.beforeCapture.mockResolvedValue(false);
    await f.coordinator.launchOrCapture({ launchThroughSteam: steam });
    expect(shell.openExternal).not.toHaveBeenCalled(); expect(shell.openPath).not.toHaveBeenCalled();
    expect(f.launchExecutable).not.toHaveBeenCalled();
    expect(f.addLog.mock.calls.map(call => call[1]).join()).toContain("launch paused");
    expect(f.addLog.mock.calls.map(call => call[1]).join()).not.toContain("Capture is watching");
  });
  test.each([true, false])("Stop while opening the listener cancels launch (Steam=%s)", async steam => {
    const f = fixture(); let release!: (opened: boolean) => void;
    f.beforeCapture.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const launch = f.coordinator.launchOrCapture({ launchThroughSteam: steam });
    await flush(); f.coordinator.setCaptureEnabled(false); release(true); await launch;
    expect(shell.openExternal).not.toHaveBeenCalled(); expect(shell.openPath).not.toHaveBeenCalled();
    expect(f.launchExecutable).not.toHaveBeenCalled();
    expect(f.addLog).toHaveBeenCalledWith("info", "Game launch cancelled.");
  });
  test("an explicitly disabled feature permits launch without requiring a listener", async () => {
    const f = fixture(); shell.openExternal.mockResolvedValue(undefined);
    // Main maps intentional saved Off to a successful no-listener prerequisite.
    f.beforeCapture.mockResolvedValue(true);
    await f.coordinator.launchOrCapture({ launchThroughSteam: true });
    expect(shell.openExternal).toHaveBeenCalledTimes(1); f.coordinator.clearLaunchCaptureTimer();
  });
  test("an existing game waits for listener readiness before starting gameplay capture", async () => {
    const f = fixture(); f.service.hasHeroSiegeProcess.mockResolvedValue(true);
    let release!: () => void; f.beforeCapture.mockImplementation(() => new Promise(resolve => { release = () => resolve(true); }));
    const request = f.coordinator.launchOrCapture({ launchThroughSteam: true }); await flush();
    expect(f.service.start).not.toHaveBeenCalled(); release(); await request;
    expect(f.service.start).toHaveBeenCalledTimes(1); expect(shell.openExternal).not.toHaveBeenCalled();
  });
  test("Stop during process discovery prevents the monitor from restarting capture", async () => {
    const f = fixture(); let release!: (found: boolean) => void;
    f.service.hasHeroSiegeProcess.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.coordinator.startMonitor(); await flush(); f.coordinator.setCaptureEnabled(false); release(true); await flush();
    await vi.advanceTimersByTimeAsync(24_000);
    expect(f.beforeCapture).not.toHaveBeenCalled(); expect(f.service.start).not.toHaveBeenCalled(); f.coordinator.stopMonitor();
  });
  test("Stop during listener opening prevents a pending monitor start", async () => {
    const f = fixture(); f.service.hasHeroSiegeProcess.mockResolvedValue(true); let release!: () => void;
    f.beforeCapture.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(true); }));
    f.coordinator.startMonitor(); await flush(); f.coordinator.setCaptureEnabled(false); release(); await flush();
    expect(f.service.start).not.toHaveBeenCalled(); f.coordinator.stopMonitor();
  });
  test("a manual stop remains stopped across game-monitor ticks until an explicit launch", async () => {
    const f = fixture(); f.service.hasHeroSiegeProcess.mockResolvedValue(true);
    f.coordinator.setCaptureEnabled(false); f.coordinator.startMonitor();
    await vi.advanceTimersByTimeAsync(36_000);
    expect(f.service.start).not.toHaveBeenCalled();
    await f.coordinator.launchOrCapture({ launchThroughSteam: true });
    expect(f.service.start).toHaveBeenCalledTimes(1); f.coordinator.stopMonitor();
  });
  test("Stop during launch discovery of a running game does not re-arm the listener", async () => {
    const f = fixture(); let release!: (found: boolean) => void;
    f.service.hasHeroSiegeProcess.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const launch = f.coordinator.launchOrCapture({ launchThroughSteam: true });
    await flush(); f.coordinator.setCaptureEnabled(false); release(true); await launch;
    expect(f.beforeCapture).not.toHaveBeenCalled(); expect(f.service.start).not.toHaveBeenCalled();
  });
  test("monitor disposal suppresses a pending discovery's late start", async () => {
    const f = fixture(); let release!: (found: boolean) => void;
    f.service.hasHeroSiegeProcess.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.coordinator.startMonitor(); await flush(); f.coordinator.stopMonitor(); release(true); await flush();
    expect(f.beforeCapture).not.toHaveBeenCalled(); expect(f.service.start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  test("monitor disposal during listener opening suppresses the late start", async () => {
    const f = fixture(); f.service.hasHeroSiegeProcess.mockResolvedValue(true); let release!: () => void;
    f.beforeCapture.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(true); }));
    f.coordinator.startMonitor(); await flush(); f.coordinator.stopMonitor(); release(); await flush();
    expect(f.service.start).not.toHaveBeenCalled();
  });
  test("a monitor discovery failure is reported and retried, but suppressed after Stop", async () => {
    const f = fixture();
    f.service.hasHeroSiegeProcess.mockRejectedValueOnce(new Error("invented discovery failure"));
    f.coordinator.startMonitor(); await flush();
    expect(f.addLog).toHaveBeenCalledWith("warning", expect.stringContaining("next monitor check will retry"));
    f.service.hasHeroSiegeProcess.mockResolvedValueOnce(true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.service.start).toHaveBeenCalledTimes(1);
    f.addLog.mockClear(); let fail!: (error: Error) => void;
    f.service.hasHeroSiegeProcess.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    await vi.advanceTimersByTimeAsync(12_000);
    f.coordinator.setCaptureEnabled(false); fail(new Error("stale discovery failure")); await flush();
    expect(f.addLog).not.toHaveBeenCalled(); f.coordinator.stopMonitor();
  });
  test("failed Steam or executable launches retain passive watching without a scheduled capture start", async () => {
    const f = fixture(); shell.openExternal.mockRejectedValueOnce(new Error("invented launch failure"));
    await f.coordinator.launchOrCapture({ launchThroughSteam: true });
    f.launchExecutable.mockRejectedValueOnce(new Error("invented path failure"));
    await f.coordinator.launchOrCapture({ launchThroughSteam: false });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(f.beforeCapture).toHaveBeenCalledTimes(2); expect(f.service.start).not.toHaveBeenCalled();
    expect(f.addLog.mock.calls.filter(call => call[0] === "error")).toHaveLength(2);
  });
});
