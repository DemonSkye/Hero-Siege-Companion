const { test, expect } = require("@playwright/test");
const {
  emitCapturePayloads,
  getStoredUiPreferences,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eTrafficPayloads } = require("./support/fixtures.cjs");

const THEMES = ["dark", "demonsteel", "voidglass", "reliquary", "cyberpunk", "light"];

test("navigates real views by keyboard and keeps nested confirmations inside Settings", async ({}, testInfo) => {
  await withCompanionApp({ seedPastRuns: true }, async ({ page, electronApp }) => {
    await blockExternalRequests(page);
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Appearance", exact: true }).click();
    await settings.getByLabel("App theme", { exact: true }).selectOption("dark");
    await settings.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("tab", { name: "Live Session" }).focus();
    await page.keyboard.press("ArrowRight");
    const filter = page.getByRole("tab", { name: "Item Filter", exact: true });
    await expect(filter).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Item Filter" })).toBeVisible();
    await expect(page.locator("#view-panel-live")).toBeHidden();
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(3);
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await page.getByLabel("New filter group name").fill("Visual review group");
    await page.getByRole("button", { name: "Add group", exact: true }).click();
    await expect(page.getByText("Visual review group", { exact: true }).first()).toBeVisible();
    await screenshot(page, testInfo, "item-filter-dark.png");
    await filter.focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Past Runs" })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Past Runs" })).toBeVisible();
    await page.getByPlaceholder("Tags, drops, resources, character, stats").fill("farming");
    await expect(page.locator(".past-run-library")).toContainText("E2E Paladin");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await screenshot(page, testInfo, "report-desk-dark.png");
    await page.getByRole("tab", { name: "Past Runs" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Live Session" })).toBeFocused();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.getByRole("button", { name: "Help & Support", exact: true }).click();
    const deepRow = settings.locator("details").filter({ hasText: "Deep diagnostics" }).first();
    await deepRow.locator("summary").click();
    await deepRow.getByRole("button", { name: "Start 10 min…", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Start deep diagnostics for 10 minutes?" });
    await expect(confirmation).toBeVisible();
    const close = confirmation.getByRole("button", { name: "Close dialog" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirmation.getByRole("button", { name: "Start 10 Minutes", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await screenshot(page, testInfo, "settings-confirmation-dark.png");
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(deepRow.getByRole("button", { name: "Start 10 min…", exact: true })).toBeFocused();
  });
});

test("honors public surfaces and inputs across the six themes and both window modes", async ({}, testInfo) => {
  test.setTimeout(60_000);
  await withCompanionApp(async ({ page, electronApp }) => {
    await blockExternalRequests(page);
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Appearance", exact: true }).click();
    const appTheme = settings.getByLabel("App theme", { exact: true });
    expect(await appTheme.locator("option").evaluateAll((options) => options.map((option) => option.value))).toEqual(THEMES);
    for (const theme of THEMES) {
      await appTheme.selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--surface", "rgb(25, 50, 75)");
        document.documentElement.style.setProperty("--input-bg", "rgb(45, 65, 85)");
        document.documentElement.style.setProperty("--surface-cell", "rgb(65, 85, 105)");
      });
      await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(25, 50, 75)");
      await expect(appTheme).toHaveCSS("background-color", "rgb(45, 65, 85)");
      await expect(page.locator(".timeline-row").first()).toHaveCSS("background-color", "rgb(65, 85, 105)");
      await page.evaluate(() => ["--surface", "--input-bg", "--surface-cell"].forEach((key) => document.documentElement.style.removeProperty(key)));
    }
    await appTheme.selectOption("dark");
    await settings.getByRole("button", { name: "Close settings" }).click();
    await screenshot(page, testInfo, "live-dark.png");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.getByRole("button", { name: "Appearance", exact: true }).click();
    await appTheme.selectOption("light");
    await settings.getByLabel("Compact theme", { exact: true }).selectOption("match");
    await settings.getByRole("button", { name: "Close settings" }).click();
    await screenshot(page, testInfo, "live-light.png");
    await page.locator("#item-timeline-card").scrollIntoViewIfNeeded();
    await screenshot(page, testInfo, "live-light-timeline.png");
    await page.getByRole("button", { name: "Compact mode" }).click();
    await expect(page.getByRole("button", { name: "Pause Run", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Pause Run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume Run", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resume Run", exact: true }).click();
    for (const theme of THEMES) {
      await page.evaluate((id) => {
        document.documentElement.dataset.theme = id;
        document.documentElement.style.setProperty("--surface", "rgb(25, 50, 75)");
      }, theme);
      await expect(page.locator(".compact-run-cover")).toHaveCSS("background-color", "rgb(25, 50, 75)");
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipped: [...document.querySelectorAll(".compact-run-cover-controls button")].some((button) => button.scrollWidth > button.clientWidth + 1),
      }));
      expect(layout.overflow, theme).toBeLessThanOrEqual(1);
      expect(layout.clipped, theme).toBe(false);
      await page.evaluate(() => document.documentElement.style.removeProperty("--surface"));
    }
    await screenshot(page, testInfo, "compact-light.png");
    await page.getByRole("button", { name: "SZ Details", exact: true }).click();
    await expect(page.getByLabel("Satanic zone details")).toContainText("Act 1");
    await screenshot(page, testInfo, "compact-light-zone.png");
  });
});

test("themes Timeline Market readiness, results and errors with native disclosure focus", async ({}, testInfo) => {
  test.setTimeout(60_000);
  await withCompanionApp(async ({ page, electronApp }) => {
    await blockExternalRequests(page);
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Appearance", exact: true }).click();
    await settings.getByLabel("App theme", { exact: true }).selectOption("light");
    await settings.getByRole("button", { name: "Help & Support", exact: true }).click();
    for (let press = 0; press < 4; press += 1) await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await getStoredUiPreferences(page)).marketSearchEnabled).toBe(true);
    await settings.getByRole("button", { name: "Close settings" }).click();
    const marketButton = page.getByRole("button", { name: "Check Aurelion Fury on the market" });
    await marketButton.click();
    const market = page.getByRole("dialog", { name: "Aurelion Fury", exact: true });
    await expect(market).toBeVisible();
    const summary = market.locator(".market-readiness > summary");
    const search = market.getByRole("button", { name: "Search market", exact: true });
    await expect(search).toBeDisabled();
    // Closing/reopening restores the invoking Timeline control without starting a lookup.
    await page.keyboard.press("Escape");
    await expect(marketButton).toBeFocused();
    await marketButton.click();
    await market.getByRole("button", { name: "Close market search" }).focus();
    await page.keyboard.press("Tab");
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(market.locator(".market-readiness")).toHaveAttribute("open", "");

    // Isolated E2E process: display-safe evidence and a synthetic IPC response only.
    await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
      const state = globalThis.heroSiegeCompanionE2e.getState();
      state.marketReadiness = {
        phase: "ready", reason: null, missingFields: [], sessionCurrent: true,
        regionQualified: true, expiresAt: Date.now() + 60_000, canSearch: true,
      };
      BrowserWindow.getAllWindows()[0].webContents.send("state:updated", state);
      ipcMain.removeHandler("market:search");
      ipcMain.handle("market:search", async () => ({
        ok: true, result: { listings: [{ price: 125_000 }, { price: 175_000 }], totalMatches: 2 },
        observedAt: Date.now(), cached: false,
      }));
    });
    await expect(search).toBeEnabled();
    await search.click();
    await expect(market.locator(".market-search-price-grid")).toContainText("125,000 gold");
    await summary.click();
    for (const theme of THEMES) {
      await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, theme);
      const colors = await semanticMarketColors(page);
      expect(colors.note, theme).toBe(colors.muted);
      expect(colors.price, theme).toBe(colors.warm);
      expect(colors.readiness, theme).toBe(colors.text);
      await expect(market.locator(".market-search-price-grid article").first()).toBeVisible();
    }
    await screenshot(page, testInfo, "market-results-light.png");
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("market:search");
      ipcMain.handle("market:search", async () => ({ ok: false, errorCode: "timed_out" }));
    });
    await search.click();
    await expect(market.getByRole("alert")).toBeVisible();
    for (const theme of THEMES) {
      await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, theme);
      const colors = await semanticMarketColors(page);
      expect(colors.error, theme).toBe(colors.danger);
    }
    await screenshot(page, testInfo, "market-error-light.png");
  });
});

async function semanticMarketColors(page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    function resolve(token) {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    }
    function color(selector) {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).color : null;
    }
    const report = {
      note: color(".market-search-cache-note"), price: color(".market-search-price-grid strong"),
      readiness: color(".market-readiness"), error: color(".market-search-error"),
      muted: resolve("--app-muted"), warm: resolve("--accent-warm"),
      text: resolve("--app-text"), danger: resolve("--danger"),
    };
    probe.remove();
    return report;
  });
}

async function blockExternalRequests(page) {
  await page.context().route(/^https?:\/\//u, (route) => route.abort());
}

async function screenshot(page, testInfo, filename) {
  if (process.env.HSC_UX_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: testInfo.outputPath(filename) });
}
