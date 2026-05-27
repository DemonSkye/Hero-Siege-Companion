import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";
import { useSupportDiagnosticsRuntime } from "../../src/renderer/src/lib/support-diagnostics-runtime";
import { companionState } from "./fixtures";

describe("support diagnostics runtime", () => {
  test("loads diagnostics info and saves the diagnostics bundle", async () => {
    const getSupportDiagnosticsInfo = vi.fn().mockResolvedValue({
      userDataPath: "C:\\Users\\Test\\AppData\\Roaming\\Hero Siege Companion",
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
        saveSupportDiagnostics,
        writeClipboardText: vi.fn().mockResolvedValue(undefined),
        openNpcapGuide: vi.fn(),
      },
      configurable: true,
    });

    const showToast = vi.fn();
    const runtime = useSupportDiagnosticsRuntime({
      state: ref(companionState()),
      showToast,
    });

    await runtime.refreshSupportDiagnosticsInfo();
    await runtime.saveSupportDiagnostics();
    await runtime.copySupportDiagnosticsSummary();

    expect(runtime.supportDiagnosticsInfo.value.userDataPath).toContain("Hero Siege Companion");
    expect(saveSupportDiagnostics).toHaveBeenCalledWith(expect.stringContaining("App version: 0.2.0"));
    expect(showToast).toHaveBeenCalledWith("Diagnostics ZIP saved with 1 file");
    expect(showToast).toHaveBeenCalledWith("Diagnostics summary copied");
    expect(runtime.supportBundleBusy.value).toBe(false);
  });

  test("falls back to default diagnostics info when the main process call fails", async () => {
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        getSupportDiagnosticsInfo: vi.fn().mockRejectedValue(new Error("nope")),
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
  });

  test("shows a toast when diagnostics summary copy fails", async () => {
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        getSupportDiagnosticsInfo: vi.fn(),
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
});
