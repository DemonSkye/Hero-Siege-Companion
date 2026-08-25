import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getSupportDiagnosticsInfo, sanitizeWideDebugLogForSupport, saveSupportDiagnosticsBundle } from "../../src/main/support-diagnostics";

const dialogMock = vi.hoisted(() => ({
  showSaveDialogWithParent: vi.fn(),
}));

vi.mock("../../src/main/electron-dialogs", () => ({
  showSaveDialogWithParent: dialogMock.showSaveDialogWithParent,
}));

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-support-diagnostics-"));
  dialogMock.showSaveDialogWithParent.mockReset();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("support diagnostics metadata", () => {
  test("includes the main process app version with available diagnostics file metadata", () => {
    const userDataPath = path.join(tempDir, "userData");
    const logsPath = path.join(userDataPath, "logs");
    fs.mkdirSync(logsPath, { recursive: true });
    fs.writeFileSync(path.join(logsPath, "app-debug.log"), "startup ok\n", "utf8");

    const info = getSupportDiagnosticsInfo(userDataPath, "0.2.0");

    expect(info.appVersion).toBe("0.2.0");
    expect(info.userDataPath).toBe(userDataPath);
    expect(info.logsPath).toBe(logsPath);
    expect(info.generatedFiles[0].name).toBe("diagnostics-summary.txt");
    expect(info.logFiles.map((file) => file.name)).toEqual(["app-debug.log"]);
    expect(info.logFiles[0]).toMatchObject({ exists: true, path: path.join(logsPath, "app-debug.log"), sizeBytes: 11 });
  });

  test("redacts verbose wide-log payload fields before support export", () => {
    const fingerprint = "10-3909410-65643fdba44110001-10";
    const text = [
      JSON.stringify({ type: "packet", payloadBase64: "raw-packet", textSnippet: `chat and ${fingerprint}` }),
      JSON.stringify({ type: "assembled-payload", textBase64: "raw-text", textSnippet: "platform metadata" }),
      "not json account_id=raw-account",
      JSON.stringify("payloadBase64=raw-scalar"),
      '{"payloadBase64":"torn-secret"',
    ].join("\n");

    const sanitized = sanitizeWideDebugLogForSupport(text);

    expect(sanitized).not.toContain("payloadBase64");
    expect(sanitized).not.toContain("textBase64");
    expect(sanitized).not.toContain("raw-packet");
    expect(sanitized).not.toContain("raw-text");
    expect(sanitized).not.toContain("textSnippet");
    expect(sanitized).not.toContain("chat and");
    expect(sanitized).not.toContain("platform metadata");
    expect(sanitized).not.toContain(fingerprint);
    expect(sanitized).not.toContain("raw-account");
    expect(sanitized).not.toContain("raw-scalar");
    expect(sanitized).not.toContain("torn-secret");
    expect(sanitized.match(/malformed-or-unsupported-wide-debug-line/g)).toHaveLength(3);
  });

  test("saves a redacted diagnostics bundle with only selected diagnostic files", async () => {
    const userDataPath = path.join(tempDir, "userData");
    const logsPath = path.join(userDataPath, "logs");
    const bundlePath = path.join(tempDir, "diagnostics.zip");
    const profileLogPath = `C:\\Users\\${os.userInfo().username}\\AppData\\Roaming\\Hero Siege Companion\\logs\\app-debug.log`;
    const fingerprint = "10-3909410-65643fdba44110001-10";
    fs.mkdirSync(logsPath, { recursive: true });
    fs.writeFileSync(
      path.join(userDataPath, "app-session.json"),
      JSON.stringify({
        sessionId: "test-session",
        pid: 123,
        phase: "heartbeat",
        startedAt: "2026-08-21T11:40:00.000Z",
        lastHeartbeatAt: "2026-08-21T11:45:45.000Z",
        electronVersion: "43.4.1",
        nodeVersion: "24.18.1",
        nodeModulesAbi: "148",
        shutdownReason: `account_id=123; log=${profileLogPath}`,
        accessToken: "must-not-be-exported",
        nestedPrivateData: { password: "must-not-be-exported" },
      }),
      "utf8",
    );
    const crashReportsPath = path.join(userDataPath, "Crashpad", "reports");
    fs.mkdirSync(crashReportsPath, { recursive: true });
    const crashReportNames = Array.from(
      { length: 6 },
      (_, index) => `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}.dmp`,
    );
    crashReportNames.forEach((name, index) => {
      const reportPath = path.join(crashReportsPath, name);
      fs.writeFileSync(reportPath, `private-dump-bytes-${index + 1}`, "utf8");
      const modifiedAt = new Date(Date.UTC(2026, 7, 21, 11, 40, index));
      fs.utimesSync(reportPath, modifiedAt, modifiedAt);
    });
    fs.writeFileSync(path.join(crashReportsPath, "account_id=private.dmp"), "ignored-private-dump", "utf8");
    fs.writeFileSync(
      path.join(logsPath, "app-debug.log"),
      `appLogPath=${profileLogPath} account_id=app-account\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(logsPath, "capture-debug.log"),
      `${JSON.stringify({ type: "payload", snippet: `account_id=123 {\"${fingerprint}\":{}}` })}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(userDataPath, "preferences.json"), "{\"private\":true}\n", "utf8");
    fs.writeFileSync(
      path.join(logsPath, "capture-wide-debug.log"),
      `${JSON.stringify({ type: "packet", payloadBase64: "raw-packet", textSnippet: `account_id=123 ${fingerprint}` })}\n`,
      "utf8",
    );
    dialogMock.showSaveDialogWithParent.mockResolvedValue({ canceled: false, filePath: bundlePath });

    const result = await saveSupportDiagnosticsBundle({
      diagnosticsSummary: "Hero Siege Companion capture diagnostics",
      appVersion: "0.2.5",
      ownerWindow: null,
      userDataPath,
      onLogReadFailed: vi.fn(),
    });

    const entries = readZipEntries(fs.readFileSync(bundlePath));
    expect(result).toMatchObject({
      saved: true,
      canceled: false,
      filePath: bundlePath,
      includedFiles: [
        "diagnostics-summary.txt",
        "app-session.json",
        "crash-metadata.json",
        "app-debug.log",
        "capture-debug.log",
        "capture-wide-debug.log",
      ],
    });
    expect(entries["diagnostics-summary.txt"]).toContain("%USERPROFILE%");
    expect(entries["diagnostics-summary.txt"]).not.toContain(os.userInfo().username);
    expect(entries["diagnostics-summary.txt"]).toContain("- app-session.json:");
    expect(entries["diagnostics-summary.txt"]).toContain("- crash-metadata.json:");
    expect(entries["diagnostics-summary.txt"]).toContain("- capture-debug.log:");
    expect(entries["diagnostics-summary.txt"]).toContain("Crash dump contents are never included automatically.");
    const appSession = JSON.parse(entries["app-session.json"]) as Record<string, unknown>;
    expect(appSession).toMatchObject({
      sessionId: "test-session",
      pid: 123,
      phase: "heartbeat",
      electronVersion: "43.4.1",
      nodeVersion: "24.18.1",
      nodeModulesAbi: "148",
    });
    expect(appSession.shutdownReason).toContain("account_id=<redacted>");
    expect(appSession.shutdownReason).toContain("%USERPROFILE%\\AppData");
    expect(entries["app-session.json"]).not.toContain(os.userInfo().username);
    expect(entries["app-session.json"]).not.toContain("must-not-be-exported");
    expect(appSession).not.toHaveProperty("accessToken");
    expect(appSession).not.toHaveProperty("nestedPrivateData");
    const crashMetadata = JSON.parse(entries["crash-metadata.json"]) as { reports: Array<Record<string, unknown>> };
    expect(crashMetadata.reports).toHaveLength(5);
    expect(crashMetadata.reports.map((report) => report.fileName)).toEqual(crashReportNames.slice(1).reverse());
    expect(Object.keys(crashMetadata.reports[0])).toEqual(["fileName", "sizeBytes", "createdAt", "modifiedAt"]);
    expect(crashMetadata.reports[0].modifiedAt).toBe("2026-08-21T11:40:05.000Z");
    expect(entries["crash-metadata.json"]).not.toContain(crashReportsPath);
    expect(entries["crash-metadata.json"]).not.toContain("private-dump-bytes");
    expect(entries["crash-metadata.json"]).not.toContain("account_id=private");
    expect(entries["app-debug.log"]).toContain("%USERPROFILE%\\AppData");
    expect(entries["app-debug.log"]).not.toContain(os.userInfo().username);
    expect(entries["app-debug.log"]).toContain("account_id=<redacted>");
    expect(entries["app-debug.log"]).not.toContain("app-account");
    expect(entries["capture-debug.log"]).toContain("account_id=<redacted>");
    expect(entries["capture-debug.log"]).toContain("<item-fingerprint:");
    expect(entries["capture-debug.log"]).not.toContain(fingerprint);
    expect(entries["capture-wide-debug.log"]).not.toContain("payloadBase64");
    expect(entries["capture-wide-debug.log"]).not.toContain("raw-packet");
    expect(entries["capture-wide-debug.log"]).not.toContain("textSnippet");
    expect(entries["capture-wide-debug.log"]).not.toContain(fingerprint);
    expect(entries["preferences.json"]).toBeUndefined();
  });

  test("omits malformed session data and unavailable Crashpad reports without failing the bundle", async () => {
    const userDataPath = path.join(tempDir, "userData");
    const bundlePath = path.join(tempDir, "diagnostics-without-crash-evidence.zip");
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(path.join(userDataPath, "app-session.json"), '{"sessionId":"torn-session"', "utf8");
    fs.writeFileSync(path.join(userDataPath, "Crashpad"), "not a directory", "utf8");
    dialogMock.showSaveDialogWithParent.mockResolvedValue({ canceled: false, filePath: bundlePath });

    const result = await saveSupportDiagnosticsBundle({
      diagnosticsSummary: "Hero Siege Companion capture diagnostics",
      ownerWindow: null,
      userDataPath,
      onLogReadFailed: vi.fn(),
    });

    const entries = readZipEntries(fs.readFileSync(bundlePath));
    expect(result.includedFiles).toEqual(["diagnostics-summary.txt"]);
    expect(entries["app-session.json"]).toBeUndefined();
    expect(entries["crash-metadata.json"]).toBeUndefined();
    expect(entries["diagnostics-summary.txt"]).toContain("Crash dump contents are never included automatically.");
  });
});

function readZipEntries(buffer: Buffer): Record<string, string> {
  const entries: Record<string, string> = {};
  let offset = 0;
  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = compressionMethod === 8 ? zlib.inflateRawSync(compressed) : compressed;
    entries[name] = data.toString("utf8");
    offset = dataStart + compressedSize;
  }
  return entries;
}
