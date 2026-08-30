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

      const titlebar = document.querySelector(".app-titlebar");
      const windowControls = document.querySelector(".window-controls");
      const windowControlButtons = Array.from(document.querySelectorAll(".window-controls button"));
      const windowControlRects = windowControlButtons.map(rectOf);
      const scoreCells = Array.from(document.querySelectorAll(".run-score-cell"))
        .map(rectOf)
        .sort((left, right) => left.left - right.left);
      const scoreCellGaps = scoreCells.slice(1).map((cell, index) => cell.left - scoreCells[index].right);
      const mainColumn = document.querySelector(".dashboard-column-main");
      const sideColumn = document.querySelector(".dashboard-column-side");
      const timelineCard = document.querySelector("#item-timeline-card");
      const timelineIsIdle = timelineCard?.textContent?.includes("No tracked item drops in this session yet.") ?? false;
      const statusStrip = document.querySelector(".status-strip");
      const dashboardCustomizer = document.querySelector('summary[aria-label="Customize dashboard"]');
      const runScoreStrip = document.querySelector(".run-score-strip");
      const runPaceCard = document.querySelector("#run-pace-card");
      const dashboardGrid = document.querySelector(".dashboard-grid");
      const runPacePlots = Array.from(document.querySelectorAll("#run-pace-card .run-pace-plot")).map(rectOf);
      const runScoreRect = runScoreStrip ? rectOf(runScoreStrip) : null;
      const runPaceRect = runPaceCard ? rectOf(runPaceCard) : null;
      const dashboardRect = dashboardGrid ? rectOf(dashboardGrid) : null;

      return {
        cardCount: cards.length,
        dashboardCustomizerInStatus: Boolean(statusStrip && dashboardCustomizer && statusStrip.contains(dashboardCustomizer)),
        dashboardCustomizerVisible: dashboardCustomizer ? rectOf(dashboardCustomizer).width > 0 && rectOf(dashboardCustomizer).height > 0 : false,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        idleTimelineHeight: timelineIsIdle && timelineCard ? rectOf(timelineCard).height : null,
        mainToRailRatio: mainColumn && sideColumn ? rectOf(mainColumn).width / rectOf(sideColumn).width : 0,
        maxScoreCellGap: scoreCellGaps.length ? Math.max(...scoreCellGaps) : Number.POSITIVE_INFINITY,
        oldRunCommandBannerPresent: Boolean(document.querySelector(".live-dashboard-toolbar")),
        runPaceAlignedWithScore: Boolean(runScoreRect && runPaceRect)
          && Math.abs(runScoreRect.left - runPaceRect.left) <= 2
          && Math.abs(runScoreRect.right - runPaceRect.right) <= 2,
        runPaceLaneCount: runPacePlots.length,
        runPacePlotsMeasured: runPacePlots.every((rect) => rect.width >= 200 && rect.height >= 30),
        runPaceOrderedBetweenScoreAndDashboard: Boolean(runScoreRect && runPaceRect && dashboardRect)
          && runScoreRect.bottom <= runPaceRect.top + 1
          && runPaceRect.bottom <= dashboardRect.top + 1,
        scoreCellCount: scoreCells.length,
        tinyCards,
        titlebarContainsControls: Boolean(titlebar && windowControls)
          && rectOf(windowControls).top >= rectOf(titlebar).top - 1
          && rectOf(windowControls).bottom <= rectOf(titlebar).bottom + 1,
        windowControlCount: windowControlButtons.length,
        windowControlRowSpread: windowControlRects.length
          ? Math.max(...windowControlRects.map((rect) => rect.top)) - Math.min(...windowControlRects.map((rect) => rect.top))
          : Number.POSITIVE_INFINITY,
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

    expect(diagnostics.cardCount).toBeGreaterThanOrEqual(5);
    expect(diagnostics.horizontalOverflow).toBeLessThanOrEqual(4);
    expect(diagnostics.windowControlCount).toBe(5);
    expect(diagnostics.windowControlRowSpread).toBeLessThanOrEqual(1);
    expect(diagnostics.titlebarContainsControls).toBe(true);
    expect(diagnostics.scoreCellCount).toBe(4);
    expect(diagnostics.maxScoreCellGap).toBeLessThanOrEqual(2);
    expect(diagnostics.oldRunCommandBannerPresent).toBe(false);
    expect(diagnostics.dashboardCustomizerInStatus).toBe(true);
    expect(diagnostics.dashboardCustomizerVisible).toBe(true);
    expect(diagnostics.runPaceAlignedWithScore).toBe(true);
    expect(diagnostics.runPaceLaneCount).toBe(4);
    expect(diagnostics.runPacePlotsMeasured).toBe(true);
    expect(diagnostics.runPaceOrderedBetweenScoreAndDashboard).toBe(true);
    expect(diagnostics.mainToRailRatio).toBeGreaterThan(1.5);
    if (diagnostics.idleTimelineHeight !== null) expect(diagnostics.idleTimelineHeight).toBeLessThan(180);
    expect(diagnostics.tinyCards).toEqual([]);
    expect(diagnostics.horizontallyOffscreenCards).toEqual([]);
    expect(diagnostics.overlaps).toEqual([]);

    const customizer = page.locator('summary[aria-label="Customize dashboard"]');
    await customizer.click();
    const customizerPopover = page.locator(".dashboard-customizer-popover");
    await expect(customizerPopover).toBeVisible();
    const customizerLayering = await customizerPopover.evaluate((popover) => {
      const checkbox = popover.querySelector('input[type="checkbox"]');
      if (!(checkbox instanceof HTMLInputElement)) throw new Error("Dashboard fixture checkbox is missing");
      const rect = popover.getBoundingClientRect();
      const checkboxRect = checkbox.getBoundingClientRect();
      const sampleX = checkboxRect.left + (checkboxRect.width / 2);
      const sampleY = checkboxRect.top + (checkboxRect.height / 2);
      const topElement = document.elementFromPoint(sampleX, sampleY);
      return {
        insideViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1,
        topElementInsidePopover: Boolean(topElement && popover.contains(topElement)),
      };
    });
    expect(customizerLayering.insideViewport).toBe(true);
    expect(customizerLayering.topElementInsidePopover).toBe(true);
    await customizer.click();

    await page.evaluate(() => {
      const menu = document.querySelector("#item-timeline-card .timeline-filter-menu");
      const timelineCard = document.querySelector("#item-timeline-card");
      if (!(menu instanceof HTMLDetailsElement)) throw new Error("Timeline filter menu is missing");
      if (!(timelineCard instanceof HTMLElement)) throw new Error("Timeline card is missing");
      menu.open = true;
      timelineCard.scrollIntoView({ block: "center" });
    });
    const filterLayering = await page.evaluate(() => {
      const timelineCard = document.querySelector("#item-timeline-card");
      const popover = timelineCard?.querySelector(".timeline-filter-popover");
      const shoppingCard = document.querySelector(".shopping-panel");
      if (!(timelineCard instanceof HTMLElement)
        || !(popover instanceof HTMLElement)
        || !(shoppingCard instanceof HTMLElement)) {
        throw new Error("Timeline filter layering fixtures are missing");
      }

      const popoverRect = popover.getBoundingClientRect();
      const shoppingRect = shoppingCard.getBoundingClientRect();
      const overlapLeft = Math.max(popoverRect.left, shoppingRect.left);
      const overlapRight = Math.min(popoverRect.right, shoppingRect.right);
      const overlapTop = Math.max(popoverRect.top, shoppingRect.top);
      const overlapBottom = Math.min(popoverRect.bottom, shoppingRect.bottom);
      const overlapWidth = Math.max(0, overlapRight - overlapLeft);
      const overlapHeight = Math.max(0, overlapBottom - overlapTop);
      const sampleX = overlapLeft + Math.min(8, overlapWidth / 2);
      const sampleY = overlapTop + Math.min(8, overlapHeight / 2);
      const topElement = overlapWidth > 0 && overlapHeight > 0 ? document.elementFromPoint(sampleX, sampleY) : null;
      const backgroundColor = getComputedStyle(popover).backgroundColor;
      const alphaMatch = backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);

      return {
        backgroundAlpha: alphaMatch ? Number(alphaMatch[1]) : 1,
        backgroundColor,
        overlapHeight,
        overlapWidth,
        sampleX,
        sampleY,
        timelineCardZIndex: getComputedStyle(timelineCard).zIndex,
        topElement: topElement instanceof HTMLElement ? `${topElement.tagName}.${topElement.className}` : null,
        topElementInsidePopover: Boolean(topElement && popover.contains(topElement)),
      };
    });

    expect(filterLayering.timelineCardZIndex).toBe("60");
    expect(filterLayering.overlapWidth).toBeGreaterThan(20);
    expect(filterLayering.overlapHeight).toBeGreaterThan(20);
    expect(filterLayering.topElementInsidePopover, JSON.stringify(filterLayering)).toBe(true);
    expect(filterLayering.backgroundAlpha, JSON.stringify(filterLayering)).toBe(1);
  });
});

