const { test, expect } = require("@playwright/test");
const { withCompanionApp } = require("./support/companion-app.cjs");

test("keeps the live dashboard cards measurable, visible, and non-overlapping", async () => {
  await withCompanionApp(async ({ page }) => {
    const diagnostics = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".live-dashboard-card")).map((card) => ({
        id: card.id,
        title: card.querySelector("h2")?.textContent?.trim() ?? card.id,
        rect: rectOf(card),
      }));

      const tinyCards = cards.filter((card) => card.rect.width < 180 || card.rect.height < 70).map((card) => card.title);
      const horizontallyOffscreenCards = cards
        .filter((card) => card.rect.right < 0 || card.rect.left > window.innerWidth)
        .map((card) => card.title);
      const overlaps = [];
      for (let index = 0; index < cards.length; index += 1) {
        for (let nextIndex = index + 1; nextIndex < cards.length; nextIndex += 1) {
          if (overlapArea(cards[index].rect, cards[nextIndex].rect) > 4) {
            overlaps.push(`${cards[index].title} overlaps ${cards[nextIndex].title}`);
          }
        }
      }

      return {
        cardCount: cards.length,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tinyCards,
        horizontallyOffscreenCards,
        overlaps,
      };

      function rectOf(element) {
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      }

      function overlapArea(first, second) {
        const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
        const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
        return width * height;
      }
    });

    expect(diagnostics.cardCount).toBeGreaterThanOrEqual(6);
    expect(diagnostics.horizontalOverflow).toBeLessThanOrEqual(4);
    expect(diagnostics.tinyCards).toEqual([]);
    expect(diagnostics.horizontallyOffscreenCards).toEqual([]);
    expect(diagnostics.overlaps).toEqual([]);
  });
});

test("keeps compact mode controls inside the compact window without clipped labels", async () => {
  await withCompanionApp(async ({ page }) => {
    await page.getByRole("button", { name: "Compact mode" }).click();
    await expect(page.locator(".compact-view")).toBeVisible();

    const diagnostics = await page.evaluate(() => {
      const compactRoot = document.querySelector(".compact-view");
      const buttons = Array.from(document.querySelectorAll(".compact-view button")).map((button) => ({
        label: button.textContent?.trim() || button.getAttribute("aria-label") || button.title,
        rect: rectOf(button),
        clipped: button.scrollWidth > button.clientWidth + 2 || button.scrollHeight > button.clientHeight + 2,
      }));

      return {
        hasCompactRoot: Boolean(compactRoot),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clippedButtons: buttons.filter((button) => button.clipped).map((button) => button.label),
        offscreenButtons: buttons
          .filter((button) => button.rect.left < -1 || button.rect.right > window.innerWidth + 1 || button.rect.top < -1 || button.rect.bottom > window.innerHeight + 1)
          .map((button) => button.label),
      };

      function rectOf(element) {
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      }
    });

    expect(diagnostics.hasCompactRoot).toBe(true);
    expect(diagnostics.horizontalOverflow).toBeLessThanOrEqual(4);
    expect(diagnostics.clippedButtons).toEqual([]);
    expect(diagnostics.offscreenButtons).toEqual([]);
  });
});
