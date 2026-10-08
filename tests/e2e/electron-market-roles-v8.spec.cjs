const {test,expect}=require("@playwright/test");
const {deflateSync}=require("node:zlib");
const {createUserDataDir,cleanupUserDataDir,launchCompanionApp,closeCompanionApp,
  getStoredUiPreferences,getRendererState}=require("./support/companion-app.cjs");

test("Cloak proc quantities search through real IPC while role identifiers remain durable and distinct",async()=>{
  const userDataDir=createUserDataDir();let session;
  try{
    session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    // Older experimental entry: the selector was mistakenly used as an amount.
    // Values are reconstructed from retained constructor facts, not a live drop.
    await session.page.evaluate(()=>localStorage.setItem("hero-siege-companion:preferences:v1",JSON.stringify({schemaVersion:3,
      shoppingListItems:[],savedMarketItems:[{id:"v8-cloak",name:"Proc cloak",itemKey:"unique:1:0:100",request:null,
        criteria:{statFilters:[{statId:116,minimum:555},{statId:117,minimum:15},{statId:118,minimum:5}]}}],
    })));
    await session.page.reload();await session.page.getByRole("tab",{name:"Market",exact:true}).click();
    let workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"Proc cloak"}).click();
    const proc = workspace.locator(".market-range-list > div").filter({hasText:"Triggered talent when striking"});
    await expect(proc).toContainText("Chance [3\u20136]; level [12\u201320]");
    await expect(proc).toContainText("Talent name unavailable");
    await expect(workspace.locator(".market-range-list")).not.toContainText("Identifier: 555");
    await expect(workspace).toContainText("Talent identity needs an exact selector");
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    await expect.poll(async()=>(await getStoredUiPreferences(session.page)).savedMarketItems[0].criteria).toEqual({
      statFilters:[{statId:116,minimum:555},{statId:117,minimum:15},{statId:118,minimum:5}],
    });
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await closeCompanionApp(session);session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"Proc cloak"}).click();
    await session.page.evaluate(()=>window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.emitSessionContext([123],[{
      text:"api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction:"outbound",remoteAddress:"203.0.113.42",remotePort:26921,
    }]));
    await expect.poll(async()=>(await getRendererState(session.page)).marketReadiness.canSearch).toBe(true);
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeDisabled();
    await workspace.locator("#market-stat-query").fill("Class identifier");
    await expect(workspace.locator('ul[aria-label="Stat suggestions"] button').first()).toBeDisabled();
    await expect(workspace.locator('ul[aria-label="Stat suggestions"]')).toContainText("Class identity needs an exact selector");
    await workspace.locator("#market-stat-query").fill("Double Jump");
    await expect(workspace.locator('ul[aria-label="Stat suggestions"] button')).toBeDisabled();
    await expect(workspace.locator('ul[aria-label="Stat suggestions"]')).toContainText("effect-presence field");
    await workspace.locator("#market-stat-query").fill("Stat 291");
    await expect(workspace.locator('ul[aria-label="Stat suggestions"] button')).toContainText("Double Jump (experimental)");
    await expect(workspace.locator('ul[aria-label="Stat suggestions"] button')).toBeDisabled();
    await workspace.locator("#market-stat-query").fill("Stat 24");
    await expect(workspace.locator('ul[aria-label="Stat suggestions"] button').filter({hasText:"Stat 24 (experimental)"})).toBeEnabled();
    await workspace.locator("#market-stat-query").fill("");
    await workspace.getByRole("button",{name:"Remove Talent identifier when striking (Stat 116) (experimental)",exact:true}).click();
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeEnabled();
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    const body=Buffer.from(JSON.stringify({status:1,itemCount:0,items:deflateSync(Buffer.from("[]")).toString("base64")}));
    await session.electronApp.evaluate((_electron,bytes)=>globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200,bytes),[...body]);
    await workspace.getByRole("button",{name:"Search market",exact:true}).click();
    await expect(workspace.locator(".market-results")).toContainText("No matching price listings were returned");
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestLastFilters())).toEqual({
      filter_masks:"[1073746020]",filter_runeword:null,filter_sockets_min:null,
      stat_filter:Buffer.from('[{"statId":117,"filter":2,"statValue":15},{"statId":118,"filter":2,"statValue":5}]').toString("base64"),
    });
    await expect.poll(async()=>(await getStoredUiPreferences(session.page)).savedMarketItems[0].request).toEqual({
      itemMask:1073746020,statFilters:[{statId:117,minimum:15},{statId:118,minimum:5}],
    });
  }finally{if(session)await closeCompanionApp(session);cleanupUserDataDir(userDataDir);}
});
