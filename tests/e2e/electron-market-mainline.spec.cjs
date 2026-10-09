const { test, expect } = require("@playwright/test");
const accepted = require("../fixtures/market-accepted-transformed.json");
const {
  cleanupUserDataDir, closeCompanionApp, createUserDataDir, emitCapturePayloads,
  getRendererState, getStoredUiPreferences, launchCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eTrafficPayloads } = require("./support/fixtures.cjs");

test("Market is visible by default and after a legacy disabled preference survives a process restart", async () => {
  const userDataDir = createUserDataDir();
  let session;
  try {
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await assertMarketJourney(session);
    await session.page.evaluate(() => {
      const key = "hero-siege-companion:preferences:v1";
      const current = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify({ ...current, marketSearchEnabled: false, hideKeys: false }));
    });
    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await assertMarketJourney(session);
    await session.page.getByRole("button", { name: "Settings", exact: true }).click();
    await session.page.getByRole("button", { name: "Appearance", exact: true }).click();
    await session.page.getByLabel("App theme").selectOption("light");
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).themeId).toBe("light");
    const saved = await getStoredUiPreferences(session.page);
    expect(saved.hideKeys).toBe(false);
    expect(saved).not.toHaveProperty("marketSearchEnabled");
  } finally {
    if (session) await closeCompanionApp(session);
    cleanupUserDataDir(userDataDir);
  }
});

async function assertMarketJourney({ electronApp, page }) {
  const state = await getRendererState(page);
  expect(state.satanicZone.refreshEnabled).toBe(false);
  expect(state).not.toHaveProperty("satanicZoneDiagnostic");
  const removedActions = await page.evaluate(() => [
    "armSatanicZoneDiagnostic", "startSatanicZoneDiagnostic", "cancelSatanicZoneDiagnostic",
  ].map(name => typeof window.heroSiegeCompanion[name]));
  expect(removedActions).toEqual(["undefined", "undefined", "undefined"]);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Help & Support", exact: true }).click();
  await expect(settings.getByText("Private Market request", { exact: true })).toBeVisible();
  await expect(settings.getByText("One-shot initialized SZ probe", { exact: true })).toHaveCount(0);
  await settings.getByRole("button", { name: "Close settings" }).click();

  await emitCapturePayloads(electronApp, e2eTrafficPayloads());
  const market = page.getByRole("button", { name: "Check Aurelion Fury on the market" });
  await expect(market).toBeVisible();
  await electronApp.evaluate(() => {
    globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [{
      direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
      localAddress: "192.0.2.10", localPort: 5000,
      text: "account_id=7-424242&unique_account_id=SYNTHETIC-accepted-uid&crossregion_identifier=SYNTHETIC-accepted-session&season=11&hardcore=0&beta=0",
    }]);
  });
  await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
  // Reuse the accepted response's 101-price projection with an invented catalog drop.
  // Main's mock transport uses production construction/reduction; the worker entry is covered separately.
  await electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...Buffer.from(accepted.response.bodyBase64, "base64")]);
  await market.click();
  const workspace = page.locator(".market-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.locator(".market-chosen-item")).toContainText("Aurelion Fury");
  await expect(workspace.locator(".market-readiness").getByRole("status")).toHaveText("Market ready");
  await expect(workspace).not.toContainText("fields received");
  expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
  await workspace.getByRole("button", { name: "Search market", exact: true }).click();
  await expect(workspace.getByText("4,000 gold", { exact: true })).toBeVisible();
  await expect(workspace.getByText("6,000 gold", { exact: true })).toBeVisible();
  await expect(workspace.locator(".market-result-details")).toContainText("server count 101");
  await expect(workspace.locator(".market-result-details")).not.toHaveAttribute("open");
  await expect(workspace.locator(".market-listing-card")).toHaveCount(20);
  await expect(workspace.locator(".market-readiness").getByRole("status")).toHaveText("Market ready");
  await expect(workspace.getByRole("button", { name: /^Search in \d+s$/ })).toBeDisabled();
  expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
  await page.getByRole("tab", { name: "Live Session", exact: true }).click();
}