test("keeps Run Pace and dashboard customization usable at the minimum full-window width", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(980, 700, false);
    });

    const diagnostics = await page.evaluate(() => {
      const graph = document.querySelector("#run-pace-card");
      const form = graph?.querySelector(".run-pace-tracker-form");
      const lanes = Array.from(graph?.querySelectorAll(".run-pace-lane") ?? []);
      const controls = Array.from(graph?.querySelectorAll("input, button") ?? []);
      const customizer = document.querySelector('summary[aria-label="Customize dashboard"]');
      const graphRect = graph?.getBoundingClientRect();

      return {
        customizerVisible: customizer instanceof HTMLElement && customizer.offsetWidth > 0 && customizer.offsetHeight > 0,
        formColumns: form instanceof HTMLElement ? getComputedStyle(form).gridTemplateColumns.split(" ").length : 0,
        graphFitsViewport: Boolean(graphRect) && graphRect.left >= -1 && graphRect.right <= window.innerWidth + 1,
        graphHasNoInternalVerticalScroll: graph instanceof HTMLElement && graph.scrollHeight <= graph.clientHeight + 1,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        laneCount: lanes.length,
        clippedControls: controls
          .filter((control) => control.scrollWidth > control.clientWidth + 2 || control.scrollHeight > control.clientHeight + 2)
          .map((control) => control.getAttribute("aria-label") || control.textContent?.trim() || control.tagName),
      };
    });

    expect(diagnostics.horizontalOverflow).toBeLessThanOrEqual(4);
    expect(diagnostics.graphFitsViewport).toBe(true);
    expect(diagnostics.graphHasNoInternalVerticalScroll).toBe(true);
    expect(diagnostics.customizerVisible).toBe(true);
    expect(diagnostics.formColumns).toBeGreaterThanOrEqual(2);
    expect(diagnostics.laneCount).toBe(4);
    expect(diagnostics.clippedControls).toEqual([]);
  });
});

