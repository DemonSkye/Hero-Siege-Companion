import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";
import { useSupportDiagnosticsRuntime } from "../../src/renderer/src/lib/support-diagnostics-runtime";
import { companionState } from "./fixtures";

describe("support diagnostics runtime", () => {
  test("loads diagnostics info and saves the diagnostics bundle", async () => {
    const getSupportDiagnosticsInfo = vi.fn().mockResolvedValue({
      userDataPath: "C:\\Users\\Test\\AppData\\Roaming\\Hero Siege Companion",
      logsPath: "C:\\Users\\Test\\AppData\\Roaming\\Hero Siege Companion\\logs",
      appVersion: "0.2.0",
      generatedFiles: [],
      logFiles: [],
    });
    const saveSupportDiagnostics = vi.fn().mockResolvedValue({
      saved: true,
      canceled: false,
      filePath: "C:\\Temp\\diagnostics.zip",
      includedFiles: ["diagnostics-summary.txt"],
    });
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        getSupportDiagnosticsInfo,
        openSupportLogsDirectory: vi.fn().mockResolvedValue(true),
        saveSupportDiagnostics,
        writeClipboardText: vi.fn().mockResolvedValue(undefined),
        openNpcapGuide: vi.fn(),
      },
      configurable: true,
    });

    const showToast = vi.fn();
    const runtime = useSupportDiagnosticsRuntime({
      state: ref(companionState({ captureError: "Native capture unavailable: Npcap is missing" })),
      showToast,
    });

    await runtime.refreshSupportDiagnosticsInfo();
    await runtime.saveSupportDiagnostics();
    await runtime.copySupportDiagnosticsSummary();

    expect(runtime.supportDiagnosticsInfo.value.userDataPath).toContain("Hero Siege Companion");
    expect(runtime.supportDiagnosticsInfo.value.logsPath).toContain("logs");
    expect(saveSupportDiagnostics).toHaveBeenCalledWith(expect.stringContaining("App version: 0.2.0"));
    expect(saveSupportDiagnostics).toHaveBeenCalledWith(expect.stringContaining("Capture error: Native capture unavailable: Npcap is missing"));
    expect(showToast).toHaveBeenCalledWith("Diagnostics ZIP saved with 1 file");
    expect(showToast).toHaveBeenCalledWith("Diagnostics summary copied");
    expect(runtime.supportBundleBusy.value).toBe(false);
  });

  test("falls back to default diagnostics info when the main process call fails", async () => {
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        getSupportDiagnosticsInfo: vi.fn().mockRejectedValue(new Error("nope")),
        openSupportLogsDirectory: vi.fn(),
        saveSupportDiagnostics: vi.fn(),
        writeClipboardText: vi.fn(),
        openNpcapGuide: vi.fn(),
      },
      configurable: true,
    });

    const runtime = useSupportDiagnosticsRuntime({
      state: ref(companionState()),
      showToast: vi.fn(),
    });

    await runtime.refreshSupportDiagnosticsInfo();

    expect(runtime.supportDiagnosticsInfo.value.userDataPath).toBe("%APPDATA%\\Hero Siege Companion");
    expect(runtime.supportDiagnosticsInfo.value.logsPath).toBe("%APPDATA%\\Hero Siege Companion\\logs");
  });

  test("shows a toast when diagnostics summary copy fails", async () => {
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        getSupportDiagnosticsInfo: vi.fn(),
        openSupportLogsDirectory: vi.fn(),
        saveSupportDiagnostics: vi.fn(),
        writeClipboardText: vi.fn().mockRejectedValue(new Error("clipboard unavailable")),
        openNpcapGuide: vi.fn(),
      },
      configurable: true,
    });

    const showToast = vi.fn();
    const runtime = useSupportDiagnosticsRuntime({
      state: ref(companionState()),
      showToast,
    });

    await runtime.copySupportDiagnosticsSummary();

    expect(showToast).toHaveBeenCalledWith("Diagnostics summary copy failed");
  });

  test("opens the diagnostics log folder through the preload bridge", async () => {
    const openSupportLogsDirectory = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        getSupportDiagnosticsInfo: vi.fn().mockResolvedValue({
          userDataPath: "C:\\Users\\Test\\AppData\\Roaming\\Hero Siege Companion",
          logsPath: "C:\\Users\\Test\\AppData\\Roaming\\Hero Siege Companion\\logs",
          appVersion: "0.2.0",
          generatedFiles: [],
          logFiles: [],
        }),
        openSupportLogsDirectory,
        saveSupportDiagnostics: vi.fn(),
        writeClipboardText: vi.fn(),
        openNpcapGuide: vi.fn(),
      },
      configurable: true,
    });

    const showToast = vi.fn();
    const runtime = useSupportDiagnosticsRuntime({
      state: ref(companionState()),
      showToast,
    });

    await runtime.openSupportLogsDirectory();

    expect(openSupportLogsDirectory).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Diagnostics log folder opened");
  });
});
