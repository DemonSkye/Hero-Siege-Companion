const { test, expect } = require("@playwright/test");
const { deflateSync } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const fixture = require("../fixtures/market-listing-items.json");
const { createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  getStoredUiPreferences } = require("./support/companion-app.cjs");

async function resize(session, width, height) {
  await session.electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(340, 160);
    window.setSize(bounds.width, bounds.height);
  }, { width, height });
  await expect.poll(() => session.page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width, height });
}

async function capture(session, name) {
  // Electron resize/scroll layout can settle before Chromium commits the new
  // scrolling layer. Wait for paint frames; DOM visibility alone missed blanks.
  await session.page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const directory = process.env.HSC_MARKET_SCREENSHOT_DIR;
  if (directory) fs.mkdirSync(directory, { recursive: true });
  const suffix = test.info().repeatEachIndex ? `-${test.info().repeatEachIndex}` : "";
  return session.page.screenshot(directory ? { path: path.join(directory, name + suffix + ".png") } : {});
}

async function expectPaintedText(session, locator, bytes, name) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeInViewport({ ratio: 1 });
  const rect = await locator.boundingBox();
  const paint = await session.electronApp.evaluate(({ nativeImage }, { bytes, rect }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    let lightPixels = 0;
    for (let y = Math.max(0, Math.ceil(rect.y)); y < Math.min(height, Math.floor(rect.y + rect.height)); y++) {
      for (let x = Math.max(0, Math.ceil(rect.x)); x < Math.min(width, Math.floor(rect.x + rect.width)); x++) {
        const index = (y * width + x) * 4;
        if (bitmap[index] > 140 && bitmap[index + 1] > 140 && bitmap[index + 2] > 140) lightPixels++;
      }
    }
    return { width, height, lightPixels };
  }, { bytes: [...bytes], rect });
  const diagnostics = await session.page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    visibility: document.visibilityState, scrollTop: document.querySelector(".app-scroll").scrollTop }));
  const directory = process.env.HSC_MARKET_SCREENSHOT_DIR;
  if (directory) fs.writeFileSync(path.join(directory, `${name}-paint-${test.info().repeatEachIndex}.json`),
    JSON.stringify({ paint, rect, diagnostics }, null, 2));
  // Default dark theme: these pixels belong to light text, not panel/background.
  expect(paint.lightPixels, `${name} must be painted in the saved image, not just present in the DOM`).toBeGreaterThan(40);
}

