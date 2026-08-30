const { test, expect } = require("@playwright/test");
const {
  cleanupUserDataDir,
  closeCompanionApp,
  createUserDataDir,
  getDocumentTheme,
  getMainWindowState,
  getRendererState,
  getStoredUiPreferences,
  launchCompanionApp,
} = require("./support/companion-app.cjs");

const STANDALONE_EXECUTABLE = "C:\\Games\\Hero Siege\\Hero_Siege.exe";

test("autosaves the settings ledger and persists launch, theme, and confirmed SZ choices", async () => {
  const userDataDir = createUserDataDir();

  try {
    let appSession = await launchCompanionApp({ userDataDir });
    try {
      await configureDurableSettings(appSession);
      await assertDurableSettings(appSession, { reopened: false });
    } finally {
      await closeCompanionApp(appSession);
    }

    appSession = await launchCompanionApp({ userDataDir });
    try {
      await assertDurableSettings(appSession, { reopened: true });
    } finally {
      await closeCompanionApp(appSession);
    }
  } finally {
    cleanupUserDataDir(userDataDir);
  }
});

test("controls manual and timed diagnostics through the main-owned mode bridge", async () => {
  await launchAndUseSettings(async ({ page }) => {
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Help & Support", exact: true }).click();

    const enhancedRow = settings.locator(".settings-ledger-row").filter({ hasText: "Enhanced diagnostics" });
    await expect(enhancedRow.locator(".settings-status-badge")).toHaveText("Off");

    await enhancedRow.getByRole("button", { name: "Turn On", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).captureDiagnostics.enhanced.mode).toBe("manual");
    await expect(enhancedRow.locator(".settings-status-badge")).toHaveText("On · app session");
    expect((await getRendererState(page)).capturePreferences).toMatchObject({
      capturePayloadLogging: true,
      captureWideLogging: false,
    });

    await enhancedRow.getByRole("button", { name: "Turn Off", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).captureDiagnostics.enhanced.mode).toBe("off");

    await enhancedRow.getByRole("button", { name: "Start 10 min", exact: true }).click();
    const enhancedState = await pollDiagnosticsMode(page, "enhanced", "timed");
    expect(enhancedState.captureDiagnostics.enhanced.timedUntil).toBeGreaterThan(Date.now());
    await expect(enhancedRow.locator(".settings-status-badge")).toHaveText(/\d+:\d{2} remaining/);

    await enhancedRow.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).captureDiagnostics.enhanced.mode).toBe("off");

    const deepDiagnostics = settings.locator("details").filter({ hasText: "Deep diagnostics" }).first();
    await deepDiagnostics.locator("summary").click();
    await deepDiagnostics.getByRole("button", { name: "Turn On…", exact: true }).click();

    const manualConfirmation = page.getByRole("dialog", { name: "Turn on deep diagnostics?" });
    await expect(manualConfirmation).toBeVisible();
    expect((await getRendererState(page)).captureDiagnostics.deep.mode).toBe("off");
    await manualConfirmation.getByRole("button", { name: "Turn On Deep Diagnostics", exact: true }).click();

    const manualDeepState = await pollDiagnosticsMode(page, "deep", "manual");
    expect(manualDeepState.capturePreferences).toMatchObject({
      capturePayloadLogging: true,
      captureWideLogging: true,
    });
    await expect(deepDiagnostics.locator(".settings-status-badge")).toHaveText("On · app session");

    await deepDiagnostics.getByRole("button", { name: "Turn Off", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).captureDiagnostics.deep.mode).toBe("off");

    await deepDiagnostics.getByRole("button", { name: "Start 10 min…", exact: true }).click();

    const confirmation = page.getByRole("dialog", { name: "Start deep diagnostics for 10 minutes?" });
    await expect(confirmation).toBeVisible();
    expect((await getRendererState(page)).captureDiagnostics.deep.mode).toBe("off");
    await confirmation.getByRole("button", { name: "Start 10 Minutes", exact: true }).click();

    const deepState = await pollDiagnosticsMode(page, "deep", "timed");
    expect(deepState.capturePreferences).toMatchObject({
      capturePayloadLogging: true,
      captureWideLogging: true,
    });
    await expect(deepDiagnostics.locator(".settings-status-badge")).toHaveText(/\d+:\d{2} remaining/);

    await deepDiagnostics.getByRole("button", { name: "Stop", exact: true }).click();
    const diagnosticsOffState = await pollDiagnosticsMode(page, "deep", "off");
    expect(diagnosticsOffState.capturePreferences).toMatchObject({
      capturePayloadLogging: false,
      captureWideLogging: false,
    });
  });
});

