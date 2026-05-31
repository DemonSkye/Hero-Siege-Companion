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
    fs.mkdirSync(userDataPath);
    fs.writeFileSync(path.join(userDataPath, "app-debug.log"), "startup ok\n", "utf8");

    const info = getSupportDiagnosticsInfo(userDataPath, "0.2.0");

    expect(info.appVersion).toBe("0.2.0");
    expect(info.generatedFiles[0].name).toBe("diagnostics-summary.txt");
    expect(info.logFiles.map((file) => file.name)).toEqual(["app-debug.log"]);
    expect(info.logFiles[0]).toMatchObject({ exists: true, sizeBytes: 11 });
  });

  test("redacts verbose wide-log payload fields before support export", () => {
    const text = [
      JSON.stringify({ type: "packet", payloadBase64: "raw-packet", textSnippet: "ok" }),
      JSON.stringify({ type: "assembled-payload", textBase64: "raw-text", textSnippet: "ok" }),
      "not json",
    ].join("\n");

    const sanitized = sanitizeWideDebugLogForSupport(text);

    expect(sanitized).not.toContain("payloadBase64");
    expect(sanitized).not.toContain("textBase64");
    expect(sanitized).not.toContain("raw-packet");
    expect(sanitized).not.toContain("raw-text");
    expect(sanitized).toContain("not json");
  });

  test("saves a redacted diagnostics bundle with only selected diagnostic files", async () => {
    const userDataPath = path.join(tempDir, "userData");
    const bundlePath = path.join(tempDir, "diagnostics.zip");
    const profileLogPath = `C:\\Users\\${os.userInfo().username}\\AppData\\Roaming\\Hero Siege Companion\\app-debug.log`;
    fs.mkdirSync(userDataPath);
    fs.writeFileSync(path.join(userDataPath, "app-debug.log"), `appLogPath=${profileLogPath}\n`, "utf8");
    fs.writeFileSync(path.join(userDataPath, "preferences.json"), "{\"private\":true}\n", "utf8");
    fs.writeFileSync(
      path.join(userDataPath, "capture-wide-debug.log"),
      `${JSON.stringify({ type: "packet", payloadBase64: "raw-packet", textSnippet: "account_id=<redacted>" })}\n`,
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
      includedFiles: ["diagnostics-summary.txt", "app-debug.log", "capture-wide-debug.log"],
    });
    expect(entries["diagnostics-summary.txt"]).toContain("%USERPROFILE%");
    expect(entries["diagnostics-summary.txt"]).not.toContain(os.userInfo().username);
    expect(entries["diagnostics-summary.txt"]).not.toContain("capture-debug.log");
    expect(entries["app-debug.log"]).toContain("%USERPROFILE%\\AppData");
    expect(entries["app-debug.log"]).not.toContain(os.userInfo().username);
    expect(entries["capture-wide-debug.log"]).not.toContain("payloadBase64");
    expect(entries["capture-wide-debug.log"]).not.toContain("raw-packet");
    expect(entries["preferences.json"]).toBeUndefined();
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
