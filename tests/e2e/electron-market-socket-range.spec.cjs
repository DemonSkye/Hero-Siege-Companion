const { test, expect } = require("@playwright/test");
const accepted = require("../fixtures/market-accepted-transformed.json");
const { createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp, getStoredUiPreferences } = require("./support/companion-app.cjs");

// Real Electron/preload/main/worker with fixture transport and fake capture.
test("socket ranges use actual worker fields, item-specific hints and transparent persistence", async () => {
  const userDataDir = createUserDataDir(); let session;
  try {
    session = await launchCompanionApp({ userDataDir, marketTransport: true, gameRunning: false });
    await session.page.evaluate(() => localStorage.setItem("hero-siege-companion:preferences:v1", JSON.stringify({
      schemaVersion: 3, shoppingListItems: [], savedMarketItems: [
        { id: "old-glove", name: "Legacy glove", itemKey: "unique:4:0:0", request: { itemMask: 1073758208, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] } },
        { id: "bad-range", name: "Reversed legacy range", itemKey: "unique:1:0:100", criteria: { minSockets: 5, maxSockets: 2, statFilters: [{ statId: 64, minimum: 8 }] } },
      ],
    })));
    await session.page.reload(); await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    let workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({ hasText: "Legacy glove" }).click();
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");
    await expect(workspace.locator(".market-socket-hint")).toContainText("unverified");
    await workspace.getByRole("button", { name: "Change item", exact: true }).click();
    await workspace.locator("#market-item-query").fill("Tiny Planet"); await workspace.locator("#market-item-query").press("Enter");
    await expect(workspace.locator("#market-sockets")).toHaveCount(0);
    await expect(workspace).toContainText("Socket range cleared");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("8");
    await workspace.getByRole("button", { name: /Add optional socket filters/ }).click();
    await expect(workspace.locator("#market-sockets-max")).toHaveValue("");
    await workspace.getByRole("button", { name: "Change item", exact: true }).click();
    await workspace.locator("#market-item-query").fill("Zealot's Deathbringers"); await workspace.locator("#market-item-query").press("Enter");
    await expect(workspace.locator(".market-socket-hint")).toContainText("Base socket range: 1\u20132");
    await expect(workspace.locator("#market-sockets-max")).toHaveAttribute("max", "6");
    await workspace.locator("#market-sockets").fill("5"); await workspace.locator("#market-sockets-max").fill("4");
    await expect(workspace).toContainText("Minimum sockets must be less than or equal to maximum sockets.");
    await expect(workspace.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await workspace.locator("#market-sockets").fill("2");
    const screenshotDir = process.env.HSC_MARKET_SOCKET_SCREENSHOT_DIR;
    if (screenshotDir) {
      const fs = require("node:fs"), path = require("node:path");
      fs.mkdirSync(screenshotDir, { recursive: true });
      for (const [name, width] of [["wide", 1380], ["narrow", 560]]) {
        await session.electronApp.evaluate(({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(340, 300); window.setSize(width, 1000);
        }, width);
        await workspace.locator("#market-sockets-max").scrollIntoViewIfNeeded();
        const bounds = await workspace.locator(".market-socket-bounds").evaluate(element => {
          const [minimum, maximum] = [...element.querySelectorAll("input")].map(input => input.getBoundingClientRect());
          return { minWidth: minimum.width, maxWidth: maximum.width, minRight: minimum.right, maxLeft: maximum.left, maxRight: maximum.right, viewport: innerWidth };
        });
        expect(bounds.minWidth).toBeGreaterThan(80); expect(bounds.maxWidth).toBeGreaterThan(80);
        expect(bounds.minRight).toBeLessThanOrEqual(bounds.maxLeft); expect(bounds.maxRight).toBeLessThanOrEqual(bounds.viewport);
        await session.page.screenshot({ path: path.join(screenshotDir, `socket-range-${name}.png`) });
      }
    }
    await workspace.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems[0].criteria)
      .toEqual({ minSockets: 2, maxSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] });
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([123], [{
      text: "api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921,
    }]));
    // Accepted gloves response is a transport/projection control, not evidence
    // that the server honored this synthetic item's socket range.
    await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...Buffer.from(accepted.response.bodyBase64, "base64")]);
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    expect(await session.page.evaluate(() => window.heroSiegeCompanion.searchMarket({ itemMask: 1073758226, maxSockets: 7, statFilters: [] })))
      .toMatchObject({ ok: false, errorCode: "request_rejected" });
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await workspace.getByRole("button", { name: "Search market", exact: true }).click();
    await expect(workspace.locator("tbody tr")).toHaveCount(20);
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestLastFilters())).toEqual({
      filter_masks: "[1073758226]", filter_runeword: null, filter_sockets_min: "2", filter_sockets_max: "4",
      stat_filter: "W3sic3RhdElkIjo2NCwiZmlsdGVyIjoyLCJzdGF0VmFsdWUiOjh9XQ==",
    });
    await closeCompanionApp(session); session = await launchCompanionApp({ userDataDir, marketTransport: true, gameRunning: false });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click(); workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({ hasText: "Legacy glove" }).click();
    await expect(workspace.locator("#market-sockets")).toHaveValue("2"); await expect(workspace.locator("#market-sockets-max")).toHaveValue("4");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("8");
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await workspace.locator(".market-saved-load").filter({ hasText: "Reversed legacy range" }).click();
    await expect(workspace.locator("#market-sockets")).toHaveValue(""); await expect(workspace.locator("#market-sockets-max")).toHaveValue("");
    await expect(workspace).toContainText("minimum was greater than maximum");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("8");
  } finally { if (session) await closeCompanionApp(session); cleanupUserDataDir(userDataDir); }
});
