const { test, expect } = require("@playwright/test");
const { deflateSync } = require("node:zlib");
const { createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  getRendererState, getStoredUiPreferences } = require("./support/companion-app.cjs");

test("unresolved encoded criteria survive actual save/restart and block IPC until explicitly repaired",async()=>{
  const userDataDir=createUserDataDir();let session;
  const attempts=()=>session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount());
  try {
    session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    // Reconstructed older exploratory minimum, not a native encoded-value request.
    await session.page.evaluate(()=>localStorage.setItem("hero-siege-companion:preferences:v1",JSON.stringify({schemaVersion:3,
      shoppingListItems:[],savedMarketItems:[{id:"encoded-old",name:"Old Ravager fields",itemKey:"runeword-repository:23",
        request:{runewordId:23,statFilters:[{statId:271,minimum:10},{statId:292,minimum:1}]}}],
    })));
    await session.page.reload();await session.page.getByRole("tab",{name:"Market",exact:true}).click();
    let workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"Old Ravager fields"}).click();
    await expect(workspace.locator(".market-range-list > div").filter({hasText:"Attacks can hit multiple enemies"})).toContainText("Conditional effect (encoded)");
    await expect(workspace).toContainText("This is an effect-presence field, not a numeric roll.");
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    const criteria={statFilters:[{statId:271,minimum:10},{statId:292,minimum:1}]};
    await expect.poll(async()=>(await getStoredUiPreferences(session.page)).savedMarketItems[0]).toMatchObject({
      id:"encoded-old",itemKey:"runeword-repository:23",request:null,criteria,
    });
    expect(await attempts()).toBe(0);
    await closeCompanionApp(session);session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:"Old Ravager fields"}).click();
    await expect(workspace.locator(".market-stat-row")).toHaveCount(2);
    await session.page.evaluate(()=>window.heroSiegeCompanion.startCapture());
    await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.emitSessionContext([123],[{
      text:"api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction:"outbound",remoteAddress:"203.0.113.42",remotePort:26921,
    }]));
    await expect.poll(async()=>(await getRendererState(session.page)).marketReadiness.canSearch).toBe(true);
    await expect(workspace.getByRole("button",{name:"Search market",exact:true})).toBeDisabled();
    expect(await attempts()).toBe(0);
    await workspace.locator("#market-stat-query").fill("Stat 203");
    await expect(workspace.locator('ul[aria-label="Stat suggestions"] button')).toBeEnabled();
    await workspace.locator('ul[aria-label="Stat suggestions"] button').click();
    await workspace.getByLabel("Selected talent modifier (Stat 203) (experimental) minimum",{exact:true}).fill("2");
    await workspace.locator("#market-stat-query").fill("");
    await workspace.getByRole("button",{name:"Remove Attacks can hit multiple enemies (experimental)",exact:true}).click();
    await workspace.getByRole("button",{name:"Save changes",exact:true}).click();
    await expect.poll(async()=>(await getStoredUiPreferences(session.page)).savedMarketItems[0].request).toEqual({
      runewordId:23,statFilters:[{statId:203,minimum:2},{statId:271,minimum:10}],
    });
    const body=Buffer.from(JSON.stringify({status:1,itemCount:0,items:deflateSync(Buffer.from("[]")).toString("base64")}));
    await session.electronApp.evaluate((_electron,bytes)=>globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200,bytes),[...body]);
    await workspace.getByRole("button",{name:"Search market",exact:true}).click();
    await expect(workspace.locator(".market-results")).toContainText("No matching price listings were returned");
    expect(await attempts()).toBe(1);
    expect(await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestLastFilters())).toEqual({
      filter_masks:"[]",filter_runeword:"23",filter_sockets_min:null,
      stat_filter:Buffer.from('[{"statId":203,"filter":2,"statValue":2},{"statId":271,"filter":2,"statValue":10}]').toString("base64"),
    });
  } finally {if(session)await closeCompanionApp(session);cleanupUserDataDir(userDataDir);}
});
