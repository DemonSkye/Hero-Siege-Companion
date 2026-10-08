const { test, expect } = require("@playwright/test");
const accepted = require("../fixtures/market-accepted-transformed.json");
const { withCompanionApp, getRendererState, emitCapturePayloads } = require("./support/companion-app.cjs");
const { e2eTrafficPayloads } = require("./support/fixtures.cjs");
const flow = { direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
  localAddress: "192.0.2.10", localPort: 5000 };
const text = "account_id=7-424242&unique_account_id=SYNTHETIC-uid&crossregion_identifier=SYNTHETIC-session&season=11&hardcore=0&beta=0";
const request = { itemMask: 1073746020, statFilters: [] };
async function observe(electronApp, context = text) {
  await electronApp.evaluate((_electron, connection) => globalThis.heroSiegeCompanionE2e.emitCaptureUpdate({ connections: [connection] }),
    { ...flow, owningProcess: 42, state: "Established" });
  await electronApp.evaluate((_electron, payload) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [payload]), { ...flow, text: context });
}

test("real main/preload/UI clears old results on observation loss and resumes with sufficient fresh context", async () => {
  await withCompanionApp({ marketTransport: true }, async ({ electronApp, page }) => {
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await observe(electronApp);
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
    await electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes),
      [...Buffer.from(accepted.response.bodyBase64, "base64")]);
    await page.getByRole("button", { name: "Check Aurelion Fury on the market" }).click();
    const workspace = page.locator(".market-workspace");
    await workspace.getByRole("button", { name: "Search market", exact: true }).click();
    await expect(workspace.getByText("4,000 gold", { exact: true })).toBeVisible();
    const previous = (await getRendererState(page)).marketReadiness.contextVersion;
    await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitCaptureUpdate({ observationGap: true }));
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(false);
    await expect(workspace.getByText("4,000 gold", { exact: true })).toHaveCount(0);
    await expect(workspace.locator(".market-readiness")).toContainText("Capture lost session information");
    await expect(workspace.locator(".market-readiness").getByRole("status")).toHaveText("Market not ready");
    expect((await getRendererState(page)).marketReadiness.contextVersion).toBeGreaterThan(previous);
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request))
      .toMatchObject({ ok: false, errorCode: "template_unavailable" });
    await observe(electronApp, "account_id=7-424242&unique_account_id=SYNTHETIC-uid&beta=0");
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(false);
    await observe(electronApp);
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
    await expect(workspace.locator(".market-readiness").getByRole("status")).toHaveText("Market ready");
    // Recovery preserves the real dispatch cooldown; it cannot serve the cleared old cache.
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request))
      .toMatchObject({ ok: false, errorCode: "search_pending" });
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    expect((await getRendererState(page)).satanicZone.refreshEnabled).toBe(false);
  });
});

test("main/preload stop and resume cannot restore Ready without current evidence", async () => {
  await withCompanionApp({ marketTransport: true }, async ({ electronApp, page }) => {
    await page.evaluate(() => window.heroSiegeCompanion.startCapture()); await observe(electronApp);
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
    await page.evaluate(() => window.heroSiegeCompanion.stopCapture());
    await page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(false);
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request))
      .toMatchObject({ ok: false, errorCode: "template_unavailable" });
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await observe(electronApp);
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
  });
});
