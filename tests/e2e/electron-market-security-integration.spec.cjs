const { test, expect } = require("@playwright/test");
const { deflateSync } = require("node:zlib");
const path = require("node:path"), os = require("node:os");
const { createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  getRendererState, getStoredUiPreferences } = require("./support/companion-app.cjs");

const flow = { direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
  localAddress: "192.0.2.10", localPort: 5000 };
const complete = "account_id=7-424242&unique_account_id=SYNTHETIC-uid&crossregion_identifier=SYNTHETIC-session&season=11&hardcore=0&beta=0";
async function observe(session, text = complete) {
  await session.electronApp.evaluate((_electron, connection) => globalThis.heroSiegeCompanionE2e.emitCaptureUpdate({ connections: [connection] }),
    { ...flow, owningProcess: 42, state: "Established" });
  await session.electronApp.evaluate((_electron, payload) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [payload]), { ...flow, text });
}
async function respond(session) {
  // Invented seed 1000; expected 0.5 and 21 are independent retained POC outcomes.
  const rows = [{ price: 1, fingerprint: "SYNTHETIC-0-0-4", item_data: { a: 1000, b: 62, c: 1, d: 24, e: 11, w: 1 } }];
  const body = Buffer.from(JSON.stringify({ status: 1, itemCount: 1,
    items: deflateSync(Buffer.from(JSON.stringify(rows))).toString("base64") }));
  await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...body]);
}
async function assertRolls(workspace) {
  const listing = workspace.locator(".market-listing-details");
  await expect(listing).toContainText("Reconstructed listing stats (experimental)");
  await expect(listing).toContainText("Enhanced Damage per level0.5%");
  await expect(listing).toContainText("All Resistances21");
  await expect(listing.locator(".market-listing-stats li")).toHaveCount(9);
}

test("integrated startup, loss/recovery and restart preserve saved glove criteria without automatic searches", async () => {
  const userDataDir = createUserDataDir();
  let session;
  try {
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    let workspace = session.page.locator(".market-workspace");
    await workspace.locator("#market-item-query").fill("Death Knight's Gauntlets");
    await workspace.locator("#market-item-query").press("Enter");
    await workspace.locator("#market-stat-query").fill("All Resistances");
    await workspace.locator("#market-stat-query").press("Enter");
    await workspace.locator(".market-stat-row input").fill("20");
    await workspace.locator("#market-saved-name").fill("Recovered glove");
    await workspace.getByRole("button", { name: "Save item and filters", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.find(item => item.name === "Recovered glove")?.request.statFilters)
      .toEqual([{ statId: 173, minimum: 20 }]);
    await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await observe(session); await respond(session);
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    await workspace.getByRole("button", { name: "Search market", exact: true }).click();
    await assertRolls(workspace);
    await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitCaptureUpdate({ observationGap: true }));
    await expect(workspace.locator(".market-readiness")).toContainText("Capture lost session information");
    await expect(workspace.locator(".market-listing-details")).toHaveCount(0);
    await expect(workspace.locator(".market-saved-load").filter({ hasText: "Recovered glove" })).toHaveCount(1);
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("20");
    await observe(session, "account_id=7-424242&unique_account_id=SYNTHETIC-new-uid&beta=0");
    expect((await getRendererState(session.page)).marketReadiness.canSearch).toBe(false);
    await observe(session, complete.replace("SYNTHETIC-uid", "SYNTHETIC-new-uid").replace("SYNTHETIC-session", "SYNTHETIC-new-session"));
    await expect.poll(async () => (await getRendererState(session.page)).marketReadiness.canSearch).toBe(true);
    await expect(workspace.locator(".market-listing-details")).toHaveCount(0);
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    expect((await getRendererState(session.page)).satanicZone.refreshEnabled).toBe(false);

    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({ hasText: "Recovered glove" }).click();
    await expect(workspace.locator(".market-chosen-item")).toContainText("Death Knight's Gauntlets");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("20");
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await observe(session); await respond(session);
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    await workspace.getByRole("button", { name: "Search market", exact: true }).click();
    await assertRolls(workspace);
    expect((await getRendererState(session.page)).satanicZone.refreshEnabled).toBe(false);
  } finally {
    if (session) await closeCompanionApp(session);
    if (path.dirname(path.resolve(userDataDir)) !== path.resolve(os.tmpdir()) || !path.basename(userDataDir).startsWith("hsc-e2e-")) throw Error("Unexpected synthetic profile");
    cleanupUserDataDir(userDataDir);
  }
});
