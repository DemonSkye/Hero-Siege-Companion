import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createInitialCompanionState } from "../../src/shared/initial-state";
import { createAppDiagnostics } from "../../src/main/app-diagnostics";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function tempPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-diagnostics-"));
  tempDirs.push(dir);
  return dir;
}

describe("app diagnostics", () => {
  test("writes structured app logs and session files", () => {
    const dir = tempPath();
    const diagnostics = createAppDiagnostics({
      appLogPath: path.join(dir, "app-debug.log"),
      appSessionPath: path.join(dir, "app-session.json"),
      appVersion: "0.2.0",
      sessionId: "test-session",
      startedAt: "2026-05-25T00:00:00.000Z",
      getSnapshot: () => ({ state: createInitialCompanionState(), logs: [], pendingCaptureEvents: 0, mainWindow: null }),
    });

    diagnostics.writeLog("custom-event", { ok: true });
    diagnostics.writeSession("closed", { shutdownReason: "test" });

    const log = JSON.parse(fs.readFileSync(path.join(dir, "app-debug.log"), "utf8")) as Record<string, unknown>;
    const session = JSON.parse(fs.readFileSync(path.join(dir, "app-session.json"), "utf8")) as Record<string, unknown>;

    expect(log).toMatchObject({ type: "custom-event", ok: true });
    expect(session).toMatchObject({
      sessionId: "test-session",
      phase: "closed",
      version: "0.2.0",
      nodeVersion: process.versions.node,
      nodeModulesAbi: process.versions.modules,
      shutdownReason: "test",
    });
  });

  test("reports previous non-graceful sessions", () => {
    const dir = tempPath();
    const appLogPath = path.join(dir, "app-debug.log");
    const appSessionPath = path.join(dir, "app-session.json");
    fs.writeFileSync(
      appSessionPath,
      JSON.stringify({
        sessionId: "previous-session",
        pid: 10,
        phase: "heartbeat",
        startedAt: "2026-05-25T00:00:00.000Z",
        lastHeartbeatAt: "2026-05-25T00:01:00.000Z",
      }),
      "utf8",
    );

    createAppDiagnostics({
      appLogPath,
      appSessionPath,
      appVersion: "0.2.0",
      getSnapshot: () => ({ state: createInitialCompanionState(), logs: [], pendingCaptureEvents: 0, mainWindow: null }),
    }).logPreviousSession();

    const log = JSON.parse(fs.readFileSync(appLogPath, "utf8")) as Record<string, unknown>;
    expect(log).toMatchObject({
      type: "previous-non-graceful-exit",
      previousSessionId: "previous-session",
      previousPhase: "heartbeat",
    });
  });
});