test("keeps full-window pinning session-only and resets window bounds from support", async () => {
  const userDataDir = createUserDataDir();

  try {
    let appSession = await launchCompanionApp({ userDataDir });
    try {
      expect((await getMainWindowState(appSession.electronApp)).alwaysOnTop).toBe(false);

      await appSession.page.getByRole("button", { name: "Compact mode" }).click();
      await expect.poll(async () => (await getMainWindowState(appSession.electronApp)).compactMode).toBe(true);
      expect((await getMainWindowState(appSession.electronApp)).alwaysOnTop).toBe(true);

      await appSession.page.getByRole("button", { name: "Exit compact mode" }).click();
      await expect.poll(async () => (await getMainWindowState(appSession.electronApp)).compactMode).toBe(false);
      expect((await getMainWindowState(appSession.electronApp)).alwaysOnTop).toBe(false);

      await appSession.page.getByRole("button", { name: "Pin window on top" }).click();
      await expect.poll(async () => (await getMainWindowState(appSession.electronApp)).alwaysOnTop).toBe(true);
      await expect(appSession.page.getByRole("button", { name: "Unpin window" })).toHaveAttribute("aria-pressed", "true");

      await appSession.page.getByRole("button", { name: "Compact mode" }).click();
      await expect.poll(async () => (await getMainWindowState(appSession.electronApp)).compactMode).toBe(true);
      expect((await getMainWindowState(appSession.electronApp)).alwaysOnTop).toBe(true);

      await appSession.page.getByRole("button", { name: "Exit compact mode" }).click();
      await expect.poll(async () => (await getMainWindowState(appSession.electronApp)).compactMode).toBe(false);
      expect((await getMainWindowState(appSession.electronApp)).alwaysOnTop).toBe(true);
    } finally {
      await closeCompanionApp(appSession);
    }

    appSession = await launchCompanionApp({ userDataDir });
    try {
      expect((await getMainWindowState(appSession.electronApp)).alwaysOnTop).toBe(false);
      await expect(appSession.page.getByRole("button", { name: "Pin window on top" })).toHaveAttribute("aria-pressed", "false");

      await appSession.electronApp.evaluate(({ BrowserWindow }) => {
        const appWindow = BrowserWindow.getAllWindows()[0];
        appWindow.setSize(1_000, 650, false);
      });
      await expect.poll(async () => (await getMainWindowState(appSession.electronApp)).bounds).toMatchObject({
        width: 1_000,
        height: 650,
      });

      await openSettings(appSession.page);
      const settings = appSession.page.getByRole("dialog", { name: "Settings" });
      await settings.getByRole("button", { name: "Help & Support", exact: true }).click();
      await settings.getByRole("button", { name: "Reset Window Position", exact: true }).click();
      await expect.poll(async () => (await getMainWindowState(appSession.electronApp)).bounds).toMatchObject({
        width: 1_180,
        height: 760,
      });
      await expect(appSession.page.getByText("Window position reset", { exact: true })).toBeVisible();
    } finally {
      await closeCompanionApp(appSession);
    }
  } finally {
    cleanupUserDataDir(userDataDir);
  }
});

