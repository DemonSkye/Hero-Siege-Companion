const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
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
    const contrastReports = [];
    for (const theme of THEMES) {
      await market.getByRole("button", { name: "Close market search" }).click();
      await chooseTheme(page, theme);
      await marketButton.click();
      await search.click();
      const alert = market.getByRole("alert");
      await expect(alert).toBeVisible();
      const contrast = await renderedTextContrast(page, alert);
      contrastReports.push({ theme, ...contrast });
      expect.soft(contrast.minimum, `${theme}: rendered normal error text`).toBeGreaterThanOrEqual(4.5);
    }
    const contrastPath = testInfo.outputPath("market-error-contrast.json");
    fs.writeFileSync(contrastPath, JSON.stringify(contrastReports, null, 2));
    await testInfo.attach("market-error-contrast.json", { path: contrastPath, contentType: "application/json" });
    await screenshot(page, testInfo, "market-error-light.png");
  });
});

test("keeps supplied palettes usable at minimum full size and with eight compact tiles", async ({}, testInfo) => {
  test.setTimeout(90_000);
  await withCompanionApp({ seedPastRuns: true }, async ({ page, electronApp }) => {
    await blockExternalRequests(page);
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 700, false));
    for (const theme of THEMES) {
      await chooseTheme(page, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await assertVisibleLayout(page, ".live-dashboard-card", theme);
      await screenshot(page, testInfo, `live-minimum-${theme}.png`);
    }
    for (const [view, panel, filename] of [
      ["Item Filter", "#view-panel-filter", "item-filter-minimum-light.png"],
      ["Past Runs", "#view-panel-past", "report-desk-minimum-light.png"],
    ]) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      await expect(page.getByRole("tabpanel", { name: view })).toBeVisible();
      await assertVisibleLayout(page, panel, view);
      await screenshot(page, testInfo, filename);
    }
    await page.getByRole("tab", { name: "Live Session" }).click();
    await page.getByRole("button", { name: "Compact mode", exact: true }).click();
    await page.getByRole("button", { name: "Customize compact mode", exact: true }).click();
    const customization = page.getByRole("dialog", { name: "Customize Compact Mode", exact: true });
    await customization.locator(".compact-preset-button").filter({ hasText: "Resource Focused" }).click();
    for (const tile of ["Kills", "Angelic"]) {
      await customization.getByRole("button", { name: "Add Tile", exact: true }).click();
      await customization.getByRole("menuitem", { name: tile, exact: true }).click();
    }
    await expect(customization.locator(".compact-selected-list > li")).toHaveCount(8);
    await expect(customization.getByRole("button", { name: "Add Tile", exact: true })).toBeDisabled();
    await expect(customization.getByRole("button", { name: "Remove Duration", exact: true })).toHaveCount(0);
    await customization.getByRole("button", { name: "Close compact customization" }).click();
    for (const theme of THEMES) {
      const exitCompact = page.getByRole("button", { name: "Exit compact mode", exact: true });
      if (await exitCompact.isVisible()) await exitCompact.click();
      await chooseTheme(page, theme, theme);
      await page.getByRole("button", { name: "Compact mode", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".compact-cover-grid > div")).toHaveCount(8);
      await assertVisibleLayout(page, ".compact-cover-grid > div", `compact ${theme}`);
      await expect(page.getByRole("button", { name: "Pause Run", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "End Run", exact: true })).toBeVisible();
      await screenshot(page, testInfo, `compact-eight-${theme}.png`);
    }
  });
});

async function chooseTheme(page, theme, compactTheme) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await settings.getByLabel("App theme", { exact: true }).selectOption(theme);
  if (compactTheme) await settings.getByLabel("Compact theme", { exact: true }).selectOption(compactTheme);
  await settings.getByRole("button", { name: "Close settings" }).click();
}

async function assertVisibleLayout(page, selector, label) {
  const layout = await page.evaluate((selector) => {
    const rects = [...document.querySelectorAll(selector)].map((element) => element.getBoundingClientRect());
    const clippedControls = [...document.querySelectorAll(".window-controls button, .compact-run-cover-controls button")]
      .some((button) => button.scrollWidth > button.clientWidth + 1);
    const overlaps = rects.some((rect, index) => rects.slice(index + 1).some((other) =>
      Math.max(0, Math.min(rect.right, other.right) - Math.max(rect.left, other.left))
        * Math.max(0, Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top)) > 4));
    return {
      count: rects.length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offscreen: rects.some((rect) => rect.width <= 0 || rect.height <= 0 || rect.left < -1 || rect.right > innerWidth + 1),
      clippedControls, overlaps,
    };
  }, selector);
  expect(layout.count, label).toBeGreaterThan(0);
  expect(layout.overflow, label).toBeLessThanOrEqual(1);
  expect(layout.offscreen, label).toBe(false);
  expect(layout.clippedControls, label).toBe(false);
  expect(layout.overlaps, label).toBe(false);
}

// Sample actual composited pixels inside the alert's right padding, clear of text
// and borders. Computed text color is rasterized by Chromium so modern CSS color
// syntax is supported. This catches alpha/backdrop/theme interactions as well as
// token values; it covers supplied palettes, not arbitrary imported overrides.
async function renderedTextContrast(page, alert) {
  const foreground = await alert.evaluate((element) => getComputedStyle(element).color);
  const png = await alert.screenshot({ animations: "disabled", scale: "css" });
  return page.evaluate(async ({ foreground, png }) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    canvas.width = image.width;
    canvas.height = image.height;
    context.drawImage(image, 0, 0);
    const backgrounds = [0.25, 0.5, 0.75].flatMap((fraction) => [5, 8, 11].map((inset) =>
      [...context.getImageData(image.width - inset, Math.floor(image.height * fraction), 1, 1).data].slice(0, 3)));
    context.fillStyle = foreground;
    context.fillRect(0, 0, 1, 1);
    const text = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const luminance = (rgb) => rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const textLuminance = luminance(text);
    const ratios = backgrounds.map((rgb) => {
      const backgroundLuminance = luminance(rgb);
      return (Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05);
    });
    return { foreground: text, backgrounds, minimum: Math.min(...ratios) };
  }, { foreground, png: png.toString("base64") });
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
