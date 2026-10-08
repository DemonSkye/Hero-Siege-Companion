const { test, expect } = require("@playwright/test");
const { deflateSync } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const fixture = require("../fixtures/market-listing-items.json");
const { createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  getStoredUiPreferences } = require("./support/companion-app.cjs");

async function resize(session, width, height) {
  await session.electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(340, 160);
    window.setSize(bounds.width, bounds.height);
  }, { width, height });
  await expect.poll(() => session.page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width, height });
}

async function capture(session, name) {
  // Electron resize/scroll layout can settle before Chromium commits the new
  // scrolling layer. Wait for paint frames; DOM visibility alone missed blanks.
  await session.page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const directory = process.env.HSC_MARKET_SCREENSHOT_DIR;
  if (directory) fs.mkdirSync(directory, { recursive: true });
  const suffix = test.info().repeatEachIndex ? `-${test.info().repeatEachIndex}` : "";
  return session.page.screenshot(directory ? { path: path.join(directory, name + suffix + ".png") } : {});
}

async function expectPaintedText(session, locator, bytes, name) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeInViewport({ ratio: 1 });
  const rect = await locator.boundingBox();
  const paint = await session.electronApp.evaluate(({ nativeImage }, { bytes, rect }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    let lightPixels = 0;
    for (let y = Math.max(0, Math.ceil(rect.y)); y < Math.min(height, Math.floor(rect.y + rect.height)); y++) {
      for (let x = Math.max(0, Math.ceil(rect.x)); x < Math.min(width, Math.floor(rect.x + rect.width)); x++) {
        const index = (y * width + x) * 4;
        if (bitmap[index] > 140 && bitmap[index + 1] > 140 && bitmap[index + 2] > 140) lightPixels++;
      }
    }
    return { width, height, lightPixels };
  }, { bytes: [...bytes], rect });
  const diagnostics = await session.page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    visibility: document.visibilityState, scrollTop: document.querySelector(".app-scroll").scrollTop }));
  const directory = process.env.HSC_MARKET_SCREENSHOT_DIR;
  if (directory) fs.writeFileSync(path.join(directory, `${name}-paint-${test.info().repeatEachIndex}.json`),
    JSON.stringify({ paint, rect, diagnostics }, null, 2));
  // Default dark theme: these pixels belong to light text, not panel/background.
  expect(paint.lightPixels, `${name} must be painted in the saved image, not just present in the DOM`).toBeGreaterThan(40);
}

// Synthetic transport with production request construction, compressed response
// reduction, main cache/allowlist, preload and renderer. No real capture/server.
test("Market listing rolls, responsive alignment and saved state compose through real IPC", async () => {
  const userDataDir = createUserDataDir();
  let session;
  const size = (width, height) => resize(session, width, height);
  const screenshot = name => capture(session, name);
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
    await expect(results.locator("tbody tr")).toHaveCount(3);
    await expect(results.locator(".market-listing-item").first()).toContainText("Mana439");
    await expect(results.locator(".market-listing-item").first()).toBeInViewport({ ratio: 1 });
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
    await expect(results.locator("tbody tr")).toHaveCount(3);
    await expect(results.locator(".market-listing-item").first()).toContainText("Mana439");
    await expect(results.locator(".market-listing-item").first()).toBeInViewport({ ratio: 1 });
    const narrowBytes = await screenshot("market-known-narrow-results");
    await expectPaintedText(session, results.locator(".market-listing-stats li").filter({ hasText: /^Mana439$/ }),
      narrowBytes, "market-known-narrow-results");
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

for (const specimen of [
  { name: "Tiny Planet", slug: "tiny-planet", row: { price: 1, unit_price: 1, fingerprint: "SYNTHETIC-0-0-10",
    item_data: { c: 1, b: 92, j: 0, d: 1, e: 11, w: 1, a: 618478963 } },
    catalog: "Increased Orbital Projectile Duration15%–25%", listing: "Listing rolls are not verified for this item" },
  { name: "Bob's Piece of Plywood", slug: "bobs-plywood", row: fixture.specimens[1].row,
    catalog: "10% Chance when Struck: Chainsaw Massacre (Level 40)", listing: "10% Chance when Struck: Chainsaw Massacre (Level 40)" },
]) {
  test(`${specimen.name} preserves its verified display scope through main and preload`, async () => {
    const session = await launchCompanionApp({ marketTransport: true });
    try {
      await resize(session, 1380, 1000);
      await session.page.getByRole("tab", { name: "Market", exact: true }).click();
      const workspace = session.page.locator(".market-workspace");
      await workspace.locator("#market-item-query").fill(specimen.name);
      await workspace.locator("#market-item-query").press("Enter");
      await expect(workspace.locator(".market-catalog-ranges")).toContainText(specimen.catalog);
      await expect(workspace.locator(".market-catalog-ranges")).not.toContainText("Catalog ranges are not available");
      await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
      await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([123], [{
        text: "api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
        direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921,
      }]));
      const body = Buffer.from(JSON.stringify({ status: 1, itemCount: 1,
        items: deflateSync(Buffer.from(JSON.stringify([specimen.row]))).toString("base64") }));
      await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...body]);
      await workspace.getByRole("button", { name: "Search market", exact: true }).click();
      const listing = workspace.locator(".market-listing-details");
      await expect(listing).toContainText(specimen.listing);
      await expect(workspace).not.toContainText(/Triggered skill ID|Unknown stat 18[67]/);
      if (specimen.slug === "tiny-planet") await expect(listing).not.toContainText(/Actual listing rolls|22%/);
      else await expect(listing).toContainText("Strength27");
      await workspace.locator(".market-results").scrollIntoViewIfNeeded();
      await capture(session, `market-${specimen.slug}-wide-results`);
      await resize(session, 560, 1000);
      await workspace.locator(".market-results").scrollIntoViewIfNeeded();
      const name = `market-${specimen.slug}-narrow-results`;
      const bytes = await capture(session, name);
      await expectPaintedText(session, listing.getByText(specimen.listing, { exact: true }), bytes, name);
      expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    } finally {
      await closeCompanionApp(session);
      if (path.dirname(path.resolve(session.userDataDir)) !== path.resolve(os.tmpdir())
        || !path.basename(session.userDataDir).startsWith("hsc-e2e-")) throw new Error("Unexpected test profile location");
      cleanupUserDataDir(session.userDataDir);
    }
  });
}
