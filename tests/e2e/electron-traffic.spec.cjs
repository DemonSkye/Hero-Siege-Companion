const { test, expect } = require("@playwright/test");
const {
  emitCapturePayloads,
  getRendererState,
  waitForRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eRareDropTrafficPayloads, e2eTrafficPayloads } = require("./support/fixtures.cjs");

test("parses mocked traffic payloads through main and renders live outcomes", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await emitCapturePayloads(electronApp, e2eTrafficPayloads());

    const state = await waitForRendererState(
      page,
      (nextState) => nextState.health.parsedEvents >= 4 && nextState.stats.accountName === "E2E Packet Runner",
      { message: "mocked traffic should reach StatsEngine and renderer state" },
    );

    expect(state.stats.totalGold).toBe(925_000);
    expect(state.stats.totalKills).toBe(7_500);
    expect(state.stats.items.Angelic).toMatchObject({ total: 1, mf: 0 });
    expect(state.stats.satanicZone.zone).toMatch(/Act 1/);
    expect(state.health).toMatchObject({
      packetsSeen: 1,
      payloadsAssembled: 1,
      parsedEvents: 5,
      parserErrors: 0,
    });

    await expect(page.getByText(/1 seen.*5 parsed/)).toBeVisible();
    await expect(page.getByText(/Act 1/).first()).toBeVisible();
    await expect(page.getByText("Aurelion Fury").first()).toBeVisible();

    await page.locator("button.item-counter.angelic").click();
    await expect(page.locator("#tracked-drops-card-body").getByText("Aurelion Fury")).toBeVisible();

    const runPace = page.locator("#run-pace-card");
    await expect(runPace.locator('[data-lane-id="xp"]')).toBeVisible();
    await expect(runPace.locator('[data-lane-id="gold"]')).toBeVisible();
    await expect(runPace.locator('[data-lane-id="kills"]')).toBeVisible();
    await expect(runPace.locator('[data-lane-id="items"] .run-pace-lane-summary strong')).toHaveText("1");

    await runPace.locator(".run-pace-standard-lanes").getByRole("checkbox", { name: "Gold" }).uncheck();
    await expect(runPace.locator('[data-lane-id="gold"]')).toHaveCount(0);

    await runPace.getByPlaceholder("Enter an exact item name").fill("Aurelion Fury");
    await runPace.getByRole("button", { name: "Track item" }).click();
    const trackedLane = runPace.locator('[data-lane-id="item:aurelion fury"]');
    await expect(trackedLane.locator(".run-pace-lane-label")).toHaveText("Aurelion Fury");
    await expect(trackedLane.locator(".run-pace-lane-summary strong")).toHaveText("1");

    await runPace.locator('[data-lane-id="items"] .run-pace-plot-surface').hover({ position: { x: 200, y: 20 } });
    const inspection = page.locator("[data-run-pace-inspection]");
    await expect(inspection).toBeVisible();
    await expect(inspection.locator("strong")).toHaveText(/^\d+:\d{2} since graph started$/);
    await expect(inspection.locator("dl > div", { hasText: "Items" }).locator("dd")).toHaveText("1");
    await expect(inspection.locator("dl > div", { hasText: "Aurelion Fury" }).locator("dd")).toHaveText("1");
    await expect(inspection).not.toContainText("Gold");

    const viewTabs = page.getByRole("tablist", { name: "Companion views" });
    await viewTabs.getByRole("tab", { name: /Item Filter/ }).click();
    await viewTabs.getByRole("tab", { name: "Live Session" }).click();
    await expect(page.locator('[data-lane-id="item:aurelion fury"] .run-pace-lane-summary strong')).toHaveText("1");
    await expect(page.locator('[data-lane-id="gold"]')).toHaveCount(0);

    const refreshedState = await getRendererState(page);
    expect(refreshedState.stats.itemTimeline.some((item) => item.label === "Aurelion Fury")).toBe(true);
  });
});

test("classifies heroic and angelic drops from mocked traffic messages", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await emitCapturePayloads(electronApp, e2eRareDropTrafficPayloads());

    const state = await waitForRendererState(
      page,
      (nextState) => nextState.stats.items.Heroic.total === 1 && nextState.stats.items.Angelic.total === 1,
      { message: "server just-found traffic should create tracked Heroic and Angelic drops" },
    );

    expect(state.stats.accountName).toBe("E2E Drop Verifier");
    expect(state.stats.items.Heroic).toMatchObject({ total: 1, mf: 0 });
    expect(state.stats.items.Angelic).toMatchObject({ total: 1, mf: 0 });
    expect(state.health).toMatchObject({
      packetsSeen: 1,
      payloadsAssembled: 1,
      parsedEvents: 3,
      parserErrors: 0,
    });
    expect(state.stats.itemBreakdown.Heroic["Fumacinha's Favela Flipflop"].total).toBe(1);
    expect(state.stats.itemBreakdown.Angelic["Aurelion Fury"].total).toBe(1);

    await page.locator("button.item-counter.heroic").click();
    await expect(page.locator("#tracked-drops-card-body").getByText("Fumacinha's Favela Flipflop")).toBeVisible();

    await page.locator("button.item-counter.angelic").click();
    await expect(page.locator("#tracked-drops-card-body").getByText("Aurelion Fury")).toBeVisible();
  });
});
