import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";
import { useSupportDiagnosticsRuntime } from "../../src/renderer/src/lib/support-diagnostics-runtime";
import { companionState } from "./fixtures";

describe("support diagnostics runtime", () => {
  test("loads diagnostics info and saves the diagnostics bundle", async () => {
    const getSupportDiagnosticsInfo = vi.fn().mockResolvedValue({
      userDataPath: "C:\\Users\\Test\\AppData\\Roaming\\Hero Siege Companion",
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
        openNpcapGuide: vi.fn(),
      },
      configurable: true,
    });

    const showToast = vi.fn();
    const runtime = useSupportDiagnosticsRuntime({
      state: ref(companionState()),
      appVersion: "0.2.0",
      showToast,
    });

    await runtime.refreshSupportDiagnosticsInfo();
    await runtime.saveSupportDiagnostics();

    expect(runtime.supportDiagnosticsInfo.value.userDataPath).toContain("Hero Siege Companion");
    expect(saveSupportDiagnostics).toHaveBeenCalledWith(expect.stringContaining("App version: 0.2.0"));
    expect(showToast).toHaveBeenCalledWith("Diagnostics ZIP saved with 1 file");
    expect(runtime.supportBundleBusy.value).toBe(false);
  });

  test("falls back to default diagnostics info when the main process call fails", async () => {
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        getSupportDiagnosticsInfo: vi.fn().mockRejectedValue(new Error("nope")),
        saveSupportDiagnostics: vi.fn(),
        openNpcapGuide: vi.fn(),
      },
      configurable: true,
    });

    const runtime = useSupportDiagnosticsRuntime({
      state: ref(companionState()),
      appVersion: "0.2.0",
      showToast: vi.fn(),
    });

    await runtime.refreshSupportDiagnosticsInfo();

    expect(runtime.supportDiagnosticsInfo.value.userDataPath).toBe("%APPDATA%\\Hero Siege Companion");
  });
});