// Synthetic transport with production request construction, compressed response
// reduction, main cache/allowlist, preload and renderer. No real capture/server.
test("Market listing rolls, responsive alignment and saved state compose through real IPC", async () => {
  const userDataDir = createUserDataDir();
  let session;
  const size = (width, height) => resize(session, width, height);
  const screenshot = name => capture(session, name);
  const ready = async (account = "7-424242") => {
    await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate((_electron, text) => globalThis.heroSiegeCompanionE2e.emitSessionContext([123], [{
      text, direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921,
    }]), `api account_id=${account}&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0`);
  };
  const respond = async rows => {
    const body = Buffer.from(JSON.stringify({ status: 1, itemCount: rows.length,
      items: deflateSync(Buffer.from(JSON.stringify(rows))).toString("base64") }));
    await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...body]);
  };
  try {
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await size(1380, 1000);
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    const workspace = session.page.locator(".market-workspace");
    const panelLayout = () => workspace.evaluate(root => {
      const filter = root.querySelector(".market-filter-layout fieldset").getBoundingClientRect();
      const panel = root.querySelector(".market-catalog-ranges").getBoundingClientRect();
      return { filterLeft: filter.left, filterWidth: filter.width, panelLeft: panel.left, sameRow: filter.top === panel.top };
    });
    await expect(workspace.locator(".market-catalog-placeholder")).toHaveText("Choose an item to see its stats.");
    const beforeChoice = await panelLayout();
    expect(beforeChoice.sameRow).toBe(true);
    await workspace.locator("#market-item-query").fill("Battle Mage's Shield");
    await workspace.locator("#market-item-query").press("Enter");
    await expect(workspace.locator(".market-catalog-placeholder")).toHaveCount(0);
    expect(await panelLayout()).toEqual(beforeChoice);
    await workspace.locator("#market-saved-name").fill("Shield stats");
    await workspace.getByRole("button", { name: "Save item and filters", exact: true }).click();
    await ready();
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    const row = fixture.specimens[0].row;
    await respond([row, { ...row, price: 35000, item_data: { ...row.item_data, q: 1 } },
      { ...row, price: 45000, item_data: { ...row.item_data, w: 0 } }]);
    await workspace.locator(".market-chosen-item").scrollIntoViewIfNeeded();
    await screenshot("market-known-wide-editor");
    await workspace.getByRole("button", { name: "Search market", exact: true }).click();
    await expect(workspace.locator("tbody tr")).toHaveCount(3);
    const results = workspace.locator(".market-results");
    await expect(results.locator(".market-listing-item").first()).toContainText("Mana439");
    await expect(results.locator(".market-listing-item").first()).toContainText("Enhanced Defense124%");
    await expect(results.locator(".market-listing-item").nth(1)).toContainText("Stats unknown for this variant");
    await expect(results.locator(".market-listing-item").nth(2)).toContainText("Unidentified — rolls hidden");
    await expect(workspace.locator(".market-catalog-ranges")).toContainText("Mana[300–450]");
    await expect(workspace.locator(".market-result-details")).not.toHaveAttribute("open");
    const wide = await workspace.evaluate(root => {
      const box = selector => root.querySelector(selector).getBoundingClientRect();
      return { lefts: [".market-chosen-item", "#market-filters-title", "label[for=market-sockets]",
        "#market-sockets", "#market-results-title"]
        .map(selector => box(selector).left), filter: box("fieldset").width,
        ranges: box(".market-catalog-ranges").width, sameRow: box("fieldset").top === box(".market-catalog-ranges").top,
        title: box(".market-results-heading").bottom, table: box(".market-price-table").top,
        footer: box(".market-results-footer").top, tableBottom: box(".market-price-table").bottom,
        changeDistance: box(".market-chosen-item button").left - box(".market-chosen-item > div").right,
        savedNameWidth: box("#market-saved-name").width,
        actionsInside: ["button[type=submit]", "#market-saved-name", ".market-save-controls button"].every(selector => root.querySelector(".market-form-actions").contains(root.querySelector(selector))) };
    });
    expect(Math.max(...wide.lefts) - Math.min(...wide.lefts)).toBeLessThan(2);
    expect(wide.ranges).toBeLessThanOrEqual(wide.filter);
    expect(wide.ranges).toBeLessThanOrEqual(440);
    expect(wide.sameRow).toBe(true);
    expect(wide.table - wide.title).toBeLessThan(20);
    expect(wide.footer).toBeGreaterThanOrEqual(wide.tableBottom);
    expect(wide.changeDistance).toBeLessThan(25);
    expect(wide.savedNameWidth).toBeLessThanOrEqual(256);
    expect(wide.actionsInside).toBe(true);
    await screenshot("market-known-wide");
    await workspace.locator(".market-results").scrollIntoViewIfNeeded();
    await expect(results.locator("tbody tr")).toHaveCount(3);
    await expect(results.locator(".market-listing-item").first()).toContainText("Mana439");
    await expect(results.locator(".market-listing-item").first()).toBeInViewport({ ratio: 1 });
    await screenshot("market-known-wide-results");
    await size(560, 1000);
    const narrow = await workspace.evaluate(root => {
      const filter = root.querySelector("fieldset").getBoundingClientRect();
      const ranges = root.querySelector(".market-catalog-ranges").getBoundingClientRect();
      const table = root.querySelector(".market-price-table");
      return { stacked: ranges.top > filter.bottom, sameLeft: Math.abs(filter.left - ranges.left),
        overflow: document.documentElement.scrollWidth > innerWidth, tableDisplay: getComputedStyle(table).display };
    });
    expect(narrow).toEqual({ stacked: true, sameLeft: 0, overflow: false, tableDisplay: "block" });
    await workspace.locator(".market-results").scrollIntoViewIfNeeded();
    await expect(results.locator("tbody tr")).toHaveCount(3);
    await expect(results.locator(".market-listing-item").first()).toContainText("Mana439");
    await expect(results.locator(".market-listing-item").first()).toBeInViewport({ ratio: 1 });
    const narrowBytes = await screenshot("market-known-narrow-results");
    await expectPaintedText(session, results.locator(".market-listing-stats li").filter({ hasText: /^Mana439$/ }),
      narrowBytes, "market-known-narrow-results");
    await workspace.locator(".market-chosen-item").scrollIntoViewIfNeeded();
    await screenshot("market-known-narrow-editor");
    const stored = await getStoredUiPreferences(session.page);
    expect(stored.savedMarketItems.find(item => item.name === "Shield stats")).toMatchObject({ name: "Shield stats", itemKey: "unique:6:0:38",
      request: { itemMask: 1073766438, statFilters: [] } });
    expect(JSON.stringify(stored)).not.toMatch(/SYNTHETIC|fingerprint|370600734|"stats"|seller/);
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    await ready("7-424243");
    await expect(results.locator("tbody tr")).toHaveCount(0);
    await workspace.getByRole("button", { name: "Change item", exact: true }).click();
    await workspace.locator("#market-item-query").fill("Sharpshooter's Cloak");
    await workspace.locator("#market-item-query").press("Enter");
    await expect(workspace.locator(".market-catalog-ranges")).toContainText("Ranged Skills[6–12]");
    await size(1380, 1000);
    await screenshot("market-cloak-unknown-ranges");
    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    await session.page.locator(".market-saved-load").filter({ hasText: "Shield stats" }).click();
    await expect(session.page.locator(".market-chosen-item")).toContainText("Battle Mage's Shield");
    await expect(session.page.locator(".market-catalog-ranges")).toContainText("Mana[300–450]");
    await expect(session.page.locator("tbody tr")).toHaveCount(0);
    expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
  } finally {
    if (session) await closeCompanionApp(session);
    if (path.dirname(path.resolve(userDataDir)) !== path.resolve(os.tmpdir())
      || !path.basename(userDataDir).startsWith("hsc-e2e-")) throw new Error("Unexpected test profile location");
    cleanupUserDataDir(userDataDir);
  }
});

