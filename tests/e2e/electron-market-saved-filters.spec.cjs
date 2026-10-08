const { test, expect } = require("@playwright/test");
const accepted = require("../fixtures/market-accepted-transformed.json");
const { deflateSync } = require("node:zlib");
const {
  createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  getStoredUiPreferences, getRendererState,
} = require("./support/companion-app.cjs");

// Real Electron/preload/main/renderer with the established synthetic-only runtime.
// No native capture, real game, credential, server or network success is involved.
test("Market migration, keyboard loading, durable edits and IPC failure compose in Electron", async () => {
  const userDataDir = createUserDataDir();
  let session;
  try {
    session = await launchCompanionApp({ userDataDir, gameRunning: false });
    await session.page.evaluate(() => {
      localStorage.setItem("hero-siege-companion:preferences:v1", JSON.stringify({ schemaVersion: 2, shoppingListItems: ["Sharpshooter's Cloak", "Owner retained name"] }));
    });
    await session.page.reload();
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    let workspace = session.page.locator(".market-workspace");
    await expect(workspace).toContainText("Owner retained name");
    await expect(session.page.locator(".shopping-panel")).toHaveCount(0);
    await workspace.getByRole("button", { name: "Sharpshooter's Cloak", exact: false }).first().click();
    await expect(workspace.locator("#market-sockets")).toBeFocused();
    await workspace.locator("#market-sockets").fill("4");
    await workspace.locator("#market-stat-query").fill("mana stolen");
    await workspace.locator("#market-stat-query").press("Enter");
    await workspace.locator(".market-stat-row input").fill("8");
    await workspace.locator("#market-saved-name").fill("Mana cloak");
    await workspace.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.[0]?.name).toBe("Mana cloak");
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeDisabled();
    await session.page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([123], [{
      text: "api account_id=10-42&unique_account_id=CANARY_IDENTITY&crossregion_identifier=CANARY_SESSION&season=11&hardcore=0&beta=0",
      direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 26921,
    }]));
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    await workspace.locator("#market-sockets").press("Enter");
    await expect(workspace.locator(".market-results")).toContainText("could not prepare the direct market request");
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");
    expect(await getStoredUiPreferences(session.page)).toMatchObject({
      shoppingListItems: ["Sharpshooter's Cloak", "Owner retained name"],
      savedMarketItems: [{ name: "Mana cloak", request: { itemMask: 1073746020, minSockets: 4, statFilters: [{ statId: 64, minimum: 8 }] } }, { name: "Owner retained name", request: null }],
    });
    expect(JSON.stringify(await getStoredUiPreferences(session.page))).not.toMatch(/CANARY|seller|fingerprint|crossregion/);
    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, gameRunning: false });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").first().click();
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("8");
    await expect(workspace.locator(".market-results")).toContainText("waiting for current session evidence");
    await workspace.getByRole("button", { name: "Delete saved item Mana cloak", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.length).toBe(1);
    await workspace.getByRole("button", { name: "Undo delete", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.length).toBe(2);
  } finally {
    if (session) await closeCompanionApp(session);
    cleanupUserDataDir(userDataDir);
  }
});

