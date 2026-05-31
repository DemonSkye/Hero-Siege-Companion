const { test, expect } = require("@playwright/test");
const {
  cleanupUserDataDir,
  closeCompanionApp,
  createUserDataDir,
  getStoredWhatsNewVersion,
  launchCompanionApp,
} = require("./support/companion-app.cjs");

const EXPECTED_WHATS_NEW_VERSION = "0.2.5";
const EXPECTED_WHATS_NEW_TITLE = "Hero Siege Companion v0.2.5";

test("dismisses What's New with No Thanks and does not prompt again", async () => {
  const userDataDir = createUserDataDir();

  try {
    let appSession = await launchCompanionApp({ userDataDir, dismissWhatsNew: false });
    try {
      const prompt = appSession.page.getByRole("dialog", { name: "See what's new?" });
      await expect(prompt).toBeVisible();

      await prompt.getByRole("button", { name: "No Thanks" }).click();
      await expect(prompt).toHaveCount(0);
      await expect.poll(() => getStoredWhatsNewVersion(appSession.page)).toBe(EXPECTED_WHATS_NEW_VERSION);
    } finally {
      await closeCompanionApp(appSession);
    }

    appSession = await launchCompanionApp({ userDataDir, dismissWhatsNew: false });
    try {
      await expect(appSession.page.getByRole("dialog", { name: "See what's new?" })).toHaveCount(0);
    } finally {
      await closeCompanionApp(appSession);
    }
  } finally {
    cleanupUserDataDir(userDataDir);
  }
});

test("opens the What's New settings tab from the prompt and marks it seen", async () => {
  await launchWithCleanup(async (appSession) => {
    const { page } = appSession;
    const prompt = page.getByRole("dialog", { name: "See what's new?" });
    await expect(prompt).toBeVisible();

    await prompt.getByRole("button", { name: "Show me" }).click();

    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("tab", { name: "What's New" })).toHaveClass(/active/);
    await expect(settings.getByText(`What's New in ${EXPECTED_WHATS_NEW_VERSION}`)).toBeVisible();
    await expect(settings.getByText(EXPECTED_WHATS_NEW_TITLE)).toBeVisible();
    await expect(settings.getByText("Npcap is still required for capture.")).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Highlights" })).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Themes And Appearance" })).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Past Runs" })).toBeVisible();
    await expect(settings.getByText("Use report presets, linked Item Filter groups, custom recap groups, top-drop limits, and resource drawers to shape run recaps.")).toBeVisible();
    await expect(settings.getByText("Item Research can filter, classify, export scoped review data, clear resolved or ignored rows, and separate generated placeholders from missing-icon follow-up work.")).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Item Lookup" })).toHaveCount(0);
    await expect.poll(() => getStoredWhatsNewVersion(page)).toBe(EXPECTED_WHATS_NEW_VERSION);
  });
});

async function launchWithCleanup(callback) {
  const appSession = await launchCompanionApp({ dismissWhatsNew: false });

  try {
    await callback(appSession);
  } finally {
    await closeCompanionApp(appSession);
    if (appSession.ownsUserDataDir) cleanupUserDataDir(appSession.userDataDir);
  }
}
