const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp, getRendererState, emitCapturePayloads } = require("./support/companion-app.cjs");
const { e2eTrafficPayloads } = require("./support/fixtures.cjs");
const accepted = require("../fixtures/market-accepted-transformed.json");

// Invented material, production encryption, and real main/preload/UI. The
// transport/capture boundary is synthetic; this does not prove server behavior.
async function seedLegacy(directory, automatic) {
  const { SatanicZoneLoginCacheStore } = require("../../dist/main/main/satanic-zone-login-cache-store.js");
  const { SatanicZoneDiagnosticBufferBudget } = require("../../dist/main/main/satanic-zone-diagnostic-budget.js");
  const connectBody = Buffer.from('\0\0\x01{"account":"CANARY_ACCOUNT","account_uid":"12345678901234567890","checksum":"CANARY_CHECKSUM"}\0' + "0123456789abcdef0123456789abcdef\0");
  const postLoginBody = Buffer.concat([Buffer.from([3, 0, 1, 0]), Buffer.from("post_login_crossregion\0"), Buffer.from([83, 0]),
    Buffer.from(`account_id=CANARY_ACCOUNT&unique_account_id=12345678901234567890&platform=0&checksum=${"a".repeat(64)}&guild_id=0&pact_ids=W10=&beta=0\0`)]);
  const file = path.join(directory, "sz-login-cache.portable");
  const store = new SatanicZoneLoginCacheStore(file), budget = new SatanicZoneDiagnosticBufferBudget();
  await store.unlock("CANARY release passphrase", budget);
  store.save({ connectBody, postLoginBody, destination: { address: "198.51.100.20", port: 6669 } }, budget);
  if (automatic) store.retainUnlockingKey(budget);
  store.lock(); budget.dispose();
  fs.writeFileSync(path.join(directory, "preferences.json"), JSON.stringify({ satanicZoneRefresh: { enabled: true },
    satanicZonePortableCache: { version: 2, enabled: true, automatic } }));
}

for (const profile of ["fresh", "saved-on", "automatic-cache"]) {
  test(`release blocks every active SZ entry and preserves passive updates across restart: ${profile}`, async () => {
    const userDataDir = createUserDataDir();
    let session;
    try {
      if (profile !== "fresh") await seedLegacy(userDataDir, profile === "automatic-cache");
      const retained = ["preferences.json", "sz-login-cache.portable", "sz-login-cache.portable.key"]
        .filter(file => fs.existsSync(path.join(userDataDir, file)))
        .map(file => ({ file, bytes: fs.readFileSync(path.join(userDataDir, file)) }));
      const assertRetained = () => retained.forEach(({ file, bytes }) => expect(fs.readFileSync(path.join(userDataDir, file))).toEqual(bytes));
      for (let restart = 0; restart < 2; restart++) {
        session = await launchCompanionApp({ userDataDir, marketTransport: true, gameRunning: false });
        const attempts = () => session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount());
        expect((await getRendererState(session.page)).satanicZone).toMatchObject({ refreshEnabled: false, refreshAvailable: false });
        expect(await attempts()).toBe(0);
        await session.page.getByRole("button", { name: "Settings", exact: true }).click();
        await expect(session.page.getByRole("button", { name: "Features", exact: true })).toHaveCount(0);
        await expect(session.page.locator("#settings-section-features")).toHaveCount(0);
        await expect(session.page.locator("#settings-section-app")).toBeVisible();
        await expect(session.page.getByRole("checkbox", { name: /SZ Refresh|Remember sign-in/ })).toHaveCount(0);
        await expect(session.page.getByLabel("Companion passphrase", { exact: true })).toHaveCount(0);
        await session.page.getByRole("button", { name: "Close settings" }).click();
        await expect(session.page.locator(".zone-refresh-button")).toHaveCount(0);
        const responses = await session.page.evaluate(async () => {
          const api = window.heroSiegeCompanion;
          return [await api.setSatanicZoneRefreshEnabled(true), await api.setSatanicZoneLoginCacheEnabled(true),
            await api.unlockSatanicZoneLoginCache("CANARY release passphrase"), await api.enableSatanicZoneLoginCacheAutomatic("CANARY release passphrase"),
            await api.refreshSatanicZone(), await api.lockSatanicZoneLoginCache(), await api.clearSatanicZoneLoginCache()]
            .map(state => ({ enabled: state.satanicZone.refreshEnabled, available: state.satanicZone.refreshAvailable }));
        });
        expect(responses).toEqual(Array(7).fill({ enabled: false, available: false }));
        assertRetained();
        await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
        await emitCapturePayloads(session.electronApp, e2eTrafficPayloads());
        await expect.poll(async () => (await getRendererState(session.page)).satanicZone.current?.rawZone).toBe("Act_01_01");
        expect((await getRendererState(session.page)).satanicZone.source).toBe("captured");
        await expect(session.page.locator("#satanic-zone-card .buff-pro")).toHaveCount(2);
        await expect(session.page.locator("#satanic-zone-card .buff-con")).toHaveCount(1);
        await session.page.getByRole("button", { name: "Compact mode", exact: true }).click();
        await expect(session.page.locator(".compact-view")).toBeVisible();
        await expect(session.page.locator(".compact-zone-refresh-button")).toHaveCount(0);
        await session.page.getByRole("button", { name: "SZ Details", exact: true }).click();
        await expect(session.page.locator(".compact-zone-effects")).toBeVisible();
        await expect(session.page.locator(".compact-zone-pros p")).toHaveCount(2);
        await session.page.getByRole("button", { name: "Exit compact mode", exact: true }).click();
        await session.page.evaluate(() => window.heroSiegeCompanion.stopCapture());
        await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([], []));
        await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
        await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [{
          direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
          text: "account_id=7-424242&unique_account_id=SYNTHETIC-uid&crossregion_identifier=SYNTHETIC-session&season=11&hardcore=0&beta=0",
        }]));
        await session.page.getByRole("tab", { name: "Market", exact: true }).click();
        await expect(session.page.locator(".market-readiness").getByRole("status")).toHaveText("Market ready");
        await session.page.locator("#market-item-query").fill("Death Knight's Gauntlets");
        await session.page.locator("#market-item-query").press("Enter");
        await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...Buffer.from(accepted.response.bodyBase64, "base64")]);
        await session.page.getByRole("button", { name: "Search market", exact: true }).click();
        await expect(session.page.locator(".market-price-table tbody tr")).toHaveCount(20);
        expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
        expect(await attempts()).toBe(0);
        await session.page.getByRole("tab", { name: "Live Session", exact: true }).click();
        // Advance the renderer clock, then let its real one-second display timer
        // observe expiry. This clock-only change cannot create an owned request.
        await session.page.evaluate(() => { const actualNow = Date.now; Date.now = () => actualNow() + 31 * 60_000; });
        await expect(session.page.locator("#satanic-zone-card .zone-status")).toContainText("Stale");
        expect(await attempts()).toBe(0);
        assertRetained();
        await closeCompanionApp(session); session = null;
        assertRetained();
      }
    } finally { if (session) await closeCompanionApp(session); cleanupUserDataDir(userDataDir); }
  });
}
