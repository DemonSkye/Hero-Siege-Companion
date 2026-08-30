const { test, expect } = require("@playwright/test");
const {
  cleanupUserDataDir,
  closeCompanionApp,
  createUserDataDir,
  getStoredWhatsNewVersion,
  launchCompanionApp,
} = require("./support/companion-app.cjs");
const { version: appVersion } = require("../../package.json");

const EXPECTED_WHATS_NEW_VERSION = appVersion;
const EXPECTED_WHATS_NEW_TITLE = `Hero Siege Companion v${appVersion}`;

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

test("opens the What's New disclosure in Help & Support from the prompt and marks it seen", async () => {
  await launchWithCleanup(async (appSession) => {
    const { page } = appSession;
    const prompt = page.getByRole("dialog", { name: "See what's new?" });
    await expect(prompt).toBeVisible();

    await prompt.getByRole("button", { name: "Show me" }).click();

    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Help & Support", exact: true })).toHaveAttribute("aria-current", "page");
    const whatsNew = settings.locator(".settings-whats-new");
    await expect(whatsNew).toHaveAttribute("open", "");
    await expect(whatsNew.getByText(EXPECTED_WHATS_NEW_TITLE)).toBeVisible();
    await expect(whatsNew.getByRole("heading", { name: "Highlights" })).toBeVisible();
    await expect(whatsNew.locator("li").first()).toBeVisible();
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
