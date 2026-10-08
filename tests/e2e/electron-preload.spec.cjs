const { test, expect } = require("@playwright/test");
const {
  EXPECTED_PRELOAD_API,
  emitCaptureEvents,
  emitCapturePayloads,
  getPreloadBridgeReport,
  getRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eCaptureEvents, e2eTrafficPayloads } = require("./support/fixtures.cjs");

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


test("publishes sanitized Market readiness through the preload state bridge", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
    const fields = ["account_id", "unique_account_id", "crossregion_identifier", "season", "hardcore", "beta"];
    const payload = (text) => ({ text, direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921 });
    const observe = (processIds, payloads) => electronApp.evaluate((_process, input) => {
      globalThis.heroSiegeCompanionE2e.emitSessionContext(input.processIds, input.payloads);
    }, { processIds, payloads });
    await page.evaluate(() => {
      window.__marketReadinessUpdates = [];
      window.__stopMarketReadinessProbe = window.heroSiegeCompanion.onStateUpdated((update) => {
        window.__marketReadinessUpdates.push(update.marketReadiness);
      });
    });

    expect((await getRendererState(page)).marketReadiness).toMatchObject({
      phase: "waiting", reason: "capture_inactive", canSearch: false, missingFields: fields,
    });
    await page.getByRole("tab", { name: "Market", exact: true }).click();
    const workspace = page.locator(".market-workspace");
    await expect(workspace).toBeVisible();
    const timeline = workspace.locator(".market-readiness");
    const recoveryCopy = "With capture running, search for an item in the game’s Market or perform an in-game vote reset to collect the information needed.";
    await expect(timeline.getByRole("status")).toHaveText("Market not ready");
    await expect(timeline).toContainText("Start capture");

    await page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.reason).toBe("game_unavailable");
    await observe([123], [payload("api account_id=10-42&beta=0")]);
    await expect(timeline.getByRole("status")).toHaveText("Market not ready");
    await expect(timeline).toContainText(recoveryCopy);
    await expect(timeline.locator(".market-readiness-detail")).toHaveCount(1);
    expect(await workspace.evaluate((node, text) => node.textContent.split(text).length - 1, recoveryCopy)).toBe(1);
    await expect(timeline).not.toContainText("fields received");
    expect((await getRendererState(page)).marketReadiness.missingFields).toHaveLength(4);
    expect(await timeline.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await page.getByRole("tab", { name: "Live Session", exact: true }).click();
    await page.getByRole("button", { name: "Check Aurelion Fury on the market" }).click();
    const dialog = workspace;
    const status = dialog.locator(".market-readiness");
    await expect(status.getByRole("status")).toHaveText("Market not ready");
    await expect(status).toContainText(recoveryCopy);
    expect(await dialog.evaluate((node, text) => node.textContent.split(text).length - 1, recoveryCopy)).toBe(1);
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    if (process.env.HSC_MARKET_NOT_READY_SCREENSHOT) {
      await page.screenshot({ path: process.env.HSC_MARKET_NOT_READY_SCREENSHOT });
    }
    const complete = payload("api account_id=10-42&unique_account_id=e2e-identity&crossregion_identifier=e2e-session&season=11&hardcore=0&beta=0");
    await observe([123], [complete]);
    await expect(status.getByRole("status")).toHaveText("Market ready");
    await expect(dialog.locator('button[type="submit"]')).toBeEnabled();
    await expect(status).not.toContainText("fields received");
    await expect(status.locator(".market-readiness-light")).toHaveAttribute("aria-hidden", "true");
    expect((await getRendererState(page)).marketReadiness).toMatchObject({ missingFields: [], sessionCurrent: true, regionQualified: true });
    expect(await status.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    await page.evaluate(() => window.heroSiegeCompanion.stopCapture());
    await expect(status.getByRole("status")).toHaveText("Market not ready");
    await expect(status).toContainText("Start capture");
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    // Model the native observer clearing the stopped capture generation, then
    // restarting against the same synthetic PID. No real process is inspected.
    await observe([], []);
    await page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await observe([123], []);
    await expect(status.getByRole("status")).toHaveText("Market not ready");
    await expect(status).not.toContainText("fields received");
    expect((await getRendererState(page)).marketReadiness.missingFields).toEqual(fields);
    await observe([123], [complete]);
    await expect(status.getByRole("status")).toHaveText("Market ready");
    await expect.poll(() => page.evaluate(() => window.__marketReadinessUpdates.some((entry) => entry.phase === "ready"))).toBe(true);

    const updates = await page.evaluate(() => window.__marketReadinessUpdates);
    for (const readiness of updates) {
      expect(Object.keys(readiness).sort()).toEqual([
        "canSearch", "contextVersion", "expiresAt", "missingFields", "phase", "reason", "regionQualified", "sessionCurrent",
      ]);
    }
    expect(JSON.stringify(updates)).not.toMatch(/e2e-identity|e2e-session|203\.0\.113|10-42/);
    expect(await page.evaluate(() => window.heroSiegeCompanion.checkForUpdate())).toBeNull();
    await page.evaluate(() => window.__stopMarketReadinessProbe());
  });
});

test("rejects malformed market requests before the unavailable E2E transport", async () => {
  await withCompanionApp(async ({ page }) => {
    const responses = await page.evaluate(async () => ({
      invalid: await window.heroSiegeCompanion.searchMarket({
        itemMask: "not-a-mask",
        statFilters: [],
      }),
      unavailable: await window.heroSiegeCompanion.searchMarket({
        itemMask: 1073746020,
        statFilters: [],
      }),
    }));

    expect(responses.invalid).toEqual({ ok: false, errorCode: "request_rejected" });
    expect(responses.unavailable).toEqual({ ok: false, errorCode: "helper_unavailable" });
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
