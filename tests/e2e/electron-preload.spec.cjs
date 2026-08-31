const { test, expect } = require("@playwright/test");
const {
  EXPECTED_PRELOAD_API,
  emitCaptureEvents,
  getPreloadBridgeReport,
  getRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eCaptureEvents } = require("./support/fixtures.cjs");

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

test("keeps recurring state updates small while publishing archive mutations", async () => {
  await withCompanionApp({ seedPastRuns: true }, async ({ electronApp, page }) => {
    await page.evaluate(() => {
      window.__hscStateUpdateShapes = [];
      window.__hscStopStateUpdateProbe = window.heroSiegeCompanion.onStateUpdated((update) => {
        window.__hscStateUpdateShapes.push({
          accountName: update.stats.accountName,
          hasPastRuns: Object.prototype.hasOwnProperty.call(update, "pastRuns"),
          pastRunCount: update.pastRuns?.length ?? null,
          firstRunTags: update.pastRuns?.[0]?.tags ?? null,
        });
      });
    });

    await emitCaptureEvents(electronApp, e2eCaptureEvents());
    await expect.poll(() => page.evaluate(() => (
      window.__hscStateUpdateShapes.some((shape) => shape.accountName === "E2E Captured")
    ))).toBe(true);

    const liveUpdate = await page.evaluate(() => (
      window.__hscStateUpdateShapes.find((shape) => shape.accountName === "E2E Captured")
    ));
    expect(liveUpdate).toMatchObject({ hasPastRuns: false, pastRunCount: null });

    await page.evaluate(() => window.heroSiegeCompanion.setPastRunTags("e2e-run-alpha", ["updated"]));
    await expect.poll(() => page.evaluate(() => (
      window.__hscStateUpdateShapes.some((shape) => shape.hasPastRuns && shape.firstRunTags?.includes("updated"))
    )), { timeout: 5_000 }).toBe(true);

    const archiveUpdate = await page.evaluate(() => (
      window.__hscStateUpdateShapes.find((shape) => shape.hasPastRuns && shape.firstRunTags?.includes("updated"))
    ));
    expect(archiveUpdate).toMatchObject({ hasPastRuns: true, pastRunCount: 2 });
    await page.evaluate(() => window.__hscStopStateUpdateProbe?.());
  });
});
