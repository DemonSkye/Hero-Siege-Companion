const { test, expect } = require("@playwright/test");
const accepted = require("../fixtures/market-accepted-transformed.json");
const {
  createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  getStoredUiPreferences, getRendererState,
} = require("./support/companion-app.cjs");

// Real Electron/preload/main/renderer with the established synthetic-only runtime.
// No native capture, real game, credential, server or network success is involved.
test("Market migration, keyboard loading, durable edits and IPC failure compose in Electron", async () => {
  const userDataDir = createUserDataDir();
  let session;
  try {
    session = await launchCompanionApp({ userDataDir, gameRunning: false });
    await session.page.evaluate(() => {
      localStorage.setItem("hero-siege-companion:preferences:v1", JSON.stringify({ schemaVersion: 2, shoppingListItems: ["Sharpshooter's Cloak", "Owner retained name"] }));
    });
    await session.page.reload();
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    let workspace = session.page.locator(".market-workspace");
    await expect(workspace).toContainText("Owner retained name");
    await expect(session.page.locator(".shopping-panel")).toHaveCount(0);
    await workspace.getByRole("button", { name: "Sharpshooter's Cloak", exact: false }).first().click();
    await expect(workspace.locator("#market-sockets")).toBeFocused();
    await workspace.locator("#market-sockets").fill("4");
    await workspace.locator("#market-stat-query").fill("mana stolen");
    await workspace.locator("#market-stat-query").press("Enter");
    await workspace.locator(".market-stat-row input").fill("8");
    await workspace.locator("#market-saved-name").fill("Mana cloak");
    await workspace.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.[0]?.name).toBe("Mana cloak");
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeDisabled();
    await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([123], [{
      text: "api account_id=10-42&unique_account_id=CANARY_IDENTITY&crossregion_identifier=CANARY_SESSION&season=11&hardcore=0&beta=0",
      direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921,
    }]));
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    await workspace.locator("#market-sockets").press("Enter");
    await expect(workspace.locator(".market-results")).toContainText("could not prepare the direct market request");
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");
    expect(await getStoredUiPreferences(session.page)).toMatchObject({
      shoppingListItems: ["Sharpshooter's Cloak", "Owner retained name"],
      savedMarketItems: [{ name: "Mana cloak", request: { itemMask: 1073746020, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] } }, { name: "Owner retained name", request: null }],
    });
    expect(JSON.stringify(await getStoredUiPreferences(session.page))).not.toMatch(/CANARY|seller|fingerprint|crossregion/);
    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, gameRunning: false });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").first().click();
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("8");
    await expect(workspace.locator(".market-results")).toContainText("waiting for current session evidence");
    await workspace.getByRole("button", { name: "Delete saved item Mana cloak", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.length).toBe(1);
    await workspace.getByRole("button", { name: "Undo delete", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.length).toBe(2);
  } finally {
    if (session) await closeCompanionApp(session);
    cleanupUserDataDir(userDataDir);
  }
});

test("saved Market uses the accepted price page through real IPC, clears stale prices and reopens without requests", async () => {
  const userDataDir = createUserDataDir();
  let session;
  const attemptCount = () => session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount());
  const observe = async (season = "11", account = "7-424242") => {
    await session.electronApp.evaluate((_electron, context) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [{
      direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
      localAddress: "192.0.2.10", localPort: 5000,
      text: `account_id=${context.account}&unique_account_id=SYNTHETIC-accepted-uid&crossregion_identifier=SYNTHETIC-accepted-session&season=${context.season}&hardcore=0&beta=0`,
    }]), { season, account });
    await expect.poll(async () => (await getRendererState(session.page)).marketReadiness.canSearch).toBe(true);
  };
  try {
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    let workspace = session.page.locator(".market-workspace");
    await workspace.locator("#market-item-query").fill("Death Knight's Gauntlets");
    await workspace.locator("#market-item-query").press("Enter");
    await workspace.locator("#market-saved-name").fill("Death Knight search");
    await workspace.getByRole("button", { name: "Save item and filters", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.find(item => item.name === "Death Knight search")?.request)
      .toEqual({ itemMask: 1073758270, statFilters: [] });
    expect(await attemptCount()).toBe(0);
    await observe();
    // Main readiness publishes asynchronously; exercise Enter only after the
    // rendered form permits the explicit search.
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...Buffer.from(accepted.response.bodyBase64, "base64")]);
    await workspace.locator("#market-sockets").press("Enter");
    await expect(workspace.locator("tbody tr")).toHaveCount(20);
    const prices = await workspace.locator("tbody tr td:first-of-type").allTextContents();
    expect(prices).toEqual([
      "4,000 gold", "6,000 gold", "7,000 gold", "10,000 gold", "11,000 gold", "12,000 gold", "13,000 gold", "14,000 gold",
      "15,000 gold", "15,000 gold", "20,000 gold", "20,000 gold", "20,000 gold", "20,000 gold", "28,888 gold",
      "30,000 gold", "30,000 gold", "33,333 gold", "33,333 gold", "33,333 gold",
    ]);
    await expect(workspace.locator(".market-results")).toContainText("Showing 20 price listings from 101 returned page rows");
    expect(await attemptCount()).toBe(1);
    await observe("12");
    await expect(workspace.locator("tbody tr")).toHaveCount(0);
    await expect(workspace.locator(".market-chosen-item")).toContainText("Death Knight's Gauntlets");
    await observe("12", "7-424243");
    await workspace.locator(".market-saved-load").filter({ hasText: "Death Knight search" }).click();
    expect(await attemptCount()).toBe(1);
    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({ hasText: "Death Knight search" }).click();
    await expect(workspace.locator(".market-chosen-item")).toContainText("Death Knight's Gauntlets");
    await expect(workspace.locator("tbody tr")).toHaveCount(0);
    expect(await attemptCount()).toBe(0);
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeDisabled();
    expect(JSON.stringify(await getStoredUiPreferences(session.page))).not.toMatch(/SYNTHETIC|203\.0\.113|checksum|multipass|seller/);
  } finally {
    if (session) await closeCompanionApp(session);
    cleanupUserDataDir(userDataDir);
  }
});
