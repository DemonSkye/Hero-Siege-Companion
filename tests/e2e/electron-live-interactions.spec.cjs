const { test, expect } = require("@playwright/test");
const {
  emitCapturePayloads,
  getMainWindowState,
  waitForRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eTrafficPayloads } = require("./support/fixtures.cjs");

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
    await page.getByRole("button", { name: "Compact mode" }).click();
    await expect(page.locator(".compact-view")).toBeVisible();

    const compactWindow = await getMainWindowState(electronApp);
    expect(compactWindow.compactMode).toBe(true);

    await page.getByRole("button", { name: "SZ Details" }).click();
    const drawer = page.getByLabel("Satanic zone details");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(/Act 1/);
    await expect(drawer).toContainText("Pros");
    await expect(drawer).toContainText("Cons");

    await drawer.getByRole("button", { name: "Dismiss zone details" }).click();
    await expect(drawer).toHaveCount(0);
  });
});
