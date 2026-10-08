const { test, expect } = require("@playwright/test");
const { withCompanionApp, createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp } = require("./support/companion-app.cjs");

const { installLaunchStubs } = require("./support/game-launch-stubs.cjs");
async function dispatches(electronApp) {
  return electronApp.evaluate(() => global.__launchSecurity.calls);
}



test("renderer cannot choose an existing arbitrary executable or provide extra launch arguments", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
    const paths = await installLaunchStubs(electronApp);
    for (const payload of [
      { launchThroughSteam: false, executablePath: paths.arbitrary },
      { launchThroughSteam: false, executablePath: paths.arbitrary, args: ["--invented"] },
      { launchThroughSteam: true, executablePath: paths.arbitrary },
      { launchThroughSteam: true, args: ["--invented"] },
      { launchThroughSteam: "yes" },
      null,
    ]) {
      await page.evaluate(async payload => {
        try { await window.heroSiegeCompanion.launchGameOrCapture(payload); } catch {}
      }, payload);
    }
    expect(await dispatches(electronApp)).toEqual([]);
  });
});

test("native Browse selection authorizes only the chosen unchanged file with fixed empty arguments", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
    const paths = await installLaunchStubs(electronApp);
    expect(await page.evaluate(() => window.heroSiegeCompanion.chooseGameExecutable())).toBe(paths.selected);
    await page.evaluate(() => window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false }));
    const calls = await dispatches(electronApp);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "spawn", target: paths.selected, args: [], options: { shell: false } });
    await page.evaluate(async path => {
      try { await window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false, executablePath: path }); } catch {}
    }, paths.arbitrary);
    expect(await dispatches(electronApp)).toHaveLength(1);
    await electronApp.evaluate(() => {
      process.getBuiltinModule("node:fs").appendFileSync(global.__launchSecurity.selected, "changed after approval");
    });
    await page.evaluate(() => window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false }));
    expect(await dispatches(electronApp)).toHaveLength(1);
    await page.evaluate(() => window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: true }));
    expect((await dispatches(electronApp))[1]).toEqual({ kind: "openExternal", target: "steam://rungameid/269210" });
  });
});

test("game IPC rejects foreign senders, child frames, extra raw args and picker path injection", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp }) => {
    await installLaunchStubs(electronApp);
    const failures = await electronApp.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const webContents = BrowserWindow.getAllWindows()[0].webContents;
      const trusted = { sender: webContents, senderFrame: webContents.mainFrame };
      const launch = ipcMain._invokeHandlers.get("game:launch-or-capture");
      const choose = ipcMain._invokeHandlers.get("game:choose-executable");
      let rejected = 0;
      for (const event of [
        { ...trusted, sender: {} },
        { ...trusted, senderFrame: { url: trusted.senderFrame.url } },
        { ...trusted, senderFrame: null },
      ]) {
        try { await launch(event, { launchThroughSteam: true }); } catch { rejected++; }
        try { await choose(event); } catch { rejected++; }
      }
      try { await launch(trusted, { launchThroughSteam: true }, ["--extra"]); } catch { rejected++; }
      try { await choose(trusted, global.__launchSecurity.arbitrary); } catch { rejected++; }
      return rejected;
    });
    expect(failures).toBe(8);
    expect(await dispatches(electronApp)).toEqual([]);
  });
});

test("legacy renderer preferences confer no launch approval and cancellation preserves native approval", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
    const paths = await installLaunchStubs(electronApp);
    await page.evaluate(path => {
      localStorage.setItem("hero-siege-companion:preferences:v1", JSON.stringify({ gameExecutablePath: path, launchThroughSteam: false }));
    }, paths.arbitrary);
    await page.evaluate(() => window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false }));
    expect(await dispatches(electronApp)).toEqual([]);
    expect(await page.evaluate(() => window.heroSiegeCompanion.getGameExecutable())).toBe(null);
    await page.evaluate(() => window.heroSiegeCompanion.chooseGameExecutable());
    await electronApp.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    expect(await page.evaluate(() => window.heroSiegeCompanion.chooseGameExecutable())).toBe(null);
    expect(await page.evaluate(() => window.heroSiegeCompanion.getGameExecutable())).toBe(paths.selected);
    await page.evaluate(() => window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false }));
    expect(await dispatches(electronApp)).toHaveLength(1);
  });
});

test("approved standalone selection and the Browse UI survive a real Companion process restart", async () => {
  const userDataDir = createUserDataDir();
  let session;
  try {
    session = await test.step("launch first process", () => launchCompanionApp({ userDataDir, gameRunning: false }));
    const paths = await installLaunchStubs(session.electronApp);
    await test.step("select from native Browse through Settings", async () => {
      await session.page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = session.page.getByRole("dialog", { name: "Settings" });
      await settings.getByRole("radio", { name: "Standalone", exact: true }).check();
      await expect(settings.getByLabel("Game executable")).toHaveAttribute("readonly", "");
      await settings.getByRole("button", { name: /^Browse/ }).click();
      await expect(settings.getByLabel("Game executable")).toHaveValue(paths.selected);
    }, { timeout: 5_000 });
    await test.step("close first process", () => closeCompanionApp(session), { timeout: 5_000 });
    session = await test.step("launch second process", () => launchCompanionApp({ userDataDir, gameRunning: false }), { timeout: 5_000 });
    await installLaunchStubs(session.electronApp);
    expect(await session.page.evaluate(() => window.heroSiegeCompanion.getGameExecutable())).toBe(paths.selected);
    await session.page.getByRole("button", { name: "Launch Game", exact: true }).click();
    await expect.poll(() => dispatches(session.electronApp)).toHaveLength(1);
  } finally {
    if (session) await closeCompanionApp(session);
    cleanupUserDataDir(userDataDir);
  }
});
