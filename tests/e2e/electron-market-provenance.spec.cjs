const { test, expect } = require("@playwright/test");
const fs = require("node:fs"), path = require("node:path"), { deflateSync } = require("node:zlib");
const { withCompanionApp, getRendererState } = require("./support/companion-app.cjs");
const request = { itemMask: 1073746020, statFilters: [] };
const flow = { direction: "outbound", remoteAddress: "203.0.113.42", remotePort: 6668,
  localAddress: "192.0.2.10", localPort: 5000 };
const contextText = "account_id=7-424242&unique_account_id=CANARY-uid&crossregion_identifier=CANARY-session&season=11&hardcore=0&beta=0";
const success = JSON.stringify({ status: 1, itemCount: 101,
  items: deflateSync(Buffer.from('[{"price":200000,"seller":"CANARY-seller"},{"price":500000}]')).toString("base64") });
function results(userDataDir) {
  return fs.readFileSync(path.join(userDataDir, "logs/app-debug.log"), "utf8").split(/\r?\n/)
    .filter(line => line.includes('"market-direct-result"')).map(line => JSON.parse(line));
}
async function ready(electronApp, page, text = contextText, payloadFlow = flow) {
  await page.evaluate(() => window.heroSiegeCompanion.startCapture());
  // The synthetic runtime clears its connections on start. Supply the current
  // game-owned flow before fresh payloads, as real capture discovery does.
  await electronApp.evaluate((_electron, connection) => globalThis.heroSiegeCompanionE2e.emitCaptureUpdate({ connections: [connection] }),
    { ...payloadFlow, owningProcess: 42, state: "Established" });
  await electronApp.evaluate((_electron, payload) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [payload]), { ...payloadFlow, text });
  await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
}
async function response(electronApp, text) {
  await electronApp.evaluate((_electron, body) => globalThis.heroSiegeCompanionE2e.setMarketTestResponse(200, body), [...Buffer.from(text)]);
}
test("production main/preload Market search preserves safe metadata and cache across stable fields on different connections", async () => {
  await withCompanionApp({ marketTransport: true }, async ({ electronApp, page, userDataDir }) => {
    await ready(electronApp, page); await response(electronApp, success);
    const first = await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request);
    expect(first).toMatchObject({ ok: true, cached: false, result: { listings: [{ price: 200000 }, { price: 500000 }], totalMatches: 101 } });
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request)).toMatchObject({ ok: true, cached: true });
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    await electronApp.evaluate((_electron, payload) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [payload]), {
      ...flow, localPort: 6000,
      text: "account_id=7-424242&unique_account_id=CANARY-uid&season=11&hardcore=0&beta=0",
    });
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request)).toMatchObject({ ok: true, cached: true });
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    // An actual identity value change still invalidates all old fields/cache.
    await electronApp.evaluate((_electron, payload) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [payload]), {
      ...flow, remoteAddress: "203.0.113.99", localPort: 6000, text: "unique_account_id=CANARY-new-uid&beta=0",
    });
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(false);
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request)).toMatchObject({ ok: false, errorCode: "template_unavailable" });
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    await ready(electronApp, page, contextText.replace("7-424242", "9-424242").replace("CANARY-uid", "CANARY-new-uid"), { ...flow, remoteAddress: "203.0.113.99", localPort: 6000 });
    const records = results(userDataDir), event = records.at(-1), data = event.data ?? event;
    expect(data.requestContext).toMatchObject({ season: "11", hardcore: "0", beta: "0", sameEndpoint: true, sameFlow: true, accountQualification: "observed-prefix" });
    expect(JSON.stringify(records)).not.toMatch(/CANARY|424242|203\.0\.113|192\.0\.2|checksum.*[a-f0-9]{64}/);
    expect(JSON.stringify(await getRendererState(page))).not.toMatch(/CANARY|424242|requestContext/);
  });
});
test("checksum rejection carries the same final mode/source metadata without echoed authentication", async () => {
  await withCompanionApp({ marketTransport: true }, async ({ electronApp, page, userDataDir }) => {
    await ready(electronApp, page); await response(electronApp, '{"status":-3,"message":"checksum CANARY-uid 7-424242"}');
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request)).toMatchObject({ ok: false, errorCode: "checksum_rejected" });
    const records = results(userDataDir), event = records.at(-1), data = event.data ?? event;
    expect(data).toMatchObject({ serverReason: "checksum", httpStatus: 200, applicationStatus: -3,
      requestContext: { season: "11", hardcore: "0", beta: "0", sameEndpoint: true, sameFlow: true, accountQualification: "observed-prefix" } });
    expect(JSON.stringify(records)).not.toMatch(/CANARY|424242|203\.0\.113|192\.0\.2/);
  });
});

