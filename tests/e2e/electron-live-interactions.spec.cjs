const { test, expect } = require("@playwright/test");
const {
  emitCapturePayloads,
  getMainWindowState,
  waitForRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eTrafficPayloads } = require("./support/fixtures.cjs");

const THEME_IDS = ["dark", "demonsteel", "voidglass", "reliquary", "cyberpunk", "light"];

test("collapses and expands live dashboard cards without losing their content", async () => {
  await withCompanionApp(async ({ page }) => {
    const trackedCard = page.locator(".items-panel.live-dashboard-card");
    const trackedBody = page.locator("#tracked-drops-card-body");
    const toggle = trackedCard.locator(".dashboard-card-toggle");

    await expect(trackedBody).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", "Collapse Tracked Items");
    await toggle.click();
    await expect(trackedBody).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-label", "Expand Tracked Items");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(trackedBody).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", "Collapse Tracked Items");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

test("shows intercepted Satanic Zone packets in the compact SZ details drawer", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());
    await waitForRendererState(
      page,
      (nextState) => nextState.stats.satanicZone?.zone?.includes("Act 1") && nextState.health.parsedEvents >= 4,
      { message: "mocked traffic should provide a Satanic Zone before compact details open" },
    );

    await expect(page.getByText(/Act 1/).first()).toBeVisible();
    assertEffectColorsDistinct(
      await readEffectColorsByTheme(page, ".buff-pro", ".buff-con"),
      "live Satanic Zone",
    );

    await page.getByRole("button", { name: "Compact mode" }).click();
    await expect(page.locator(".compact-view")).toBeVisible();

    const compactWindow = await getMainWindowState(electronApp);
    expect(compactWindow.compactMode).toBe(true);

    await page.getByRole("button", { name: "Show Satanic Zone page" }).click();
    const drawer = page.locator(".compact-zone-page");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(/Act 1/);
    await expect(drawer).toContainText("Pros");
    await expect(drawer).toContainText("Cons");
    assertEffectColorsDistinct(
      await readEffectColorsByTheme(page, ".compact-zone-pros", ".compact-zone-cons"),
      "compact Satanic Zone",
    );

    await page.keyboard.press("Home");
    await expect(drawer).toHaveCount(0);
    await page.mouse.move(120, 140);
    await page.mouse.wheel(0, -120);
    await expect(drawer).toBeVisible();
  });
});

async function readEffectColorsByTheme(page, proSelector, conSelector) {
  return page.evaluate(({ themes, proSelector: nextProSelector, conSelector: nextConSelector }) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    function renderedColor(element) {
      if (!element) return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    }
    return themes.map((theme) => {
      document.documentElement.dataset.theme = theme;
      const pro = document.querySelector(`${nextProSelector} strong`);
      const con = document.querySelector(`${nextConSelector} strong`);
      return {
        theme,
        proColor: renderedColor(pro),
        conColor: renderedColor(con),
      };
    });
  }, { themes: THEME_IDS, proSelector, conSelector });
}

function assertEffectColorsDistinct(colorReports, surface) {
  for (const report of colorReports) {
    const proColor = report.proColor;
    const conColor = report.conColor;
    expect(proColor, `${surface} ${report.theme} pro color`).not.toBeNull();
    expect(conColor, `${surface} ${report.theme} con color`).not.toBeNull();
    expect(colorDistance(proColor, conColor), `${surface} ${report.theme} pro/con color distance`)
      .toBeGreaterThan(80);
  }
}

function colorDistance(first, second) {
  return Math.sqrt(first.reduce((sum, channel, index) => sum + ((channel - second[index]) ** 2), 0));
}
