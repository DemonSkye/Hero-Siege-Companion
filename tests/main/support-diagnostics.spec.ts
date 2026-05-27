import { describe, expect, test } from "vitest";
import { getSupportDiagnosticsInfo } from "../../src/main/support-diagnostics";

describe("support diagnostics metadata", () => {
  test("includes the main process app version with diagnostics file metadata", () => {
    const info = getSupportDiagnosticsInfo("C:\\Users\\Tester\\AppData\\Roaming\\Hero Siege Companion", "0.2.0");

    expect(info.appVersion).toBe("0.2.0");
    expect(info.generatedFiles[0].name).toBe("diagnostics-summary.txt");
    expect(info.logFiles.map((file) => file.name)).toContain("capture-debug.log");
  });
});
