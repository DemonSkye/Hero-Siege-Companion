const { expect, _electron: electron } = require("@playwright/test");
const electronExecutablePath = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { e2ePastRuns } = require("./fixtures.cjs");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const PREFERENCES_STORAGE_KEY = "hero-siege-companion:preferences:v1";
const WHATS_NEW_SEEN_STORAGE_KEY = "hero-siege-companion:whats-new-seen-version:v1";

const EXPECTED_PRELOAD_API = [
  "checkForUpdate",
  "chooseGameExecutable",
  "closeWindow",
  "exportConfiguration",
  "exportItemResearch",
  "exportPastRunsJson",
  "exportSoundPack",
  "getState",
  "getSupportDiagnosticsInfo",
  "importConfiguration",
  "importSounds",
  "launchGameOrCapture",
  "minimizeWindow",
  "onStateUpdated",
  "openNpcapGuide",
  "openRelease",
  "pauseRun",
  "removeSound",
  "resetStats",
  "resumeRun",
  "saveSupportDiagnostics",
  "setAlwaysOnTop",
  "setCapturePreferences",
  "setCompactMode",
  "setPastRunTags",
  "setRunArchivePreferences",
  "startCapture",
  "stopCapture",
  "toggleMaximizeWindow",
  "writeClipboardText",
];

function createUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hsc-e2e-"));
}

function cleanupUserDataDir(userDataDir) {
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

async function launchCompanionApp(options = {}) {
  const userDataDir = options.userDataDir ?? createUserDataDir();
  const ownsUserDataDir = !options.userDataDir;
  if (options.seedPastRuns) seedPastRuns(userDataDir);

  const electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: ["--disable-gpu-sandbox", "--in-process-gpu", "--disable-gpu", "--no-sandbox", APP_ROOT],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      HERO_SIEGE_COMPANION_E2E: "1",
      HERO_SIEGE_COMPANION_E2E_GAME_RUNNING: options.gameRunning === false ? "0" : "1",
      HERO_SIEGE_COMPANION_E2E_USER_DATA: userDataDir,
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForSelector(".app-shell");
    if (options.dismissWhatsNew !== false) await dismissWhatsNewPrompt(page);
    if (options.assertBridge !== false) await assertPreloadBridge(page);
    return { electronApp, page, userDataDir, ownsUserDataDir };
  } catch (error) {
    await closeCompanionApp({ electronApp, ownsUserDataDir: false });
    if (ownsUserDataDir) cleanupUserDataDir(userDataDir);
    throw error;
  }
}

async function closeCompanionApp(appSession) {
  await appSession.electronApp.close().catch(() => undefined);
}

async function withCompanionApp(optionsOrCallback, maybeCallback) {
  const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
  const appSession = await launchCompanionApp(options);

  try {
    await callback(appSession);
  } finally {
    await closeCompanionApp(appSession);
    if (appSession.ownsUserDataDir) cleanupUserDataDir(appSession.userDataDir);
  }
}

async function dismissWhatsNewPrompt(page) {
  const noThanks = page.getByRole("button", { name: "No Thanks" });
  if (await noThanks.isVisible().catch(() => false)) await noThanks.click();
}

async function assertPreloadBridge(page) {
  const report = await getPreloadBridgeReport(page);
  expect(report.hasBridge).toBe(true);
  expect(report.missing).toEqual([]);
  expect(report.nodeIntegrationLeaked).toBe(false);
}

async function getPreloadBridgeReport(page) {
  return page.evaluate((expectedKeys) => {
    const api = window.heroSiegeCompanion;
    const keys = api && typeof api === "object" ? Object.keys(api).sort() : [];
    return {
      hasBridge: Boolean(api),
      keys,
      missing: expectedKeys.filter((key) => typeof api?.[key] !== "function"),
      nodeIntegrationLeaked: typeof window.require === "function" || Boolean(window.process?.versions?.node),
    };
  }, EXPECTED_PRELOAD_API);
}

async function getRendererState(page) {
  return page.evaluate(() => window.heroSiegeCompanion.getState());
}

async function waitForRendererState(page, predicate, options = {}) {
  let lastState = null;
  await expect.poll(async () => {
    lastState = await getRendererState(page);
    return predicate(lastState);
  }, { timeout: options.timeout ?? 5_000, message: options.message }).toBe(true);
  return lastState;
}

async function getMainWindowState(electronApp) {
  return electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getWindowState());
}

async function emitCaptureEvents(electronApp, events) {
  await electronApp.evaluate((_electronProcess, eventsToEmit) => {
    globalThis.heroSiegeCompanionE2e.emitCaptureEvents(eventsToEmit);
  }, events);
}

async function emitCapturePayloads(electronApp, payloads) {
  await electronApp.evaluate((_electronProcess, payloadsToEmit) => {
    globalThis.heroSiegeCompanionE2e.emitCapturePayloads(payloadsToEmit);
  }, payloads);
}

async function setCheckboxByLabel(page, label, checked) {
  await page.locator("label", { hasText: label }).locator("input[type='checkbox']").first().setChecked(checked);
}

async function selectOptionByTitle(page, title, value) {
  await page.locator(`select[title="${title}"]`).selectOption(value);
}

async function getDocumentTheme(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    accent: getComputedStyle(document.documentElement).getPropertyValue("--user-accent").trim(),
  }));
}

async function getStoredUiPreferences(page) {
  return page.evaluate((storageKey) => JSON.parse(window.localStorage.getItem(storageKey) || "{}"), PREFERENCES_STORAGE_KEY);
}

async function getStoredWhatsNewVersion(page) {
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), WHATS_NEW_SEEN_STORAGE_KEY);
}

function seedPastRuns(userDataDir) {
  fs.writeFileSync(path.join(userDataDir, "past-runs.json"), `${JSON.stringify(e2ePastRuns(), null, 2)}\n`, "utf8");
}

module.exports = {
  EXPECTED_PRELOAD_API,
  WHATS_NEW_SEEN_STORAGE_KEY,
  assertPreloadBridge,
  cleanupUserDataDir,
  closeCompanionApp,
  createUserDataDir,
  emitCaptureEvents,
  emitCapturePayloads,
  getDocumentTheme,
  getMainWindowState,
  getPreloadBridgeReport,
  getRendererState,
  getStoredUiPreferences,
  getStoredWhatsNewVersion,
  launchCompanionApp,
  selectOptionByTitle,
  setCheckboxByLabel,
  waitForRendererState,
  withCompanionApp,
};
