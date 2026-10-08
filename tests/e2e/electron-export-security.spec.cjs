const { test, expect } = require("@playwright/test");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { withCompanionApp } = require("./support/companion-app.cjs");
const { installLaunchStubs } = require("./support/game-launch-stubs.cjs");

test("configuration Save cannot forge main executable approval and then launch a renderer-chosen binary", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
    await installLaunchStubs(electronApp);
    const forged = await electronApp.evaluate(({ app, dialog }) => {
      const fs = process.getBuiltinModule("node:fs"), path = process.getBuiltinModule("node:path");
      const target = global.__launchSecurity.arbitrary;
      const approval = path.join(app.getPath("userData"), "game-executable.json");
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: approval });
      return JSON.stringify({ schemaVersion: 1, path: fs.realpathSync(target),
        sha256: process.getBuiltinModule("node:crypto").createHash("sha256").update(fs.readFileSync(target)).digest("hex") });
    });
    const outcome = await page.evaluate(async forged => {
      let blocked = false;
      try { await window.heroSiegeCompanion.exportConfiguration(forged); } catch { blocked = true; }
      await window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false });
      return { blocked, selected: await window.heroSiegeCompanion.getGameExecutable() };
    }, forged);
    expect(await electronApp.evaluate(() => global.__launchSecurity.calls)).toEqual([]);
    expect(outcome).toEqual({ blocked: true, selected: null });
  });
});

test("all Save export routes protect internal files and canonical aliases while normal exports still work", async () => {
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-export-security-"));
  try {
    await withCompanionApp({ gameRunning: false }, async ({ electronApp, page, userDataDir }) => {
      await installLaunchStubs(electronApp);
      await page.evaluate(() => window.heroSiegeCompanion.chooseGameExecutable());
      const approval = path.join(userDataDir, "game-executable.json");
      const original = fs.readFileSync(approval);
      const alias = path.join(external, "storage-alias"); fs.symlinkSync(userDataDir, alias, "junction");
      const hardlink = path.join(external, "approval-alias.json"); fs.linkSync(approval, hardlink);
      const targets = [approval, approval.toUpperCase(), path.join(alias, "game-executable.json"), hardlink,
        path.join(alias, "new-config.json"), path.join(userDataDir, "nested", "new-config.json"),
        path.join(userDataDir, "preferences.json")];
      fs.mkdirSync(path.join(userDataDir, "nested"));
      for (const destination of targets) {
        await electronApp.evaluate(({ dialog }, destination) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
        }, destination);
        const rejected = await page.evaluate(async () => {
          const api = window.heroSiegeCompanion, results = [];
          for (const request of [() => api.exportConfiguration('{"forged":true}'),
            () => api.exportItemResearch('{"forged":true}'), () => api.exportPastRunsJson('{"forged":true}'),
            () => api.exportPastRunsCsv('{"forged":true}'), () => api.saveSupportDiagnostics("synthetic summary"),
            () => api.exportSoundPack([{ name: "test", fileName: "test.wav", src: "data:audio/wav;base64,UklGRg==" }])]) {
            try { await request(); results.push(false); } catch { results.push(true); }
          }
          return results;
        });
        expect(rejected).toEqual([true, true, true, true, true, true]);
        expect(fs.readFileSync(approval)).toEqual(original);
      }
      fs.unlinkSync(hardlink);
      const exported = path.join(external, "backup.json");
      await electronApp.evaluate(({ dialog }, destination) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
      }, exported);
      expect(await page.evaluate(() => window.heroSiegeCompanion.exportConfiguration('{"normal":true}'))).toBe(true);
      expect(JSON.parse(fs.readFileSync(exported, "utf8"))).toEqual({ normal: true });
      expect(await page.evaluate(() => window.heroSiegeCompanion.exportPastRunsCsv("a,b\n1,2"))).toBe(true);
      expect(fs.readFileSync(exported, "utf8")).toBe("a,b\n1,2\n");
      await page.evaluate(() => window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false }));
      expect(await electronApp.evaluate(() => global.__launchSecurity.calls)).toHaveLength(1);
    });
  } finally { fs.rmSync(external, { recursive: true, force: true }); }
});

test("Save protects an externally selected game and app code while all ordinary export formats remain available", async () => {
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-export-security-"));
  try {
    await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
      await installLaunchStubs(electronApp);
      const game = path.join(external, "standalone game.exe");
      const appCode = await electronApp.evaluate(({ app, dialog }, game) => {
        process.getBuiltinModule("node:fs").copyFileSync(global.__launchSecurity.selected, game);
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [game] });
        return process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json");
      }, game);
      await page.evaluate(() => window.heroSiegeCompanion.chooseGameExecutable());
      const originalGame = fs.readFileSync(game), originalCode = fs.readFileSync(appCode);
      for (const destination of [game, appCode]) {
        await electronApp.evaluate(({ dialog }, destination) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
        }, destination);
        expect(await page.evaluate(async () => {
          try { await window.heroSiegeCompanion.exportConfiguration('{"forged":true}'); return false; }
          catch { return true; }
        })).toBe(true);
        expect(fs.readFileSync(game)).toEqual(originalGame);
        expect(fs.readFileSync(appCode)).toEqual(originalCode);
      }
      for (const [format, extension] of [["config", "json"], ["research", "json"], ["runs", "json"],
        ["csv", "csv"], ["support", "zip"], ["sound", "zip"]]) {
        const destination = path.join(external, `${format}.${extension}`);
        await electronApp.evaluate(({ dialog }, destination) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
        }, destination);
        expect(await page.evaluate(async format => {
          const api = window.heroSiegeCompanion;
          if (format === "config") return api.exportConfiguration('{"normal":true}');
          if (format === "research") return api.exportItemResearch('{"normal":true}');
          if (format === "runs") return api.exportPastRunsJson('{"normal":true}');
          if (format === "csv") return api.exportPastRunsCsv("a,b\n1,2");
          if (format === "support") return (await api.saveSupportDiagnostics("synthetic summary")).saved;
          return (await api.exportSoundPack([{ name: "test", fileName: "test.wav", src: "data:audio/wav;base64,UklGRg==" }])).exported;
        }, format)).toBe(true);
        const exported = fs.readFileSync(destination);
        if (extension === "json") expect(JSON.parse(exported.toString("utf8"))).toEqual({ normal: true });
        else if (extension === "csv") expect(exported.toString("utf8")).toBe("a,b\n1,2\n");
        else expect(exported.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      }
      await page.evaluate(() => window.heroSiegeCompanion.launchGameOrCapture({ launchThroughSteam: false }));
      expect(await electronApp.evaluate(() => global.__launchSecurity.calls)).toHaveLength(1);
    });
  } finally { fs.rmSync(external, { recursive: true, force: true }); }
});

test("renderer-initiated browser downloads are cancelled before any file is written", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
    await electronApp.evaluate(({ session }) => {
      global.__downloads = [];
      session.defaultSession.on("will-download", (event, item) => {
        global.__downloads.push({ prevented: event.defaultPrevented, name: item.getFilename() });
      });
    });
    await page.evaluate(() => {
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(new Blob(["{}"], { type: "application/json" }));
      anchor.download = "game-executable.json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    });
    await expect.poll(() => electronApp.evaluate(() => global.__downloads)).toEqual([
      { prevented: true, name: "game-executable.json" },
    ]);
  });
});