test("keeps Settings header and navigation fixed while Help and Support scrolls as one pane", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1_000, 650, false);
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Help & Support", exact: true }).click();
    await settings.locator("details").evaluateAll((disclosures) => {
      disclosures.forEach((disclosure) => {
        disclosure.open = true;
      });
    });

    const layout = await settings.evaluate((dialog) => {
      const header = dialog.querySelector(".settings-ledger-header");
      const nav = dialog.querySelector(".settings-ledger-nav");
      const content = dialog.querySelector(".settings-ledger-content");
      const about = dialog.querySelector("#settings-about-title");
      const backdrop = dialog.closest(".settings-ledger-backdrop");
      if (!(header instanceof HTMLElement)
        || !(nav instanceof HTMLElement)
        || !(content instanceof HTMLElement)
        || !(about instanceof HTMLElement)
        || !(backdrop instanceof HTMLElement)) {
        throw new Error("Settings layout elements are missing");
      }

      const headerTop = header.getBoundingClientRect().top;
      const navTop = nav.getBoundingClientRect().top;
      const maximumScrollTop = content.scrollHeight - content.clientHeight;
      content.scrollTop = maximumScrollTop;

      const contentRect = content.getBoundingClientRect();
      const lastSection = content.lastElementChild;
      const bottomScrollTop = content.scrollTop;
      const bottomReached = lastSection instanceof HTMLElement
        && lastSection.getBoundingClientRect().bottom <= contentRect.bottom + 1;
      const aboutOffset = about.getBoundingClientRect().top - contentRect.top + content.scrollTop;
      content.scrollTop = aboutOffset;
      const aboutRect = about.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      const activeNestedVerticalScrollers = Array.from(content.querySelectorAll("*"))
        .filter((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const overflowY = getComputedStyle(element).overflowY;
          return (overflowY === "auto" || overflowY === "scroll")
            && element.scrollHeight > element.clientHeight + 1;
        })
        .map((element) => element.className || element.tagName);

      return {
        aboutInsideContent: aboutRect.top >= contentRect.top - 1 && aboutRect.bottom <= contentRect.bottom + 1,
        activeNestedVerticalScrollers,
        backdropScrollTop: backdrop.scrollTop,
        bottomReached,
        bottomScrollTop,
        contentClientHeight: content.clientHeight,
        contentOverflowY: getComputedStyle(content).overflowY,
        contentScrollHeight: content.scrollHeight,
        dialogHeight: dialogRect.height,
        disclosureStates: Array.from(content.querySelectorAll("details")).map((detail) => detail.open),
        headerTopBefore: headerTop,
        headerTopAfter: header.getBoundingClientRect().top,
        maximumScrollTop,
        navTopBefore: navTop,
        navTopAfter: nav.getBoundingClientRect().top,
        scrollTop: content.scrollTop,
      };
    });

    expect(layout.contentOverflowY).toBe("auto");
    expect(layout.disclosureStates.length).toBeGreaterThan(0);
    expect(layout.disclosureStates.every(Boolean)).toBe(true);
    expect(layout.maximumScrollTop, JSON.stringify(layout)).toBeGreaterThan(100);
    expect(layout.bottomScrollTop).toBeGreaterThanOrEqual(layout.maximumScrollTop - 1);
    expect(layout.bottomReached).toBe(true);
    expect(layout.aboutInsideContent).toBe(true);
    expect(layout.headerTopAfter).toBeCloseTo(layout.headerTopBefore, 1);
    expect(layout.navTopAfter).toBeCloseTo(layout.navTopBefore, 1);
    expect(layout.backdropScrollTop).toBe(0);
    expect(layout.activeNestedVerticalScrollers).toEqual([]);
  });
});

