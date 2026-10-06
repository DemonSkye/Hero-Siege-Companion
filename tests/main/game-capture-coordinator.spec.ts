import fs from "node:fs";
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
  const coordinator = new GameCaptureCoordinator({ state: createInitialCompanionState(), getCaptureService: () => service,
    beforeCapture, addLog, publishState: vi.fn(), writeAppLog: vi.fn() });
  return { service, beforeCapture, coordinator, addLog };
}
afterEach(() => vi.useRealTimers());
describe("launch and capture coordination with mocked Electron", () => {
  test("an existing game waits for listener readiness before starting gameplay capture", async () => {
    const f = fixture(); f.service.hasHeroSiegeProcess.mockResolvedValue(true);
    let release!: () => void; f.beforeCapture.mockImplementation(() => new Promise(resolve => { release = () => resolve(true); }));
    const request = f.coordinator.launchOrCapture({ launchThroughSteam: true, executablePath: "" }); await flush();
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
  test("failed Steam or executable launches retain passive watching without a scheduled capture start", async () => {
    const f = fixture(); shell.openExternal.mockRejectedValueOnce(new Error("invented launch failure"));
    await f.coordinator.launchOrCapture({ launchThroughSteam: true, executablePath: "" });
    vi.spyOn(fs, "existsSync").mockReturnValue(true); shell.openPath.mockResolvedValueOnce("invented path failure");
    await f.coordinator.launchOrCapture({ launchThroughSteam: false, executablePath: "invented.exe" });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(f.beforeCapture).toHaveBeenCalledTimes(2); expect(f.service.start).not.toHaveBeenCalled();
    expect(f.addLog.mock.calls.filter(call => call[0] === "error")).toHaveLength(2);
  });
});
