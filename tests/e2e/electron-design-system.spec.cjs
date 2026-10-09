const { test, expect } = require("@playwright/test");
const accepted = require("../fixtures/market-accepted-transformed.json");
const {
  emitCapturePayloads,
  getRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eTrafficPayloads } = require("./support/fixtures.cjs");

const THEMES = ["dark", "demonsteel", "voidglass", "reliquary", "cyberpunk", "light"];

test("navigates real views by keyboard and keeps nested confirmations inside Settings", async () => {
  await withCompanionApp({ seedPastRuns: true }, async ({ page, electronApp }) => {
    await blockExternalRequests(page);
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await chooseTheme(page, "dark");
    await page.getByRole("tab", { name: "Live Session" }).focus();
    await page.keyboard.press("ArrowRight");
    const filter = page.getByRole("tab", { name: "Item Filter", exact: true });
    await expect(filter).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Item Filter" })).toBeVisible();
    await expect(page.locator("#view-panel-live")).toBeHidden();
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(4);
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await page.getByLabel("New filter group name").fill("Visual review group");
    await page.getByRole("button", { name: "Add group", exact: true }).click();
    await expect(page.getByText("Visual review group", { exact: true }).first()).toBeVisible();
    await filter.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Market", exact: true })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Market" })).toBeVisible();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Past Runs" })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Past Runs" })).toBeVisible();
    await page.getByPlaceholder("Tags, drops, resources, character, stats").fill("farming");
    await expect(page.locator(".past-run-library")).toContainText("E2E Paladin");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("tab", { name: "Past Runs" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Live Session" })).toBeFocused();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
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
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(deepRow.getByRole("button", { name: "Start 10 min…", exact: true })).toBeFocused();
  });
});

test("honors public surfaces and inputs across the six themes and both window modes", async () => {
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
    await appTheme.selectOption("light");
    await settings.getByLabel("Compact theme", { exact: true }).selectOption("match");
    await settings.getByRole("button", { name: "Close settings" }).click();
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
    await page.getByRole("button", { name: "SZ Details", exact: true }).click();
    await expect(page.getByLabel("Satanic zone details")).toContainText("Act 1");
  });
});

test("themes Market tab readiness, results and errors with semantic roles", async () => {
  test.setTimeout(90_000);
  await withCompanionApp({ marketTransport: true }, async ({ page, electronApp }) => {
    await blockExternalRequests(page);
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await chooseTheme(page, "light");
    await page.getByRole("button", { name: "Check Aurelion Fury on the market" }).click();
    await expect(page.getByRole("tab", { name: "Market", exact: true })).toHaveAttribute("aria-selected", "true");
    const market = page.getByRole("tabpanel", { name: "Market" });
    await expect(market.locator(".market-chosen-item")).toContainText("Aurelion Fury");
    const search = market.getByRole("button", { name: "Search market", exact: true });
    await expect(search).toBeDisabled();
    for (const theme of THEMES) {
      await chooseTheme(page, theme);
      const colors = await semanticMarketColors(page);
      expect(colors.readiness, theme).toBe(colors.text);
      expect(colors.detail, theme).toBe(colors.muted);
    }

    await makeMarketReady(electronApp, page);
    await electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(500, bytes), [...Buffer.from("{}")]);
    await search.click();
    const alert = market.getByRole("alert");
    await expect(alert).toBeVisible();
    for (const theme of THEMES) {
      await chooseTheme(page, theme);
      const colors = await semanticMarketColors(page);
      expect(colors.error, theme).toBe(colors.text);
    }

    await electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...Buffer.from(accepted.response.bodyBase64, "base64")]);
    await expect(search).toBeEnabled({ timeout: 20_000 });
    await search.click();
    await expect(market.locator("tbody tr")).toHaveCount(20);
    for (const theme of THEMES) {
      await chooseTheme(page, theme);
      const colors = await semanticMarketColors(page);
      expect(colors.resultsNote, theme).toBe(colors.muted);
      expect(colors.readiness, theme).toBe(colors.text);
    }
  });
});

async function makeMarketReady(electronApp, page) {
  await electronApp.evaluate(() => {
    globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [{
      direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
      localAddress: "192.0.2.10", localPort: 5000,
      text: "account_id=7-424242&unique_account_id=SYNTHETIC-design-uid&crossregion_identifier=SYNTHETIC-design-session&season=11&hardcore=0&beta=0",
    }]);
  });
  await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
}

async function chooseTheme(page, theme, compactTheme) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await settings.getByLabel("App theme", { exact: true }).selectOption(theme);
  if (compactTheme) await settings.getByLabel("Compact theme", { exact: true }).selectOption(compactTheme);
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

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
      readiness: color(".market-workspace .market-readiness-label"),
      detail: color(".market-workspace .market-readiness-detail"),
      resultsNote: color(".market-workspace .market-results-heading small"),
      error: color(".market-workspace .market-results .market-search-error"),
      muted: resolve("--app-muted"),
      text: resolve("--app-text"),
    };
    probe.remove();
    return report;
  });
}

async function blockExternalRequests(page) {
  await page.context().route(/^https?:\/\//u, (route) => route.abort());
}