for (const specimen of [
  { name: "Tiny Planet", slug: "tiny-planet", row: { price: 1, unit_price: 1, fingerprint: "SYNTHETIC-0-0-10",
    item_data: { c: 1, b: 92, j: 0, d: 1, e: 11, w: 1, a: 618478963 } },
    catalog: "Increased Orbital Projectile Duration[15%\u201325%]", listing: "Increased Orbital Projectile Duration22%", numeric: true },
  { name: "Bob's Piece of Plywood", slug: "bobs-plywood", row: fixture.specimens[1].row,
    catalog: "10% Chance when Struck: Chainsaw Massacre (Level 40)", listing: "10% Chance when Struck: Chainsaw Massacre (Level 40)" },
  { name: "Lemon", slug: "lemon", row: { price: 1, unit_price: 1, fingerprint: "SYNTHETIC-0-0-3",
    item_data: { c: 1, b: 0, j: 17, d: 1, e: 11, w: 1, a: 1000 } },
    catalog: "Stat 23[1.25]", listing: "Stat 231.25", numeric: true },
  { name: "Death Knight's Gauntlets", slug: "tier-glove", row: { price: 1, unit_price: 1, fingerprint: "SYNTHETIC-0-0-4",
    item_data: { c: 1, b: 62, d: 24, e: 11, w: 1, a: 1000 } },
    catalog: "Enhanced Damage per level[0.5%]", listing: "Enhanced Damage per level0.5%", numeric: true },
  { name: "Death Knight's Gauntlets", slug: "modified-glove", row: { price: 1, unit_price: 1, fingerprint: "SYNTHETIC-0-0-4",
    item_data: { c: 1, b: 62, d: 24, e: 11, w: 1, a: 1000, p: 1 } },
    catalog: "Enhanced Damage per level[0.5%]", listing: "Stats unknown for this variant", modifier: true },
]) {
  test(`${specimen.name} (${specimen.slug}) preserves constructor confidence through main and preload`, async () => {
    const session = await launchCompanionApp({ marketTransport: true });
    try {
      await resize(session, 1380, 1000);
      await session.page.getByRole("tab", { name: "Market", exact: true }).click();
      const workspace = session.page.locator(".market-workspace");
      await workspace.locator("#market-item-query").fill(specimen.name);
      await workspace.locator("#market-item-query").press("Enter");
      await expect(workspace.locator(".market-catalog-ranges")).toContainText(specimen.catalog);
      await expect(workspace.locator(".market-catalog-ranges")).not.toContainText("Catalog ranges are not available");
      await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
      await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([123], [{
        text: "api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
        direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921,
      }]));
      const body = Buffer.from(JSON.stringify({ status: 1, itemCount: 1,
        items: deflateSync(Buffer.from(JSON.stringify([specimen.row]))).toString("base64") }));
      await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...body]);
      await workspace.getByRole("button", { name: "Search market", exact: true }).click();
      const listing = workspace.locator(".market-listing-details");
      await expect(listing).toContainText(specimen.listing);
      await expect(workspace).not.toContainText(/Triggered skill ID|Unknown stat 18[67]/);
      if (specimen.numeric) await expect(listing).toContainText("Reconstructed listing stats (experimental)");
      else if (specimen.modifier) {
        await expect(listing.locator("summary")).toHaveText("9 fields unavailable");
        await expect(listing.locator("details")).not.toHaveAttribute("open");
        await listing.locator("summary").click();
        await expect(listing.locator(".market-listing-stats li")).toHaveCount(9);
        await expect(listing).toContainText("Modifier effects unavailable");
        await expect(listing).not.toContainText("0.5");
      } else await expect(listing).toContainText("Strength27");
      await workspace.locator(".market-results").scrollIntoViewIfNeeded();
      await capture(session, `market-${specimen.slug}-wide-results`);
      await resize(session, 560, 1000);
      await workspace.locator(".market-results").scrollIntoViewIfNeeded();
      const name = `market-${specimen.slug}-narrow-results`;
      const bytes = await capture(session, name);
      const painted = specimen.numeric
        ? listing.locator(".market-listing-stats li").filter({ hasText: specimen.listing })
        : listing.getByText(specimen.listing, { exact: true });
      await expectPaintedText(session, painted, bytes, name);
      expect(await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    } finally {
      await closeCompanionApp(session);
      if (path.dirname(path.resolve(session.userDataDir)) !== path.resolve(os.tmpdir())
        || !path.basename(session.userDataDir).startsWith("hsc-e2e-")) throw new Error("Unexpected test profile location");
      cleanupUserDataDir(session.userDataDir);
    }
  });
}