async function configureDurableSettings({ page }) {
  expect((await getRendererState(page)).satanicZone.refreshEnabled).toBe(false);

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("button", { name: /Done|Apply/ })).toHaveCount(0);

  await expect(settings.getByRole("radio", { name: "Steam", exact: true })).toBeChecked();
  await expect(settings.getByLabel("Game executable")).toHaveCount(0);
  await settings.getByRole("radio", { name: "Standalone", exact: true }).check();
  await expect(settings.getByLabel("Game executable")).toBeVisible();
  await settings.getByLabel("Game executable").fill(STANDALONE_EXECUTABLE);
  await settings.getByRole("radio", { name: "Steam", exact: true }).check();
  await expect(settings.getByLabel("Game executable")).toHaveCount(0);
  await settings.getByRole("radio", { name: "Standalone", exact: true }).check();
  await expect(settings.getByLabel("Game executable")).toHaveValue(STANDALONE_EXECUTABLE);

  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await settings.getByLabel("App theme").selectOption("light");
  await settings.getByLabel("Compact theme").selectOption("cyberpunk");

  await expect.poll(async () => await getStoredUiPreferences(page)).toMatchObject({
    gameExecutablePath: STANDALONE_EXECUTABLE,
    launchThroughSteam: false,
    themeId: "light",
    compactThemeId: "cyberpunk",
    compactThemeMatchesApp: false,
  });
  await expect(settings.getByRole("status")).toHaveText("Saved");

  await settings.getByRole("button", { name: "Features", exact: true }).click();
  await settings.getByRole("checkbox", { name: /Enable SZ Refresh/ }).click();
  const confirmation = page.getByRole("dialog", { name: "Enable SZ Refresh?" });
  await expect(confirmation).toBeVisible();
  expect((await getRendererState(page)).satanicZone.refreshEnabled).toBe(false);
  await confirmation.getByRole("button", { name: "Enable SZ Refresh", exact: true }).click();
  await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshEnabled).toBe(true);

  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toHaveCount(0);
}

async function assertDurableSettings({ electronApp, page }, { reopened }) {
  await expect.poll(async () => (await getDocumentTheme(page)).theme).toBe("light");
  await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshEnabled).toBe(true);

  const state = await getRendererState(page);
  expect(state.captureDiagnostics).toMatchObject({
    enhanced: { mode: "off", timedUntil: null },
    deep: { mode: "off", timedUntil: null },
  });
  expect(state.runArchivePreferences).toMatchObject({
    skipEmptyRuns: true,
    minDurationMinutes: 0,
  });
  expect(state.satanicZone.refreshEnabled).toBe(true);

  const windowState = await getMainWindowState(electronApp);
  expect(windowState.alwaysOnTop).toBe(false);

  const storedPreferences = await getStoredUiPreferences(page);
  expect(storedPreferences).toMatchObject({
    schemaVersion: 2,
    gameExecutablePath: STANDALONE_EXECUTABLE,
    launchThroughSteam: false,
    compactThemeId: "cyberpunk",
    compactThemeMatchesApp: false,
    themeId: "light",
  });
  expect(storedPreferences).not.toHaveProperty("satanicZoneRefreshEnabled");
  expect(storedPreferences).not.toHaveProperty("alwaysOnTop");
  expect(storedPreferences).not.toHaveProperty("showCaptureDetails");
  expect(storedPreferences).not.toHaveProperty("developerItemResearchEnabled");
  expect(storedPreferences).not.toHaveProperty("unknownItemAudioPrompt");

  if (!reopened) return;

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("radio", { name: "Standalone", exact: true })).toBeChecked();
  await expect(settings.getByLabel("Game executable")).toHaveValue(STANDALONE_EXECUTABLE);

  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(settings.getByLabel("App theme")).toHaveValue("light");
  await expect(settings.getByLabel("Compact theme")).toHaveValue("cyberpunk");

  await settings.getByRole("button", { name: "Features", exact: true }).click();
  await expect(settings.getByRole("checkbox", { name: /Enable SZ Refresh/ })).toBeChecked();
}

async function launchAndUseSettings(callback) {
  const userDataDir = createUserDataDir();
  const appSession = await launchCompanionApp({ userDataDir });
  try {
    await openSettings(appSession.page);
    await callback(appSession);
  } finally {
    await closeCompanionApp(appSession);
    cleanupUserDataDir(userDataDir);
  }
}

async function openSettings(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

async function pollDiagnosticsMode(page, level, mode) {
  let state;
  await expect.poll(async () => {
    state = await getRendererState(page);
    return state.captureDiagnostics[level].mode;
  }).toBe(mode);
  return state;
}
