const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { withCompanionApp } = require("./support/companion-app.cjs");
test("private one-request recording opts in and cancels through real main/preload/UI without sending", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page, userDataDir }) => {
    const folder = path.join(userDataDir, "private-market-diagnostics");
    expect(fs.existsSync(folder)).toBe(false);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Help & Support", exact: true }).click();
    await page.getByText("Private Market request", { exact: true }).click();
    await expect(page.getByText(/It can contain reusable sign-in values/)).toBeVisible();
    expect(await page.evaluate(() => window.heroSiegeCompanion.getMarketPrivateDiagnosticState())).toEqual({ phase: "off" });
    await page.getByRole("button", { name: "Save next Market request locally", exact: true }).click();
    const state = await page.evaluate(() => window.heroSiegeCompanion.getMarketPrivateDiagnosticState());
    expect(state.phase).toBe("armed"); expect(path.dirname(state.filePath)).toBe(folder);
    expect(fs.existsSync(state.filePath)).toBe(false);
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
    expect((await page.evaluate(() => window.heroSiegeCompanion.getMarketPrivateDiagnosticState())).phase).toBe("off");
    expect(fs.existsSync(state.filePath)).toBe(false);
  });
});
