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
  selectOptionByTitle,
  setCheckboxByLabel,
} = require("./support/companion-app.cjs");

test("applies and persists high-friction settings across an Electron relaunch", async () => {
  const userDataDir = createUserDataDir();

  try {
    let appSession = await launchCompanionApp({ userDataDir });
    try {
      await applySettings(appSession);
      await assertAppliedSettings(appSession, { reopened: false });
    } finally {
      await closeCompanionApp(appSession);
    }

    appSession = await launchCompanionApp({ userDataDir });
    try {
      await assertAppliedSettings(appSession, { reopened: true });
    } finally {
      await closeCompanionApp(appSession);
    }
  } finally {
    cleanupUserDataDir(userDataDir);
  }
});

async function applySettings({ electronApp, page }) {
  await expect(page.locator(".status-details")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

  await page.getByRole("tab", { name: "General", exact: true }).click();
  await setCheckboxByLabel(page, "Always on top", true);
  await setCheckboxByLabel(page, "Hide key items", true);

  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await setCheckboxByLabel(page, "Show capture details", true);
  await setCheckboxByLabel(page, "Verbose live logging", true);
  await setCheckboxByLabel(page, "Developer item research", true);
  await setCheckboxByLabel(page, "Prompt on unknown drops", true);
  await setCheckboxByLabel(page, "Don't save empty runs", true);
  await page.locator('input[title="Minimum run duration in minutes"]').fill("7");

  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await selectOptionByTitle(page, "Application theme", "light");
  await selectOptionByTitle(page, "Compact mode theme", "cyberpunk");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);

  await expect.poll(async () => (await getMainWindowState(electronApp)).alwaysOnTop).toBe(true);
}

async function assertAppliedSettings({ electronApp, page }, { reopened }) {
  await expect(page.locator(".status-details")).toContainText("Device: e2e-capture-device");
  await expect(page.locator(".status-details")).toContainText("Filter: e2e simulated Hero Siege traffic");

  const theme = await getDocumentTheme(page);
  expect(theme.theme).toBe("light");

  const state = await getRendererState(page);
  expect(state.capturePreferences.createDebugMode).toBe(true);
  expect(state.runArchivePreferences).toMatchObject({
    skipEmptyRuns: true,
    minDurationMinutes: 7,
  });

  const windowState = await getMainWindowState(electronApp);
  expect(windowState.alwaysOnTop).toBe(true);

  const storedPreferences = await getStoredUiPreferences(page);
  expect(storedPreferences).toMatchObject({
    alwaysOnTop: true,
    compactThemeId: "cyberpunk",
    developerItemResearchEnabled: true,
    hideKeys: true,
    showCaptureDetails: true,
    themeId: "light",
    unknownItemAudioPrompt: true,
  });

  if (!reopened) return;

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.locator("label", { hasText: "Show capture details" }).locator("input")).toBeChecked();
  await expect(page.locator("label", { hasText: "Verbose live logging" }).locator("input")).toBeChecked();
  await expect(page.locator("label", { hasText: "Prompt on unknown drops" }).locator("input")).toBeChecked();
  await expect(page.locator('input[title="Minimum run duration in minutes"]')).toHaveValue("7");
}