test("saved Market uses the accepted price page through real IPC, clears stale prices and reopens without requests", async () => {
  const userDataDir = createUserDataDir();
  let session;
  const attemptCount = () => session.electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount());
  const observe = async (season = "11", account = "7-424242") => {
    await session.electronApp.evaluate((_electron, context) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [{
      direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
      localAddress: "192.0.2.10", localPort: 5000,
      text: `account_id=${context.account}&unique_account_id=SYNTHETIC-accepted-uid&crossregion_identifier=SYNTHETIC-accepted-session&season=${context.season}&hardcore=0&beta=0`,
    }]), { season, account });
    await expect.poll(async () => (await getRendererState(session.page)).marketReadiness.canSearch).toBe(true);
  };
  try {
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    let workspace = session.page.locator(".market-workspace");
    await workspace.locator("#market-item-query").fill("Death Knight's Gauntlets");
    await workspace.locator("#market-item-query").press("Enter");
    await workspace.locator("#market-saved-name").fill("Death Knight search");
    await workspace.getByRole("button", { name: "Save item and filters", exact: true }).click();
    await expect.poll(async () => (await getStoredUiPreferences(session.page)).savedMarketItems?.find(item => item.name === "Death Knight search")?.request)
      .toEqual({ itemMask: 1073758270, statFilters: [] });
    expect(await attemptCount()).toBe(0);
    await observe();
    // Main readiness publishes asynchronously; exercise Enter only after the
    // rendered form permits the explicit search.
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeEnabled();
    await session.electronApp.evaluate((_electron, bytes) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, bytes), [...Buffer.from(accepted.response.bodyBase64, "base64")]);
    await workspace.locator("#market-sockets").press("Enter");
    await expect(workspace.locator("tbody tr")).toHaveCount(20);
    const prices = await workspace.locator("tbody tr td:first-of-type").allTextContents();
    expect(prices).toEqual([
      "4,000 gold", "6,000 gold", "7,000 gold", "10,000 gold", "11,000 gold", "12,000 gold", "13,000 gold", "14,000 gold",
      "15,000 gold", "15,000 gold", "20,000 gold", "20,000 gold", "20,000 gold", "20,000 gold", "28,888 gold",
      "30,000 gold", "30,000 gold", "33,333 gold", "33,333 gold", "33,333 gold",
    ]);
    await expect(workspace.locator(".market-result-details")).toContainText("20 shown · 101 returned rows");
    await expect(workspace.locator(".market-result-details")).not.toHaveAttribute("open");
    expect(await attemptCount()).toBe(1);
    await observe("12");
    await expect(workspace.locator("tbody tr")).toHaveCount(0);
    await expect(workspace.locator(".market-chosen-item")).toContainText("Death Knight's Gauntlets");
    await observe("12", "7-424243");
    await workspace.locator(".market-saved-load").filter({ hasText: "Death Knight search" }).click();
    expect(await attemptCount()).toBe(1);
    await closeCompanionApp(session);
    session = await launchCompanionApp({ userDataDir, marketTransport: true });
    await session.page.getByRole("tab", { name: "Market", exact: true }).click();
    workspace = session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({ hasText: "Death Knight search" }).click();
    await expect(workspace.locator(".market-chosen-item")).toContainText("Death Knight's Gauntlets");
    await expect(workspace.locator("tbody tr")).toHaveCount(0);
    expect(await attemptCount()).toBe(0);
    await expect(workspace.getByRole("button", { name: "Search market", exact: true })).toBeDisabled();
    expect(JSON.stringify(await getStoredUiPreferences(session.page))).not.toMatch(/SYNTHETIC|203\.0\.113|checksum|multipass|seller/);
  } finally {
    if (session) await closeCompanionApp(session);
    cleanupUserDataDir(userDataDir);
  }
});

test("old pending runewords migrate through the native permutation and retain criteria across real restart",async()=>{
  const userDataDir=createUserDataDir();let session;
  try{
    session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    // Reconstructed old schema3 pending entries from the prior candidate. No
    // credentials or live response are used. Internal cases1/93 become IDs81/86.
    await session.page.evaluate(()=>localStorage.setItem("hero-siege-companion:preferences:v1",JSON.stringify({
      schemaVersion:3,shoppingListItems:["Grief","Codex of the Card Collector"],savedMarketItems:[
        {id:"old-grief",name:"My Grief search",itemKey:"runeword:3:0:1",request:null,criteria:{minSockets:4,statFilters:[{statId:271,minimum:10}]}},
        {id:"old-codex",name:"My Codex search",itemKey:"runeword:3:0:93",request:null,criteria:{statFilters:[]}},
      ],
    })));
    await session.page.reload();await session.page.getByRole("tab",{name:"Market",exact:true}).click();
    let workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"My Grief search"}).click();
    await expect(workspace.locator(".market-chosen-item")).toContainText("Grief");
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("10");
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    await expect.poll(async()=>(await getStoredUiPreferences(session.page)).savedMarketItems?.[0]).toMatchObject({
      id:"old-grief",name:"My Grief search",itemKey:"runeword-repository:81",
      request:{runewordId:81,minSockets:4,statFilters:[{statId:271,minimum:10}]},criteria:{minSockets:4,statFilters:[{statId:271,minimum:10}]},
    });
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await session.page.evaluate(()=>window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.emitSessionContext([123],[{
      text:"api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction:"outbound",remoteAddress:"203.0.113.42",remotePort:26921,
    }]));
    // Existing accepted gloves response is a plumbing control, not proof that
    // a server matches Grief. Production construction/reduction is retained.
    await session.electronApp.evaluate((_electron,bytes)=>globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200,bytes),[...Buffer.from(accepted.response.bodyBase64,"base64")]);
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeEnabled();
    await workspace.getByRole("button",{name:"Search market",exact:true}).click();
    await expect(workspace.locator("tbody tr")).toHaveCount(20);
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestLastFilters())).toEqual({
      filter_masks:"[]",filter_runeword:"81",filter_sockets_min:"4",stat_filter:"W3sic3RhdElkIjoyNzEsImZpbHRlciI6Miwic3RhdFZhbHVlIjoxMH1d",
    });
    await workspace.locator(".market-saved-load").filter({hasText:"My Codex search"}).click();
    await expect(workspace.locator(".market-chosen-item")).toContainText("Codex of the Card Collector");
    await expect(workspace.locator("tbody tr")).toHaveCount(0);
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    expect((await getStoredUiPreferences(session.page)).savedMarketItems[1]).toMatchObject({
      id:"old-codex",itemKey:"runeword-repository:86",request:{runewordId:86,statFilters:[]},criteria:{statFilters:[]},
    });
    await closeCompanionApp(session);session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"My Grief search"}).click();
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");
    await expect(workspace.locator(".market-stat-row input")).toHaveValue("10");
    await expect(workspace.locator("tbody tr")).toHaveCount(0);
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    const prefs=await getStoredUiPreferences(session.page);
    expect(prefs.shoppingListItems).toEqual(["Grief","Codex of the Card Collector"]);
    expect(JSON.stringify(prefs)).not.toMatch(/SYNTHETIC|checksum|multipass|seller/);
  }finally{if(session)await closeCompanionApp(session);cleanupUserDataDir(userDataDir);}
});