test("keeps compact mode controls inside every compact theme without clipped labels", async () => {
  await withCompanionApp(async ({ page }) => {
    await page.getByRole("button", { name: "Compact mode" }).click();
    await expect(page.locator(".compact-view")).toBeVisible();

    for (const theme of ["dark", "demonsteel", "voidglass", "reliquary", "cyberpunk", "light"]) {
      const diagnostics = await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
        const compactRoot = document.querySelector(".compact-view");
        const compactRunCover = document.querySelector(".compact-run-cover");
        const compactRunGrid = compactRunCover?.querySelector(".compact-cover-grid") ?? null;
        const coverRect = compactRunCover ? rectOf(compactRunCover) : null;
        const gridRect = compactRunGrid ? rectOf(compactRunGrid) : null;
        const buttons = Array.from(document.querySelectorAll(".compact-view button")).map((button) => ({
          label: button.textContent?.trim() || button.getAttribute("aria-label") || button.title,
          rect: rectOf(button),
          clipped: button.scrollWidth > button.clientWidth + 2 || button.scrollHeight > button.clientHeight + 2,
        }));

        return {
          theme: nextTheme,
          hasCompactRoot: Boolean(compactRoot),
          coverPosition: compactRunCover ? getComputedStyle(compactRunCover).position : "",
          coverRect,
          coverBottomGap: coverRect ? window.innerHeight - coverRect.bottom : null,
          coverGridBottomGap: coverRect && gridRect ? coverRect.bottom - gridRect.bottom : null,
          compactCoverAnimation: compactRunCover ? getComputedStyle(compactRunCover, "::after").animationName : "",
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
      }, theme);

      expect(diagnostics.hasCompactRoot).toBe(true);
      expect(diagnostics.coverPosition, diagnostics.theme).toBe("fixed");
      expect(diagnostics.coverRect?.top, diagnostics.theme).toBeLessThanOrEqual(36);
      expect(diagnostics.coverBottomGap, diagnostics.theme).toBeGreaterThanOrEqual(7);
      expect(diagnostics.coverGridBottomGap, diagnostics.theme).toBeGreaterThanOrEqual(8);
      if (diagnostics.theme === "cyberpunk") expect(diagnostics.compactCoverAnimation).toBe("none");
      expect(diagnostics.horizontalOverflow, diagnostics.theme).toBeLessThanOrEqual(4);
      expect(diagnostics.clippedButtons, diagnostics.theme).toEqual([]);
      expect(diagnostics.offscreenButtons, diagnostics.theme).toEqual([]);
    }
  });
});