test("stable account/mode and transient session on separate endpoints remain searchable with diagnostic disagreement", async () => {
  await withCompanionApp({ marketTransport: true }, async ({ electronApp, page, userDataDir }) => {
    await page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await electronApp.evaluate((_electron, payloads) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], payloads), [
      { ...flow, text: "account_id=7-424242&season=11&hardcore=0&beta=0" },
      { ...flow, remoteAddress: "203.0.113.99", localPort: 6000, text: "unique_account_id=CANARY-uid&crossregion_identifier=CANARY-session&beta=0" },
    ]);
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
    await response(electronApp, success);
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request)).toMatchObject({ ok: true, cached: false });
    const records = results(userDataDir), event = records.at(-1), data = event.data ?? event;
    expect(data.requestContext).toMatchObject({ season: "11", hardcore: "0", beta: "0", sameEndpoint: false, sameFlow: false });
    expect(JSON.stringify(records)).not.toMatch(/CANARY|424242|203\.0\.113|192\.0\.2/);
  });
});

test("multiple character records stay independent through main/preload search and never reach the renderer", async () => {
  await withCompanionApp({ marketTransport: true }, async ({ electronApp, page, userDataDir }) => {
    await ready(electronApp, page, "api " + contextText + "&slot=4");
    await electronApp.evaluate((_electron, payloads) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], payloads), [
      { ...flow, text: "save account_id=424242&beta=0&slot=4&slot_data=" + encodeURIComponent('{"season":11,"hardcore":0}') },
      { ...flow, localPort: 6000, text: "save account_id=424242&beta=0&slot=8&slot_data=" + encodeURIComponent('{"season":12,"hardcore":0}') },
      { ...flow, text: "api " + contextText.replace("season=11", "season=12") + "&slot=4" },
    ]);
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(0);
    await response(electronApp, '{"status":-3,"message":"checksum CANARY-uid 7-424242"}');
    const result = await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request);
    expect(result).toMatchObject({ ok: false, errorCode: "checksum_rejected" });
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getMarketTestAttemptCount())).toBe(1);
    const event = results(userDataDir).at(-1), data = event.data ?? event;
    expect(data.requestContext).toMatchObject({ season: "12", sameFlow: true, sameEndpoint: true,
      recordComparison: {
        api: [{ equalToRequest: { season: false, unique_account_id: true } }, { equalToRequest: { season: true, unique_account_id: true } }],
        saves: [{ equalToRequest: { season: false } }, { equalToRequest: { season: true } }],
        apiSave: [[{ observedSlotEqual: true, sameFlow: true }, { observedSlotEqual: false, sameFlow: false }],
          [{ observedSlotEqual: true, sameFlow: true }, { observedSlotEqual: false, sameFlow: false }]],
        selectedNativeSlotEstablished: false, nativeMarketDigestObserved: false, authoritativeLoginBoundaryObserved: false,
      } });
    expect(JSON.stringify(results(userDataDir))).not.toMatch(/CANARY|424242|203\.0\.113|192\.0\.2|slot_data/);
    expect(JSON.stringify([result, await getRendererState(page)])).not.toMatch(/CANARY|424242|recordComparison|diagnosticRecords|requestContext/);
    // Stop still blocks search through the existing readiness policy.
    await page.evaluate(() => window.heroSiegeCompanion.stopCapture());
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(false);
  });
});

test("capture stop/resume does not carry old character records into the next explicit search", async () => {
  await withCompanionApp({ marketTransport: true }, async ({ electronApp, page, userDataDir }) => {
    await ready(electronApp, page, "api " + contextText + "&slot=4");
    await electronApp.evaluate((_electron, payload) => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [payload]), {
      ...flow, text: "save account_id=424242&beta=0&slot=8&slot_data=" + encodeURIComponent('{"season":12,"hardcore":0}'),
    });
    await page.evaluate(() => window.heroSiegeCompanion.stopCapture());
    await page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await electronApp.evaluate((_electron, payload) => globalThis.heroSiegeCompanionE2e.emitSessionContext([43], [payload]), {
      ...flow, text: "api " + contextText + "&slot=4",
    });
    await expect.poll(async () => (await getRendererState(page)).marketReadiness.canSearch).toBe(true);
    await response(electronApp, success);
    expect(await page.evaluate(input => window.heroSiegeCompanion.searchMarket(input), request)).toMatchObject({ ok: true, cached: false });
    const resumed = results(userDataDir).at(-1);
    expect((resumed.data ?? resumed).requestContext.recordComparison).toMatchObject({ api: [expect.anything()], saves: [] });
  });
});
