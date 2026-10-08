const { test, expect } = require("@playwright/test");
const { deflateSync } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const fixture = require("../fixtures/market-listing-items.json");
const { createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  getStoredUiPreferences } = require("./support/companion-app.cjs");

// Synthetic transport with production request construction, compressed response
// reduction, main cache/allowlist, preload and renderer. No real capture/server.
test("Market listing rolls, responsive alignment and saved state compose through real IPC", async () => {
  const userDataDir = createUserDataDir();
  const screenshotDir = process.env.HSC_MARKET_SCREENSHOT_DIR;
  let session;
  const size = async (width, height) => {
    await session.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(340, 160);
      window.setSize(bounds.width, bounds.height);
    }, { width, height });
  };
  const screenshot = async name => {
    if (!screenshotDir) return;
    fs.mkdirSync(screenshotDir, { recursive: true });
    await session.page.screenshot({ path: path.join(screenshotDir, name + ".png") });
  };
  const ready = async (account = "7-424242") => {
    await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate((_electron, text) => globalThis.heroSiegeCompanionE2e.emitSessionContext([123], [{
      text, direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921,
    }]), `api account_id=${account}&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0`);
  };
  const respond = async rows => {
    const body = Buffer.from(JSON.stringify({ status: 1, itemCount: rows.length,
      items: deflateSync(Buffer.from(JSON.stringify(rows))).toString("base64") }));
    await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...body]);
  };
  try {
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await size(1380, 1000);
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    const workspace = session.page.locator(".market-workspace");
    await workspace.locator("#market-item-query").fill("Battle Mage's Shield");
    await workspace.locator("#market-item-query").press("Enter");
    await workspace.locator("#market-saved-name").fill("Shield stats");
    await workspace.getByRole("button", { name: "Save item and filters", exact: true }).click();
    await ready();
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    const row = fixture.specimens[0].row;
    await respond([row, { ...row, price: 35000, item_data: { ...row.item_data, q: 1 } },
      { ...row, price: 45000, item_data: { ...row.item_data, w: 0 } }]);
    await workspace.locator(".market-chosen-item").scrollIntoViewIfNeeded();
    await screenshot("market-known-wide-editor");
    await workspace.getByRole("button", { name: "Search market", exact: true }).click();
    await expect(workspace.locator("tbody tr")).toHaveCount(3);
    const results = workspace.locator(".market-results");
    await expect(results.locator(".market-listing-item").first()).toContainText("Mana439");
    await expect(results.locator(".market-listing-item").first()).toContainText("Enhanced Defense124%");
    await expect(results.locator(".market-listing-item").nth(1)).toContainText("Stats unknown for this variant");
    await expect(results.locator(".market-listing-item").nth(2)).toContainText("Unidentified — rolls hidden");
    await expect(workspace.locator(".market-catalog-ranges")).toContainText("Mana300–450");
    await expect(workspace.locator(".market-result-details")).not.toHaveAttribute("open");
    const wide = await workspace.evaluate(root => {
      const box = selector => root.querySelector(selector).getBoundingClientRect();
      return { lefts: [".market-chosen-item", "#market-filters-title", "label[for=market-sockets]",
        "#market-sockets", "label[for=market-saved-name]", "#market-saved-name", "#market-results-title"]
        .map(selector => box(selector).left), filter: box("fieldset").width,
        ranges: box(".market-catalog-ranges").width, sameRow: box("fieldset").top === box(".market-catalog-ranges").top,
        title: box(".market-results-heading").bottom, table: box(".market-price-table").top,
        footer: box(".market-results-footer").top, tableBottom: box(".market-price-table").bottom,
        changeDistance: box(".market-chosen-item button").left - box(".market-chosen-item > div").right };
    });
    expect(Math.max(...wide.lefts) - Math.min(...wide.lefts)).toBeLessThan(2);
    expect(Math.abs(wide.filter - wide.ranges)).toBeLessThan(2);
    expect(wide.sameRow).toBe(true);
    expect(wide.table - wide.title).toBeLessThan(20);
    expect(wide.footer).toBeGreaterThanOrEqual(wide.tableBottom);
    expect(wide.changeDistance).toBeLessThan(25);
    await screenshot("market-known-wide");
    await workspace.locator(".market-results").scrollIntoViewIfNeeded();
    await screenshot("market-known-wide-results");
    await size(560, 1000);
    const narrow = await workspace.evaluate(root => {
      const filter = root.querySelector("fieldset").getBoundingClientRect();
      const ranges = root.querySelector(".market-catalog-ranges").getBoundingClientRect();
      const table = root.querySelector(".market-price-table");
      return { stacked: ranges.top > filter.bottom, sameLeft: Math.abs(filter.left - ranges.left),
        overflow: document.documentElement.scrollWidth > innerWidth, tableDisplay: getComputedStyle(table).display };
    });
    expect(narrow).toEqual({ stacked: true, sameLeft: 0, overflow: false, tableDisplay: "block" });
    await workspace.locator(".market-results").scrollIntoViewIfNeeded();
    await screenshot("market-known-narrow-results");
    await workspace.locator(".market-chosen-item").scrollIntoViewIfNeeded();
    await screenshot("market-known-narrow-editor");
    const stored = await getStoredUiPreferences(session.page);
    expect(stored.savedMarketItems.find(item => item.name === "Shield stats")).toMatchObject({ name: "Shield stats", itemKey: "unique:6:0:38",
      request: { itemMask: 1073766438, statFilters: [] } });
    expect(JSON.stringify(stored)).not.toMatch(/SYNTHETIC|fingerprint|370600734|"stats"|seller/);
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    await ready("7-424243");
    await expect(results.locator("tbody tr")).toHaveCount(0);
    await workspace.getByRole("button", { name: "Change item", exact: true }).click();
    await workspace.locator("#market-item-query").fill("Sharpshooter's Cloak");
    await workspace.locator("#market-item-query").press("Enter");
    await expect(workspace.locator(".market-catalog-ranges")).toContainText("Catalog ranges are not available");
    await size(1380, 1000);
    await screenshot("market-cloak-unknown-ranges");
    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    await session.page.locator(".market-saved-load").filter({ hasText: "Shield stats" }).click();
    await expect(session.page.locator(".market-chosen-item")).toContainText("Battle Mage's Shield");
    await expect(session.page.locator(".market-catalog-ranges")).toContainText("Mana300–450");
    await expect(session.page.locator("tbody tr")).toHaveCount(0);
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
  } finally {
    if (session) await closeCompanionApp(session);
    if (path.dirname(path.resolve(userDataDir)) !== path.resolve(os.tmpdir())
      || !path.basename(userDataDir).startsWith("hsc-e2e-")) throw new Error("Unexpected test profile location");
    cleanupUserDataDir(userDataDir);
  }
});
