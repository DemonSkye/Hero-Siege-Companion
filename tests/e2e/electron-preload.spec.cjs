const { test, expect } = require("@playwright/test");
const {
  EXPECTED_PRELOAD_API,
  getPreloadBridgeReport,
  getRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");

test("exposes the complete preload bridge before renderer actions run", async () => {
  await withCompanionApp(async ({ page }) => {
    const report = await getPreloadBridgeReport(page);

    expect(report.hasBridge).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.keys).toEqual([...EXPECTED_PRELOAD_API].sort());
    expect(report.nodeIntegrationLeaked).toBe(false);

    const state = await getRendererState(page);
    expect(state.logs.some((log) => log.message.includes("Renderer preload failed"))).toBe(false);
    expect(state.logs.some((log) => log.message.includes("../shared/ipc"))).toBe(false);
  });
});
