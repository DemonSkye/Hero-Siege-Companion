const { test, expect } = require("@playwright/test");
const {
  emitCapturePayloads,
  getStoredUiPreferences,
  waitForRendererState,
  withCompanionApp,
} = require("./support/companion-app.cjs");
const { e2eRareDropTrafficPayloads } = require("./support/fixtures.cjs");

test("builds, exercises, and removes an item filter group against mocked drop traffic", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    const viewTabs = page.getByRole("navigation", { name: "Companion views" });

    await viewTabs.getByRole("button", { name: /Item Filter/ }).click();
    await expect(page.getByRole("heading", { name: "Item Filter" })).toBeVisible();

    const addGroupForm = page.locator(".item-filter-add-group");
    await addGroupForm.locator("input").fill("E2E Loot Alerts");
    await addGroupForm.getByRole("button", { name: "Add" }).click();

    const groupButton = page.locator(".item-filter-group-button", { hasText: "E2E Loot Alerts" });
    await expect(groupButton).toBeVisible();

    const rarities = page.locator(".item-filter-rule-section", { hasText: "Rarities" });
    await rarities.locator("label", { hasText: "Heroic" }).locator("input").setChecked(true);

    const search = page.getByPlaceholder("Search item name");
    await search.fill("aurelion");
    await page.locator(".item-filter-suggestions").getByRole("button", { name: "Aurelion Fury" }).click();

    const aurelionRow = page.locator(".item-filter-specific-row", { hasText: "Aurelion Fury" });
    await expect(aurelionRow).toBeVisible();
    await aurelionRow.getByRole("button", { name: "Remove Aurelion Fury" }).click();
    await expect(aurelionRow).toHaveCount(0);

    await search.fill("aurelion");
    await page.locator(".item-filter-suggestions").getByRole("button", { name: "Aurelion Fury" }).click();
    await expect(page.locator(".item-filter-specific-row", { hasText: "Aurelion Fury" })).toBeVisible();

    await expect.poll(async () => {
      const preferences = await getStoredUiPreferences(page);
      return preferences.itemFilterGroups.some(
        (group) =>
          group.name === "E2E Loot Alerts" &&
          group.rarities.includes("Heroic") &&
          group.items.some((item) => item.name === "Aurelion Fury"),
      );
    }, { message: "configured filter group should be persisted before traffic arrives" }).toBe(true);

    await viewTabs.getByRole("button", { name: "Live Session" }).click();
    await emitCapturePayloads(electronApp, e2eRareDropTrafficPayloads());
    await waitForRendererState(
      page,
      (nextState) => nextState.stats.items.Heroic.total === 1 && nextState.stats.items.Angelic.total === 1,
      { message: "mocked rare drops should update live state" },
    );

    const itemFilterCard = page.locator(".item-filter-panel.live-dashboard-card");
    await expect(itemFilterCard.locator(".item-filter-last")).toContainText("E2E Loot Alerts");
    await expect(itemFilterCard.locator(".item-filter-last strong")).toContainText(/Aurelion Fury|Fumacinha's Favela Flipflop/);
    await itemFilterCard.getByRole("button", { name: /Totals/ }).click();
    await expect(page.getByLabel("Filtered drop totals").getByText("Fumacinha's Favela Flipflop")).toBeVisible();
    await expect(page.getByLabel("Filtered drop totals").getByText("Aurelion Fury")).toBeVisible();

    await viewTabs.getByRole("button", { name: /Item Filter/ }).click();
    await groupButton.click();
    await page.getByRole("button", { name: "Remove Group" }).click();

    const confirmation = page.getByRole("dialog", { name: 'Remove "E2E Loot Alerts"?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(groupButton).toBeVisible();

    await page.getByRole("button", { name: "Remove Group" }).click();
    await confirmation.getByRole("button", { name: "Remove Group", exact: true }).click();
    await expect(groupButton).toHaveCount(0);

    await expect.poll(async () => {
      const preferences = await getStoredUiPreferences(page);
      return preferences.itemFilterGroups.some((group) => group.name === "E2E Loot Alerts");
    }, { message: "removed filter group should be removed from persisted preferences" }).toBe(false);
  });
});
