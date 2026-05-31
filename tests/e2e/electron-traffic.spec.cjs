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
