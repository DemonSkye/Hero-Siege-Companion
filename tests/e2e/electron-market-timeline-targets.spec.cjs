const { test, expect } = require("@playwright/test");
const accepted = require("../fixtures/market-accepted-transformed.json");
const {
  createUserDataDir, cleanupUserDataDir, launchCompanionApp, closeCompanionApp,
  emitCaptureEvents, getRendererState, getStoredUiPreferences,
} = require("./support/companion-app.cjs");

// Reconstructed parsed drop events exercise StatsEngine -> preload -> Timeline
// -> LiveView -> App -> Market -> actual main builder/reducer. They do not prove
// native packet runeword classification or current server matching. The retained
// accepted gloves response is a plumbing control for all three targets.
for (const specimen of [
  { label:"Cap",inputLabel:"Cap",repository:"normal",type:0,id:0,key:"normal:0:0:0",target:{itemMask:0},mask:"[0]",selector:null },
  { label:"Grief",inputLabel:"Legacy runeword name",repository:"runeword",type:3,id:81,key:"runeword-repository:81",target:{runewordId:81},mask:"[]",selector:"81" },
  { label:"Codex of the Card Collector",inputLabel:"Consumable #86",repository:"runeword",type:11,id:86,key:"runeword-repository:86",target:{runewordId:86},mask:"[]",selector:"86" },
]) test(`Timeline and picker use the same saveable Market target for ${specimen.label}`,async()=>{
  const userDataDir=createUserDataDir();let session;
  const attempts=()=>session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount());
  try {
    session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.evaluate(()=>window.heroSiegeCompanion.startCapture());
    await emitCaptureEvents(session.electronApp,[{name:"itemDropped",createdAt:Date.now(),raw:{},value:{
      source:"inventory",repository:specimen.repository,label:specimen.inputLabel,type:specimen.type,id:specimen.id,
      weaponType:0,seed:1,tokenLevel:0,dropQuality:0,rarity:0,rarityName:"Common",token:0,tier:0,
      amount:1,mfDrop:0,sockets:0,marketId:0,account:"",fingerprint:`synthetic-timeline-${specimen.id}`,
    }}]);
    const shortcut=session.page.getByRole("button",{name:`Check ${specimen.inputLabel} on the market`,exact:true});
    await expect(shortcut).toBeVisible();await shortcut.click();
    let workspace=session.page.locator(".market-workspace");
    await expect(workspace.locator(".market-chosen-item")).toContainText(specimen.label);
    expect(await attempts()).toBe(0);
    await workspace.locator("#market-sockets").fill("4");
    await workspace.locator("#market-stat-query").fill("rune drop");
    await workspace.getByRole("button",{name:"Rune Drop Chances Increased by (experimental)",exact:true}).click();
    await workspace.locator(".market-stat-row input").fill("2");
    await workspace.locator("#market-stat-query").fill("ranged skills");
    await workspace.getByRole("button",{name:"Ranged Skills (experimental)",exact:true}).click();
    await workspace.locator(".market-stat-row input").last().fill("10");
    const savedName=`Timeline ${specimen.label}`;
    await workspace.locator("#market-saved-name").fill(savedName);
    await workspace.getByRole("button",{name:"Save item and filters",exact:true}).click();
    const expected={...specimen.target,minSockets:4,statFilters:[{statId:271,minimum:10},{statId:351,minimum:2}]};
    await expect.poll(async()=>(await getStoredUiPreferences(session.page)).savedMarketItems.find(item=>item.name===savedName)?.request).toEqual(expected);
    expect((await getStoredUiPreferences(session.page)).savedMarketItems.find(item=>item.name===savedName)?.itemKey).toBe(specimen.key);
    expect(await attempts()).toBe(0);
    await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.emitSessionContext([123],[{
      text:"api account_id=7-424242&unique_account_id=SYNTHETIC_ID&crossregion_identifier=SYNTHETIC_SESSION&season=11&hardcore=0&beta=0",
      direction:"outbound",remoteAddress:"203.0.113.42",remotePort:26921,
    }]));
    await expect.poll(async()=>(await getRendererState(session.page)).marketReadiness.canSearch).toBe(true);
    await session.electronApp.evaluate((_electron,bytes)=>globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200,bytes),[...Buffer.from(accepted.response.bodyBase64,"base64")]);
    await workspace.getByRole("button",{name:"Search market",exact:true}).click();
    await expect(workspace.locator("tbody tr")).toHaveCount(20);expect(await attempts()).toBe(1);
    const form=await session.electronApp.evaluate(()=>globalThis.heroSiegeCompanionE2e.getMarketTestLastFilters());
    expect(form.filter_masks).toBe(specimen.mask);expect(form.filter_runeword).toBe(specimen.selector);
    expect(form.filter_sockets_min).toBe("4");
    expect(JSON.parse(Buffer.from(form.stat_filter,"base64").toString("utf8"))).toEqual([
      {statId:271,filter:2,statValue:10},{statId:351,filter:2,statValue:2},
    ]);
    await session.page.getByRole("tab",{name:"Live Session",exact:true}).click();await shortcut.click();
    await expect(workspace.locator("tbody tr")).toHaveCount(0);
    await expect(workspace.getByRole("button",{name:/^Search in \d+s$/})).toBeDisabled();
    expect(await attempts()).toBe(1);
    await workspace.getByRole("button",{name:"New search",exact:true}).click();
    await workspace.locator("#market-item-query").fill(specimen.label);await workspace.locator("#market-item-query").press("Enter");
    await workspace.locator("#market-saved-name").fill(`Picker ${specimen.label}`);
    await workspace.getByRole("button",{name:"Save item and filters",exact:true}).click();
    const picker=(await getStoredUiPreferences(session.page)).savedMarketItems.find(item=>item.name===`Picker ${specimen.label}`);
    expect(picker).toMatchObject({itemKey:specimen.key,request:{...specimen.target,statFilters:[]}});
    expect(await attempts()).toBe(1);
    await closeCompanionApp(session);session=await launchCompanionApp({userDataDir,marketTransport:true,gameRunning:false});
    await session.page.getByRole("tab",{name:"Market",exact:true}).click();workspace=session.page.locator(".market-workspace");
    await workspace.locator(".market-saved-load").filter({hasText:savedName}).click();
    await expect(workspace.locator("#market-sockets")).toHaveValue("4");await expect(workspace.locator(".market-stat-row")).toHaveCount(2);
    expect((await getStoredUiPreferences(session.page)).savedMarketItems.find(item=>item.name===savedName)?.request).toEqual(expected);
    await expect(workspace.locator("tbody tr")).toHaveCount(0);expect(await attempts()).toBe(0);
    expect(JSON.stringify(await getStoredUiPreferences(session.page))).not.toMatch(/SYNTHETIC|203\.0\.113|checksum|multipass|fingerprint/);
  } finally {if(session)await closeCompanionApp(session);cleanupUserDataDir(userDataDir);}
});