test("offline catalog cards, experimental search and native runeword filters survive Electron restart", async () => {
  const userDataDir = createUserDataDir();
  let session;
  const count = () => session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount());
  try {
    session = await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await resize(session,1380,1000);
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();
    let workspace = session.page.locator(".market-workspace");
    const choose = async name => {
      const change = workspace.getByRole("button",{name:"Change item",exact:true});
      if (await change.count()) await change.click();
      await workspace.locator("#market-item-query").fill(name);
      const exactName = name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      await workspace.locator(".market-options button").filter({hasText:new RegExp(`^${exactName}\\s`)}).first().click();
    };
    for (const [name, expected] of [["Short Sword","[5\u20137]"],["Ol","[50]"],["Sharpshooter's Cloak","Ranged Skills[6\u201312]"]]) {
      await choose(name);
      await expect(workspace.locator(".market-catalog-ranges")).toContainText(expected);
      await expect(workspace.locator(".market-catalog-ranges")).toContainText("Experimental base ranges.");
      await expect(workspace.locator(".market-catalog-ranges details")).not.toHaveAttribute("open");
    }
    await expect(workspace.locator(".market-range-list > div")).toHaveCount(12);
    await workspace.locator("#market-stat-query").fill("Ranged Skills");
    await expect(workspace.locator('ul[aria-label="Stat suggestions"]')).toContainText("Ranged Skills (experimental)");
    await workspace.locator("#market-stat-query").press("Enter");
    await workspace.locator(".market-stat-row input").fill("10");
    await workspace.locator("#market-saved-name").fill("Ranged cloak");
    await workspace.getByRole("button",{name:"Save item and filters",exact:true}).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.find(x=>x.name==="Ranged cloak")?.request)
      .toEqual({itemMask:1073746020,statFilters:[{statId:271,minimum:10}]});
    expect(await count()).toBe(0);
    await workspace.locator(".market-chosen-item").scrollIntoViewIfNeeded();
    await capture(session,"market-cloak-full-card-wide");
    await resize(session,560,1000);
    const ranged = workspace.locator(".market-range-list > div").filter({hasText:"Ranged Skills"});
    await ranged.scrollIntoViewIfNeeded();
    const bytes = await capture(session,"market-cloak-full-card-narrow");
    await expectPaintedText(session,ranged.locator("dt"),bytes,"market-cloak-full-card-narrow");
    expect(await session.page.evaluate(()=>document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await session.page.evaluate(()=>window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.emitSessionContext([123],[{
      text:"api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction:"outbound",remoteAddress:"203.0.113.42",remotePort:26921,
    }]));
    const body = Buffer.from(JSON.stringify({status:1,itemCount:0,items:deflateSync(Buffer.from("[]")).toString("base64")}));
    await session.electronApp.evaluate((_electron,value)=>globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200,value),[...body]);
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeEnabled();
    await workspace.getByRole("button",{name:"Search market",exact:true}).click();
    await expect(workspace.locator(".market-results")).toContainText("No matching price listings were returned");
    expect(await count()).toBe(1);
    await workspace.getByRole("button",{name:"New search",exact:true}).click();
    await choose("Breath of the Damned");
    await expect(workspace.locator(".market-catalog-ranges")).toContainText("[730\u2013880]");
    await expect(workspace).not.toContainText("Runeword search encoding is not verified yet");
    await workspace.locator("#market-stat-query").fill("ranged");
    await workspace.locator("#market-stat-query").press("Enter");
    await workspace.locator(".market-stat-row input").fill("6");
    await workspace.locator("#market-saved-name").fill("Pending runeword");
    await workspace.getByRole("button",{name:"Save item and filters",exact:true}).click();
    await expect(workspace.locator('.market-editor button[type="submit"]')).toBeDisabled();
    await expect(workspace).not.toContainText("Runeword search encoding is not verified yet");
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.find(x=>x.name==="Pending runeword"))
      .toMatchObject({itemKey:"runeword-repository:1",request:{runewordId:1,statFilters:[{statId:271,minimum:6}]},criteria:{statFilters:[{statId:271,minimum:6}]}});
    expect(await count()).toBe(1);
    await closeCompanionApp(session);
    session = await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();
    workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"Pending runeword"}).click();
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("6");
    await expect(workspace).not.toContainText("Runeword search encoding is not verified yet");
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeDisabled();
    await session.page.evaluate(()=>window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.emitSessionContext([123],[{
      text:"api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction:"outbound",remoteAddress:"203.0.113.42",remotePort:26921,
    }]));
    await session.electronApp.evaluate((_electron,value)=>globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200,value),[...body]);
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeEnabled();
    await workspace.getByRole("button",{name:"Search market",exact:true}).click();
    await expect(workspace.locator(".market-results")).toContainText("No matching price listings were returned");
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestLastFilters())).toEqual({
      filter_masks:"[]",filter_runeword:"1",filter_sockets_min:null,stat_filter:"W3sic3RhdElkIjoyNzEsImZpbHRlciI6Miwic3RhdFZhbHVlIjo2fV0=",
    });
    await workspace.locator(".market-saved-load").filter({hasText:"Ranged cloak"}).click();
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("10");
    await expect(workspace.locator(".market-range-list > div")).toHaveCount(12);
    expect(await count()).toBe(1);
  } finally {
    if (session) await closeCompanionApp(session);
    cleanupUserDataDir(userDataDir);
  }
});

