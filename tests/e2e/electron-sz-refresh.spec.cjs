const { test, expect } = require("@playwright/test");
const { createHash } = require("node:crypto");
const { withCompanionApp, getRendererState, emitCapturePayloads } = require("./support/companion-app.cjs");

// Invented CANARY login; no captured account, native process or socket is used.
function initialization() {
  const scope = { localAddress: "192.0.2.10", remoteAddress: "198.51.100.20", remotePort: 6669 };
  const uid = "12345678901234567890";
  const connect = Buffer.from('\0\0\x01' + JSON.stringify({ account: "CANARY_ACCOUNT", account_uid: uid,
    checksum: "CANARY_CHECKSUM" }) + '\0' + "0123456789abcdef0123456789abcdef" + '\0');
  const post = Buffer.concat([Buffer.from([3, 0, 1, 0]), Buffer.from("post_login_crossregion\0"), Buffer.from([83, 0]),
    Buffer.from(`account_id=CANARY_ACCOUNT&unique_account_id=${uid}&platform=0&checksum=${"a".repeat(64)}&guild_id=0&pact_ids=W10=&beta=0\0`)]);
  const api = (body, counter) => {
    const header = Buffer.alloc(16); header.write(createHash("md5").update(body).update(Buffer.from([counter])).digest("hex").slice(0, 12));
    header.writeUInt32LE(body.length, 12); return Buffer.concat([header, body]);
  };
  const generic = body => { const header = Buffer.alloc(8); header.writeUInt32LE(body.length, 4); return Buffer.concat([header, body]); };
  const c = api(connect, 7), ack = generic(Buffer.from([0, 16]));
  const login = generic(Buffer.from('\x53\0{"status":1,"globalIdentifier":"9876543210"}\0'));
  const packet = (outbound, seq, payload = Buffer.alloc(0), flags = 16) => ({ src: outbound ? scope.localAddress : scope.remoteAddress,
    dst: outbound ? scope.remoteAddress : scope.localAddress, srcPort: outbound ? 5000 : scope.remotePort,
    dstPort: outbound ? scope.remotePort : 5000, seq, ack: outbound ? 201 : 101, flags,
    payload: [...payload], payloadLength: payload.length, text: "" });
  const network = { gameProcessIds: [42], antiCheatProcessIds: [], connections: [{ ...scope, localPort: 5000, owningProcess: 42, state: "established" }] };
  const packets = [packet(true, 100, undefined, 2), packet(false, 200, undefined, 18), packet(true, 101, c),
    packet(false, 201, ack), packet(true, 101 + c.length, api(post, 8)), packet(false, 201 + ack.length, login)];
  return { network, packets };
}

test("normal Refresh prepares privately, keeps passive updates separate, returns owned zone and clears readiness on disable", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await page.evaluate(() => window.heroSiegeCompanion.setCaptureDiagnosticsMode("deep", "manual"));
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(true));
    const invented = initialization();
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    const card = page.locator("#satanic-zone-card");
    await card.getByRole("button", { name: "Prepare Satanic Zone refresh", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("waiting_connection");
    await expect(card.locator(".zone-preparation")).toContainText("Reconnect or restart Hero Siege now");
    expect((await getRendererState(page)).capturePreferences).toEqual({ captureDebugLogging: false,
      capturePayloadLogging: false, captureWideLogging: false, satanicZoneDebugLogging: false });
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    const ready = (await getRendererState(page)).satanicZone.refreshPreparation;
    expect(Object.keys(ready).sort()).toEqual(["expiresAt", "phase"]);
    expect(JSON.stringify(ready)).not.toMatch(/CANARY|1234567890|9876543210/);
    await card.getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
    await emitCapturePayloads(electronApp, [JSON.stringify({ satanicZoneName: "Act_01_01", buffs: "", debuffs: "" })]);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.current?.rawZone).toBe("Act_01_01");
    expect((await getRendererState(page)).satanicZone).toMatchObject({ phase: "refreshing", source: "captured" });
    await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.completeSatanicZoneTestResponse(
      [...Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}')]));
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("current");
    expect((await getRendererState(page)).satanicZone).toMatchObject({ source: "manual", current: { rawZone: "Act_04_03" },
      refreshPreparation: { phase: "ready", expiresAt: ready.expiresAt } });
    await expect(card.locator(".zone-status")).toContainText("Received through manual refresh.");
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(false));
    expect((await getRendererState(page)).satanicZone).toMatchObject({ refreshEnabled: false, refreshPreparation: { phase: "idle", expiresAt: null } });
    expect((await getRendererState(page)).capturePreferences.captureWideLogging).toBe(true);
    await expect(card.locator(".zone-refresh-button")).toHaveCount(0);
  });
});
