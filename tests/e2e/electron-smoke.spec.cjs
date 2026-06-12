const { test, expect } = require("@playwright/test");
const {
  emitCaptureEvents,
  getMainWindowState,
  getRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eCaptureEvents } = require("./support/fixtures.cjs");

test("boots Electron with the preload bridge and deterministic capture health", async () => {
  await withCompanionApp(async ({ page }) => {
    await expect(page.getByText("Hero Siege Companion").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop Capture" })).toBeVisible();

    const state = await getRendererState(page);
    expect(state.captureStatus).toBe("running");
    expect(state.health).toMatchObject({
      npcapService: "Running",
      winPcapCompatible: true,
      adminOnly: false,
      device: "e2e-capture-device",
    });
  });
});

test("drives capture events through the real renderer and main-process IPC", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await emitCaptureEvents(electronApp, e2eCaptureEvents());

    const state = await getRendererState(page);
    expect(state.stats.accountName).toBe("E2E Captured");
    expect(state.stats.items.Angelic).toMatchObject({ total: 1, mf: 1 });
    expect(state.health).toMatchObject({
      packetsSeen: 3,
      payloadsAssembled: 3,
      messagesDecoded: 3,
      parsedEvents: 3,
    });

    await expect(page.getByText(/3 seen.*3 parsed/)).toBeVisible();
    await page.locator("button.item-counter.angelic").click();
    await expect(page.locator("#tracked-drops-card-body").getByText("E2E Angelic Blade")).toBeVisible();
  });
});

test("covers compact mode and support settings in an Electron window", async () => {
  await withCompanionApp(async ({ electronApp, page, userDataDir }) => {
    await page.getByRole("button", { name: "Compact mode" }).click();
    await expect(page.locator(".compact-view")).toBeVisible();

    const compactWindow = await getMainWindowState(electronApp);
    expect(compactWindow.compactMode).toBe(true);
    expect(compactWindow.bounds.width).toBeGreaterThanOrEqual(340);
    expect(compactWindow.bounds.height).toBeGreaterThanOrEqual(160);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Support" }).click();
    await expect(page.getByLabel("Diagnostics files").getByText("diagnostics-summary.txt")).toBeVisible();
    await expect(page.locator(".settings-support-path code")).toHaveText(userDataDir);
    await expect(page.getByText("does not include packet captures")).toBeVisible();
    await page.getByRole("button", { name: "Copy Summary" }).click();
    await expect(page.getByText("Diagnostics summary copied")).toBeVisible();
  });
});

test("searches, tags, and persists seeded Past Runs through the app UI", async () => {
  await withCompanionApp({ seedPastRuns: true }, async ({ page }) => {
    await page.getByRole("tab", { name: "Past Runs" }).click();
    await expect(page.getByRole("heading", { name: "Past Runs", level: 1 })).toBeVisible();
    await expect(page.getByText("E2E Paladin")).toBeVisible();

    await page.getByPlaceholder("Tags, drops, resources, character, stats").fill("copper");
    await expect(page.getByText("1/2 shown")).toBeVisible();
    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.locator("#past-run-details-e2e-run-alpha").getByText("Copper Ore")).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).click();
    await page.locator(".tag-selector-button").first().click();
    await page.getByPlaceholder("Search or create a new tag").fill("e2e reviewed");
    await page.getByRole("menuitem", { name: "Create #e2e reviewed" }).click();
    await expect(page.locator(".run-tag-chip").filter({ hasText: "#e2e reviewed" })).toBeVisible();

    const state = await getRendererState(page);
    const updatedRun = state.pastRuns.find((run) => run.id === "e2e-run-alpha");
    expect(updatedRun.tags).toContain("e2e reviewed");

    await page.getByRole("button", { name: "Delete E2E Nomad" }).click();
    await page.locator(".past-run-card").filter({ hasText: "E2E Nomad" }).getByRole("button", { name: "Confirm" }).click();
    await expect.poll(async () => (await getRendererState(page)).pastRuns.map((run) => run.id)).toEqual(["e2e-run-alpha"]);
    await expect(page.getByText("E2E Nomad")).toHaveCount(0);

    await page.getByRole("button", { name: "Delete all past runs" }).click();
    await page.getByLabel("Confirm delete all past runs").getByRole("button", { name: "Confirm" }).click();
    await expect.poll(async () => (await getRendererState(page)).pastRuns).toEqual([]);
    await expect(page.getByText("Click End Run to save the current session here.")).toBeVisible();
  });
});