test("Gryphon's tooltip phrases and compact form actions remain readable at wide and narrow sizes", async () => {
  const userDataDir = createUserDataDir(); let session;
  try {
    session = await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();
    const workspace = session.page.locator(".market-workspace");
    const originalSaved = (await getStoredUiPreferences(session.page)).savedMarketItems;
    await workspace.locator("#market-item-query").fill("Gryphon's Claw");
    await workspace.locator("#market-item-query").press("Enter");
    const card = workspace.locator(".market-catalog-ranges");
    await expect(card.locator(".market-range-list > div")).toHaveCount(5);
    await expect(card).toContainText("+[12\u201318] to [Execute]");
    await expect(card).toContainText("+[15\u201325]% Chance to Open Wounds");
    await expect(card.locator(".market-range-list")).not.toContainText("Identifier:");
    await expect(card.locator("details")).not.toHaveAttribute("open");
    for (const [name,width] of [["wide",1380],["narrow",560]]) {
      await resize(session,width,1000);
      await card.scrollIntoViewIfNeeded();
      const bytes = await capture(session,`market-gryphon-card-${name}`);
      await expectPaintedText(session,card.locator("dt").filter({hasText:"+[12\u201318] to [Execute]"}),bytes,`market-gryphon-card-${name}`);
      await workspace.locator(".market-form-actions").scrollIntoViewIfNeeded();
      const actions = await workspace.locator(".market-form-actions").evaluate(root => {
        const box = root.getBoundingClientRect();
        const controls = [...root.querySelectorAll("button,input")].map(element => element.getBoundingClientRect());
        return { overflow:document.documentElement.scrollWidth > innerWidth,
          inside:controls.every(control => control.left >= box.left && control.right <= box.right + 1),
          nameWidth:root.querySelector("input").getBoundingClientRect().width };
      });
      expect(actions.overflow).toBe(false); expect(actions.inside).toBe(true); expect(actions.nameWidth).toBeLessThanOrEqual(256);
      await capture(session,`market-form-actions-${name}`);
    }
    await card.locator("summary").click();
    await expect(card.locator("details")).toHaveAttribute("open");
    await expect(card).toContainText("Build 24868792");
    await workspace.locator("#market-saved-name").fill("Gryphon bonus");
    await workspace.getByRole("button",{name:"Save item and filters",exact:true}).click();
    await workspace.locator("#market-stat-query").fill("unfinished");
    await workspace.getByRole("button",{name:"Clear",exact:true}).click();
    await expect(workspace.locator(".market-chosen-item")).toHaveCount(0);
    await expect(workspace.locator("#market-saved-name")).toHaveValue("");
    await expect(workspace.locator("#market-stat-query")).toHaveValue("");
    await expect(workspace.locator(".market-saved-load")).toHaveCount(originalSaved.length + 1);
    const afterClear = (await getStoredUiPreferences(session.page)).savedMarketItems;
    expect(afterClear.slice(0,originalSaved.length)).toEqual(originalSaved);
    expect(afterClear.at(-1)).toMatchObject({name:"Gryphon bonus",itemKey:"unique:5:0:65",criteria:{statFilters:[]}});
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
  } finally { if(session)await closeCompanionApp(session);cleanupUserDataDir(userDataDir); }
});