test("metadata saved criteria remain durable and visibly block numeric search until repaired",async()=>{
  const userDataDir=createUserDataDir();let session;
  try{
    session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.evaluate(()=>localStorage.setItem("hero-siege-companion:preferences:v1",JSON.stringify({schemaVersion:3,
      shoppingListItems:["Sharpshooter's Cloak"],savedMarketItems:[{id:"metadata",name:"Preserved metadata",
        itemKey:"unique:1:0:100",request:{itemMask:1073746020,minSockets:4,statFilters:[{statId:185,minimum:103},{statId:271,minimum:10}]}}],
    })));
    await session.page.reload();await session.page.getByRole("tab",{name:"Market",exact:true}).click();
    let workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"Preserved metadata"}).click();
    await expect(workspace).toContainText("These saved criteria are preserved, but cannot be sent as numeric minimums.");
    await expect(workspace).toContainText("Skill identifier metadata cannot be searched as a roll minimum.");
    await expect(workspace.getByRole("button",{name:"Save changes",exact:true})).toBeEnabled();
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    await session.page.evaluate(()=>window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.emitSessionContext([123],[{
      text:"api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction:"outbound",remoteAddress:"203.0.113.42",remotePort:26921,
    }]));
    await expect.poll(async()=>(await getRendererState(session.page)).marketReadiness.canSearch).toBe(true);
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeDisabled();
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    const preserved=(await getStoredUiPreferences(session.page)).savedMarketItems[0];
    expect(preserved).toMatchObject({id:"metadata",itemKey:"unique:1:0:100",request:null,
      criteria:{minSockets:4,statFilters:[{statId:185,minimum:103},{statId:271,minimum:10}]}});
    await workspace.getByRole("button",{name:"Remove Triggered skill identifier (experimental)",exact:true}).click();
    await workspace.locator("#market-stat-query").fill("Skill parameter");
    const parameter=workspace.locator(".market-options button").filter({hasText:"Skill parameter 186"});
    await expect(parameter).toBeEnabled();
    await parameter.click();
    await workspace.getByLabel("Skill parameter 186 (experimental) minimum",{exact:true}).fill("20");
    await workspace.locator("#market-stat-query").fill("");
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeEnabled();
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    const body=Buffer.from(JSON.stringify({status:1,itemCount:0,items:deflateSync(Buffer.from("[]")).toString("base64")}));
    await session.electronApp.evaluate((_electron,bytes)=>globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200,bytes),[...body]);
    await workspace.getByRole("button",{name:"Search market",exact:true}).click();
    await expect(workspace.locator(".market-results")).toContainText("No matching price listings were returned");
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestLastFilters())).toEqual({
      filter_masks:"[1073746020]",filter_runeword:null,filter_sockets_min:"4",
      stat_filter:Buffer.from('[{"statId":186,"filter":2,"statValue":20},{"statId":271,"filter":2,"statValue":10}]').toString("base64"),
    });
    await closeCompanionApp(session);session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"Preserved metadata"}).click();
    await expect(workspace.locator(".market-stat-row")).toHaveCount(2);
    await expect(workspace.getByLabel("Skill parameter 186 (experimental) minimum",{exact:true})).toHaveValue("20");
    await expect(workspace.getByLabel("Ranged Skills (experimental) minimum",{exact:true})).toHaveValue("10");
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
  }finally{if(session)await closeCompanionApp(session);cleanupUserDataDir(userDataDir);}
});
