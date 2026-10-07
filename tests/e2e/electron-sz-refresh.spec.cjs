const { test, expect } = require("@playwright/test");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { withCompanionApp, getRendererState, emitCapturePayloads, createUserDataDir, cleanupUserDataDir } = require("./support/companion-app.cjs");
const PASSPHRASE = "CANARY portable cache passphrase";
async function enableCache(page) {
  await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneLoginCacheEnabled(true));
  await page.evaluate(passphrase => window.heroSiegeCompanion.unlockSatanicZoneLoginCache(passphrase), PASSPHRASE);
}
async function cacheSettings(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Features", exact: true }).click();
}

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

test("early private listener forwards initial and subsequent native SZ without completing an owned Refresh", async () => {
  await withCompanionApp(async ({ electronApp, page, userDataDir }) => {
    const invented = initialization(), login = invented.packets.at(-1);
    const zonePacket = (zone, seq) => {
      const body = Buffer.from(JSON.stringify({ satanicZoneName: zone, buffs: "", debuffs: "" }));
      const frame = Buffer.alloc(8 + body.length); frame.writeUInt32LE(body.length, 4); body.copy(frame, 8);
      return { ...login, seq, flags: 24, payloadLength: frame.length, payload: [...frame] };
    };
    const initial = zonePacket("Act_04_03", login.seq + login.payload.length);
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    await page.evaluate(() => window.heroSiegeCompanion.setCaptureDiagnosticsMode("deep", "manual"));
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(true));
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), [...invented.packets, initial]);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    await expect.poll(async () => (await getRendererState(page)).satanicZone.current?.rawZone).toBe("Act_04_03");
    expect((await getRendererState(page)).satanicZone.source).toBe("captured");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
    const card = page.locator("#satanic-zone-card");
    await card.getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
    const native = zonePacket("Act_01_01", initial.seq + initial.payload.length);
    await electronApp.evaluate((_electron, packet) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets([packet]), native);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.current?.rawZone).toBe("Act_01_01");
    expect((await getRendererState(page)).satanicZone).toMatchObject({ phase: "refreshing", source: "captured" });
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
    await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.completeSatanicZoneTestResponse(
      [...Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}')]));
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("current");
    expect((await getRendererState(page)).satanicZone.source).toBe("manual");
    expect((await getRendererState(page)).capturePreferences.capturePayloadLogging).toBe(false);
    const log = fs.readFileSync(path.join(userDataDir, "logs", "app-debug.log"), "utf8");
    expect(log).not.toMatch(/CANARY|1234567890|9876543210|account_uid|checksum/);
    const watchStages = log.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
      .filter(row => row.type === "sz-watch-stage").map(row => row.stage);
    expect(watchStages).toEqual(expect.arrayContaining(["listener_ready", "syn_selected", "owner_selected"]));
    expect(watchStages.indexOf("listener_ready")).toBeLessThan(watchStages.indexOf("syn_selected"));
    // Exercise main's production applyCaptureUpdate forwarding, not a direct provider call.
    await electronApp.evaluate((_electron, packet) => {
      const hooks = globalThis.heroSiegeCompanionE2e;
      hooks.emitCaptureUpdate({ running: true, status: "running" });
      hooks.emitCaptureUpdate({ observationGap: true });
      hooks.emitSatanicZoneTestPackets([packet]);
    }, invented.packets[4]);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).not.toBe("ready");
    expect((await getRendererState(page)).satanicZone.refreshAvailable).toBe(false);
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
  });
});

test("incomplete private traffic publishes Waiting to main/preload/UI, disables Refresh and restores Ready on completion", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    const invented = initialization(), post = invented.packets[4], card = page.locator("#satanic-zone-card");
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    const body = Buffer.from(post.payload).subarray(16), token = createHash("md5").update(body).update(Buffer.from([9])).digest("hex").slice(0, 12);
    const header = Buffer.alloc(16); header.write(token); header.writeUInt32LE(body.length, 12);
    const frame = Buffer.concat([header, body]), sequence = post.seq + post.payload.length;
    const tail = { ...post, seq: sequence + 17, payload: [...frame.subarray(17)], payloadLength: frame.length - 17 };
    await electronApp.evaluate((_electron, packet) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets([packet]), tail);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation).toEqual({ phase: "collecting", expiresAt: null, reason: "traffic_incomplete" });
    expect((await getRendererState(page)).satanicZone.refreshAvailable).toBe(false);
    await expect(card.locator(".zone-refresh-button")).toBeDisabled();
    await expect(card.locator(".zone-preparation")).toContainText("complete game update");
    await page.evaluate(() => window.heroSiegeCompanion.refreshSatanicZone());
    expect((await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("collecting");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
    await electronApp.evaluate((_electron, packet) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets([packet]),
      { ...post, seq: sequence, payload: [...frame.subarray(0, 17)], payloadLength: 17 });
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation).toEqual({ phase: "ready", expiresAt: null });
    expect((await getRendererState(page)).satanicZone.refreshAvailable).toBe(true);
    await expect(card.getByRole("button", { name: "Refresh Satanic Zone", exact: true })).toBeEnabled();
    await expect(card.locator(".zone-preparation")).toContainText("Ready to refresh");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
    await card.getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
  });
});

test("brief readiness transitions reach preload before coalescing and overlapping response fragments do not strand Refresh", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    const invented = initialization(), post = invented.packets[4], login = invented.packets[5];
    const emit = packets => electronApp.evaluate((_electron, values) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(values), packets);
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    await emit(invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    const body = Buffer.from(post.payload).subarray(16), api = counter => {
      const header = Buffer.alloc(16); header.write(createHash("md5").update(body).update(Buffer.from([counter])).digest("hex").slice(0, 12));
      header.writeUInt32LE(body.length, 12); return Buffer.concat([header, body]);
    };
    const first = api(9), second = api(10), sequence = post.seq + post.payload.length;
    const fragment = (packet, seq, bytes) => ({ ...packet, seq, payload: [...bytes], payloadLength: bytes.length });
    await page.evaluate(() => {
      window.__szPreparationPhases = [];
      window.heroSiegeCompanion.onStateUpdated(state => window.__szPreparationPhases.push(state.satanicZone.refreshPreparation.phase));
    });
    await emit([fragment(post, sequence, first.subarray(0, 17)), fragment(post, sequence + 17, first.subarray(17)),
      fragment(post, sequence + first.length, second.subarray(0, 17))]);
    await expect.poll(() => page.evaluate(() => window.__szPreparationPhases.slice(0, 3))).toEqual(["collecting", "ready", "collecting"]);
    await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitCaptureUpdate(
      { observationGap: true, observationGapSource: "gameplay-reconfigure" }));
    expect((await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("collecting");
    const responseBody = Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}');
    const response = Buffer.alloc(8 + responseBody.length); response.writeUInt32LE(responseBody.length, 4); responseBody.copy(response, 8);
    await emit([fragment(login, login.seq + login.payload.length, response.subarray(0, 17)),
      fragment(post, sequence + first.length + 17, second.subarray(17))]);
    const card = page.locator("#satanic-zone-card");
    await expect(card.getByRole("button", { name: "Refresh Satanic Zone", exact: true })).toBeEnabled();
    expect((await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
    await card.getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
  });
});

test("gameplay capture reconfiguration during sign-in reaches native Ready and saves without losing the independent API listener", async () => {
  await withCompanionApp(async ({ electronApp, page, userDataDir }) => {
    const invented = initialization();
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(true));
    await enableCache(page);
    await expect(page.locator("#satanic-zone-card .zone-preparation")).toContainText("No saved sign-in");
    await electronApp.evaluate((_electron, packets) => {
      const hooks = globalThis.heroSiegeCompanionE2e;
      hooks.emitSatanicZoneTestPackets(packets.slice(0, 4));
      hooks.emitCaptureUpdate({ running: true, status: "running" });
      hooks.emitCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" });
      hooks.emitCaptureUpdate({ status: "waiting" });
      hooks.emitSatanicZoneTestPackets(packets.slice(4));
      hooks.emitCaptureUpdate({ running: true, status: "running" });
    }, invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("saved");
    expect(fs.existsSync(path.join(userDataDir, "sz-login-cache.portable"))).toBe(true);
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
    const records = fs.readFileSync(path.join(userDataDir, "logs", "app-debug.log"), "utf8").trim().split("\n")
      .map(line => JSON.parse(line)).filter(row => row.type === "sz-refresh-readiness");
    expect(records.some(row => row.phase === "ready" && row.initializationComplete)).toBe(true);
    expect(records.some(row => row.cacheStatus === "saved")).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(/CANARY|1234567890|9876543210|192\.0\.2|198\.51\.100|checksum|account_uid/);
    await page.locator("#satanic-zone-card").getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
    await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.completeSatanicZoneTestResponse(
      [...Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}')]));
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("current");
    await page.evaluate(() => window.heroSiegeCompanion.stopCapture());
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation).toMatchObject({ phase: "ready", origin: "cached" });
  });
});

test("unknown identity gap suspends a pending native Refresh and private identity alone cannot resume it", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    const invented = initialization();
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(true));
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    await page.locator("#satanic-zone-card").getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
    await electronApp.evaluate((_electron, packet) => {
      const hooks = globalThis.heroSiegeCompanionE2e;
      hooks.emitCaptureUpdate({ observationGap: true });
      hooks.emitSatanicZoneTestPackets([packet]);
      hooks.completeSatanicZoneTestResponse([...Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}')]);
    }, invented.packets[4]);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).not.toBe("refreshing");
    const state = (await getRendererState(page)).satanicZone;
    expect(state.refreshPreparation.phase).not.toBe("ready"); expect(state.lastSuccessAt).toBeNull();
    expect(state.current).toBeNull();
    await page.evaluate(() => window.heroSiegeCompanion.refreshSatanicZone());
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
  });
});

test("normal Refresh gets ready automatically, keeps passive updates separate, returns owned zone and clears readiness on disable", async () => {
  await withCompanionApp(async ({ electronApp, page }) => {
    await page.evaluate(() => window.heroSiegeCompanion.setCaptureDiagnosticsMode("deep", "manual"));
    const invented = initialization();
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(true));
    const card = page.locator("#satanic-zone-card");
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("waiting_connection");
    await expect(card.locator(".zone-preparation")).toContainText("You can keep playing");
    expect((await getRendererState(page)).capturePreferences).toEqual({ captureDebugLogging: false,
      capturePayloadLogging: false, captureWideLogging: false, satanicZoneDebugLogging: false });
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    const ready = (await getRendererState(page)).satanicZone.refreshPreparation;
    expect(ready.expiresAt).toBeNull();
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
    await page.evaluate(() => window.heroSiegeCompanion.stopCapture());
    expect((await getRendererState(page)).satanicZone.refreshPreparation).toEqual({ phase: "suspended", expiresAt: null });
    expect((await getRendererState(page)).satanicZone.refreshAvailable).toBe(false);
    await expect(card.locator(".zone-preparation")).toContainText("capture interruption");
    await page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("waiting_connection");
    expect((await getRendererState(page)).satanicZone.refreshAvailable).toBe(false);
    // The same injected PID and tuple are insufficient. Only complete new native initialization restores Ready.
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(false));
    expect((await getRendererState(page)).satanicZone).toMatchObject({ refreshEnabled: false, refreshPreparation: { phase: "idle", expiresAt: null } });
    expect((await getRendererState(page)).capturePreferences.captureWideLogging).toBe(true);
    await expect(card.locator(".zone-refresh-button")).toHaveCount(0);
  });
});

test("default startup watches before the game; late sign-in and reconnect get ready without a Prepare action", async () => {
  await withCompanionApp({ gameRunning: false }, async ({ electronApp, page }) => {
    const card = page.locator("#satanic-zone-card");
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("waiting_connection");
    expect((await getRendererState(page)).satanicZone.refreshEnabled).toBe(true);
    await expect(card.getByRole("button", { name: /Refresh Satanic Zone unavailable/ })).toBeDisabled();
    const invented = initialization();
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    // A topology snapshot without the first SYN cannot reconstruct login.
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.reason).toBe("login_missed");
    await expect(card.locator(".zone-preparation")).toContainText("was not observed");
    await page.evaluate(() => window.heroSiegeCompanion.refreshSatanicZone());
    expect((await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("waiting_connection");
    const blockedAttemptAt = (await getRendererState(page)).satanicZone.lastAttemptAt;
    await page.evaluate(() => window.heroSiegeCompanion.startCapture());
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    expect((await getRendererState(page)).satanicZone.lastAttemptAt).toBe(blockedAttemptAt);
    // A second complete initialization is observed by the same open listener.
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
    expect((await getRendererState(page)).satanicZone.lastAttemptAt).toBe(blockedAttemptAt);
    await expect(card.getByRole("button", { name: "Refresh Satanic Zone", exact: true })).toBeEnabled();
    await expect(card.locator(".zone-preparation")).not.toContainText(/Prepare|API|two.minutes/);
  });
});

test("saved Off survives startup and no watcher can silently enable it", async () => {
  const userDataDir = createUserDataDir();
  try {
    fs.writeFileSync(path.join(userDataDir, "preferences.json"), JSON.stringify({ satanicZoneRefresh: { enabled: false } }));
    await withCompanionApp({ userDataDir }, async ({ page }) => {
      expect((await getRendererState(page)).satanicZone).toMatchObject({ refreshEnabled: false, refreshPreparation: { phase: "idle" } });
      await page.evaluate(() => window.heroSiegeCompanion.startCapture());
      expect((await getRendererState(page)).satanicZone).toMatchObject({ refreshEnabled: false, refreshPreparation: { phase: "idle" } });
      await expect(page.locator("#satanic-zone-card .zone-refresh-button")).toHaveCount(0);
    });
  } finally { cleanupUserDataDir(userDataDir); }
});

test("startup zone, native Ready, gameplay reconfigure, explicit Refresh and saved reopen use production main/preload wiring", async () => {
  const userDataDir = createUserDataDir(), invented = initialization(), file = path.join(userDataDir, "sz-login-cache.portable");
  const post = invented.packets[4], login = invented.packets[5];
  const ordinary = (counter, uid) => {
    const body = Buffer.from(Buffer.from(post.payload).subarray(16).toString().replace("12345678901234567890", uid));
    const token = createHash("md5").update(body).update(Buffer.from([counter])).digest("hex").slice(0, 12);
    const header = Buffer.alloc(16); header.write(token); header.writeUInt32LE(body.length, 12);
    return Buffer.concat([header, body]);
  };
  try {
    fs.writeFileSync(path.join(userDataDir, "preferences.json"), JSON.stringify({ satanicZonePortableCache: { version: 1, enabled: true } }));
    await withCompanionApp({ userDataDir, gameRunning: false }, async ({ electronApp, page }) => {
      await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("waiting_connection");
      await page.evaluate(passphrase => window.heroSiegeCompanion.unlockSatanicZoneLoginCache(passphrase), PASSPHRASE);
      await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
      const body = Buffer.from('{"satanicZoneName":"Act_02_03","buffs":"","debuffs":""}');
      const frame = Buffer.alloc(8 + body.length); frame.writeUInt32LE(body.length, 4); body.copy(frame, 8);
      await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets),
        [...invented.packets, { ...login, seq: login.seq + login.payload.length, payload: [...frame], payloadLength: frame.length }]);
      await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("saved");
      expect((await getRendererState(page)).satanicZone.current.rawZone).toBe("Act_02_03");
      await electronApp.evaluate(() => {
        const hooks = globalThis.heroSiegeCompanionE2e;
        hooks.emitCaptureUpdate({ running: true, status: "running" });
        hooks.emitCaptureUpdate({ observationGap: true, observationGapSource: "gameplay-reconfigure" });
      });
      expect((await getRendererState(page)).satanicZone.refreshPreparation.phase).toBe("ready");
      expect(fs.existsSync(file)).toBe(true);
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
      await page.locator("#satanic-zone-card").getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
      await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.completeSatanicZoneTestResponse(
        [...Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}')]));
      await expect.poll(async () => (await getRendererState(page)).satanicZone.source).toBe("manual");
      // Same PID/tuple; contrary UID arrives solely through the continuously observed private stream.
      const changed = ordinary(9, "77777777777777777777"), seq = post.seq + post.payload.length;
      await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), [
        { ...post, seq: seq + 17, payload: [...changed.subarray(17)], payloadLength: changed.length - 17 },
        { ...post, seq, payload: [...changed.subarray(0, 17)], payloadLength: 17 }]);
      await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.origin).toBe("cached");
      expect(fs.existsSync(file)).toBe(true);
      await page.evaluate(passphrase => window.heroSiegeCompanion.unlockSatanicZoneLoginCache(passphrase), PASSPHRASE);
      await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("saved");
      const log = fs.readFileSync(path.join(userDataDir, "logs", "app-debug.log"), "utf8");
      const cacheStages = log.trim().split("\n").map(line => JSON.parse(line)).filter(row => row.type === "sz-login-cache");
      expect(cacheStages).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "save_admission", result: "accepted" }),
        expect.objectContaining({ stage: "save_write", result: "saved" })]));
      expect(log).not.toMatch(/CANARY|1234567890|777777777|checksum|account_uid/);
    });
    expect(fs.existsSync(file)).toBe(true);
    await withCompanionApp({ userDataDir }, async ({ electronApp, page }) => {
      expect((await getRendererState(page)).satanicZoneLoginCache.status).toBe("locked");
      await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
      await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [{
        text: "unique_account_id=12345678901234567890&beta=0", direction: "outbound", localAddress: "192.0.2.10",
        localPort: 5000, remoteAddress: "198.51.100.20", remotePort: 6669 }]));
      // Exact owner ordering: identity arrives while Locked, then unlock. No extra packet.
      await page.evaluate(passphrase => window.heroSiegeCompanion.unlockSatanicZoneLoginCache(passphrase), PASSPHRASE);
      await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.origin).toBe("cached");
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
      const records = fs.readFileSync(path.join(userDataDir, "logs", "app-debug.log"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(records).toContainEqual(expect.objectContaining({ type: "sz-login-cache", stage: "unlock", result: "loaded" }));
      const ciphertext = fs.readFileSync(file);
      await page.evaluate(passphrase => window.heroSiegeCompanion.enableSatanicZoneLoginCacheAutomatic(passphrase), PASSPHRASE);
      expect((await getRendererState(page)).satanicZoneLoginCache).toMatchObject({ automatic: true, status: "loaded" });
      expect(fs.readFileSync(file)).toEqual(ciphertext);
    });
    await withCompanionApp({ userDataDir }, async ({ electronApp, page }) => {
      expect((await getRendererState(page)).satanicZoneLoginCache).toMatchObject({ enabled: true, automatic: true, unlocked: true, status: "loaded", accountLabel: "Saved standard account" });
      await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
      await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.emitSessionContext([42], [{
        text: "unique_account_id=12345678901234567890&beta=0", direction: "outbound", localAddress: "192.0.2.10",
        localPort: 5000, remoteAddress: "198.51.100.20", remotePort: 6669 }]));
      await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation.origin).toBe("cached");
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
    });
  } finally { cleanupUserDataDir(userDataDir); }
});

test("portable cache saves with production encryption, requires reopen unlock and sends only on explicit Refresh", async () => {
  const userDataDir = createUserDataDir(), file = path.join(userDataDir, "sz-login-cache.portable");
  const invented = initialization();
  try {
    await withCompanionApp({ userDataDir }, async ({ electronApp, page }) => {
      page.setDefaultTimeout(5_000);
      expect((await getRendererState(page)).satanicZoneLoginCache).toEqual({ enabled: false, unlocked: false, status: "disabled" });
      await cacheSettings(page);
      await page.getByRole("checkbox", { name: "Remember sign-in", exact: true }).check();
      expect((await getRendererState(page)).satanicZoneLoginCache.status).toBe("locked");
      expect(fs.existsSync(file)).toBe(false);
      await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
      await page.getByRole("button", { name: "Unlock for this session", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.unlocked).toBe(true);
      await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
      await page.getByRole("button", { name: "Close settings", exact: true }).click();
      await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
      await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("saved");
      expect((await getRendererState(page)).satanicZone.lastAttemptAt).toBeNull();
      expect(fs.readFileSync(file).toString()).not.toMatch(/CANARY|123456789/);
    });
    expect(fs.existsSync(file)).toBe(true);
    await withCompanionApp({ userDataDir }, async ({ electronApp, page }) => {
      const card = page.locator("#satanic-zone-card");
      expect((await getRendererState(page)).satanicZoneLoginCache).toEqual({ enabled: true, unlocked: false, status: "locked" });
      const ciphertext = fs.readFileSync(file);
      page.setDefaultTimeout(5_000);
      await cacheSettings(page);
      await page.getByLabel("Passphrase", { exact: true }).fill("CANARY wrong passphrase");
      await page.getByRole("button", { name: "Unlock for this session", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("unlock_failed");
      await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
      expect(fs.readFileSync(file)).toEqual(ciphertext);
      await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
      await page.getByRole("button", { name: "Unlock for this session", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("loaded");
      await expect(page.getByRole("button", { name: "Lock", exact: true })).toHaveCount(0);
      await page.evaluate(() => window.heroSiegeCompanion.lockSatanicZoneLoginCache());
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("locked");
      expect(fs.readFileSync(file)).toEqual(ciphertext);
      await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
      await page.getByRole("button", { name: "Unlock for this session", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("loaded");
      await page.getByRole("button", { name: "Close settings", exact: true }).click();
      expect((await getRendererState(page)).satanicZone.lastAttemptAt).toBeNull();
      await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation).toEqual({ phase: "ready", expiresAt: null, origin: "cached" });
      await expect(card.locator(".zone-preparation")).toContainText(/saved sign-in/i);
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
      await card.getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
      await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.completeSatanicZoneTestResponse(
        [...Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}')]));
      await expect.poll(async () => (await getRendererState(page)).satanicZone.source).toBe("manual");
      const projection = (await getRendererState(page)).satanicZoneLoginCache;
      expect(Object.keys(projection).sort()).toEqual(["accountLabel", "enabled", "status", "unlocked"]);
      const publicText = await page.evaluate(async () => JSON.stringify({ state: await window.heroSiegeCompanion.getState(), storage: { ...window.localStorage } }));
      expect(publicText).not.toContain(PASSPHRASE);
      expect(fs.readFileSync(path.join(userDataDir, "logs", "app-debug.log"), "utf8")).not.toMatch(/CANARY|1234567890|checksum|account_uid/);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Features", exact: true }).click();
      await expect(page.getByRole("checkbox", { name: "Remember sign-in", exact: true })).toBeChecked();
      await page.getByRole("button", { name: "Forget saved sign-in", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("disabled");
      expect(fs.existsSync(file)).toBe(false); expect((await getRendererState(page)).satanicZone.refreshAvailable).toBe(false);
      await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(false));
      expect((await getRendererState(page)).satanicZoneLoginCache.enabled).toBe(false);
    });
  } finally { cleanupUserDataDir(userDataDir); }
});

test("eight-character automatic consent saves and reopens through main/preload without background authentication", async () => {
  const userDataDir = createUserDataDir(), file = path.join(userDataDir, "sz-login-cache.portable"), keyFile = `${file}.key`;
  const invented = initialization();
  try {
    await withCompanionApp({ userDataDir, gameRunning: false }, async ({ electronApp, page }) => {
      await cacheSettings(page);
      await expect(page.getByLabel("Passphrase", { exact: true })).toHaveCount(0);
      await page.getByRole("checkbox", { name: "Remember sign-in", exact: true }).check();
      await page.getByLabel("Passphrase", { exact: true }).fill("CANARY08");
      const enable = page.getByRole("button", { name: "Enable automatic save/load", exact: true });
      await expect(enable).toBeDisabled(); expect(fs.existsSync(keyFile)).toBe(false);
      await page.getByRole("checkbox", { name: /I agree to keep the local unlocking key/ }).check();
      await enable.click();
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache).toEqual({ enabled: true, automatic: true, unlocked: true, status: "empty" });
      await expect(page.locator('.settings-login-cache-notice [role="status"]')).toHaveText("Waiting for a complete sign-in to save.");
      await expect(page.getByRole("button", { name: "Lock", exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Passphrase", { exact: true })).toHaveCount(0);
      expect(fs.existsSync(keyFile)).toBe(true); expect(fs.existsSync(file)).toBe(false);
      await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
      await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), invented.packets);
      await expect.poll(async () => (await getRendererState(page)).satanicZoneLoginCache.status).toBe("saved");
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
    });
    const ciphertext = fs.readFileSync(file);
    await withCompanionApp({ userDataDir, gameRunning: false }, async ({ electronApp, page }) => {
      expect((await getRendererState(page)).satanicZoneLoginCache).toMatchObject({ enabled: true, automatic: true, unlocked: true, status: "loaded", accountLabel: "Saved standard account" });
      expect((await getRendererState(page)).satanicZone.lastAttemptAt).toBeNull();
      await expect.poll(async () => (await getRendererState(page)).satanicZone.refreshPreparation).toEqual({ phase: "ready", expiresAt: null, origin: "cached" });
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(0);
      expect(fs.readFileSync(file)).toEqual(ciphertext);
      await page.evaluate(() => window.heroSiegeCompanion.stopCapture());
      expect((await getRendererState(page)).captureRunning).toBe(false);
      const card = page.locator("#satanic-zone-card");
      await card.getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
      await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
      expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
      await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.completeSatanicZoneTestResponse(
        [...Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}')]));
      await expect.poll(async () => (await getRendererState(page)).satanicZone).toMatchObject({ phase: "current", source: "manual", errorCode: null });
      expect((await getRendererState(page)).satanicZone.lastSuccessAt).toEqual(expect.any(Number));
      expect((await getRendererState(page)).satanicZone.current.rawZone).toBe("Act_04_03");
      await expect(card.locator(".zone-status")).toHaveAttribute("data-phase", "current");
      const publicText = await page.evaluate(async () => JSON.stringify({ state: await window.heroSiegeCompanion.getState(), storage: { ...window.localStorage } }));
      expect(publicText).not.toContain("CANARY08");
      const log = fs.readFileSync(path.join(userDataDir, "logs", "app-debug.log"), "utf8");
      expect(log).not.toMatch(/CANARY|1234567890|9876543210|account_uid|checksum/);
      expect(log.trim().split("\n").map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({
        type: "satanic-zone-refresh-completed", phase: "current", source: "manual", errorCode: null,
        observationPresent: true, ownedObservationDelivered: true, successAt: expect.any(Number) }));
      await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(false));
      expect(fs.existsSync(keyFile)).toBe(false); expect(fs.readFileSync(file)).toEqual(ciphertext);
    });
    await withCompanionApp({ userDataDir, gameRunning: false }, async ({ page }) => {
      expect((await getRendererState(page)).satanicZoneLoginCache).toEqual({ enabled: false, unlocked: false, status: "disabled" });
      expect(fs.readFileSync(file)).toEqual(ciphertext); expect(fs.existsSync(keyFile)).toBe(false);
    });
  } finally { cleanupUserDataDir(userDataDir); }
});

test("legacy encrypted file and consent remain untouched; portable cache needs separate opt-in and unlock", async () => {
  const userDataDir = createUserDataDir(), legacy = path.join(userDataDir, "sz-login-cache.encrypted");
  const original = Buffer.from("CANARY untouched legacy encrypted file");
  try {
    fs.writeFileSync(legacy, original);
    fs.writeFileSync(path.join(userDataDir, "preferences.json"), JSON.stringify({ satanicZoneLoginCache: { enabled: true } }));
    await withCompanionApp({ userDataDir, gameRunning: false }, async ({ page }) => {
      expect((await getRendererState(page)).satanicZoneLoginCache).toEqual({ enabled: false, unlocked: false, status: "disabled" });
      await enableCache(page);
      expect((await getRendererState(page)).satanicZoneLoginCache.status).toBe("empty");
      await page.evaluate(() => window.heroSiegeCompanion.clearSatanicZoneLoginCache());
      expect((await getRendererState(page)).satanicZoneLoginCache).toEqual({ enabled: false, unlocked: false, status: "disabled" });
      expect(fs.readFileSync(legacy)).toEqual(original);
      const preferences = JSON.parse(fs.readFileSync(path.join(userDataDir, "preferences.json"), "utf8"));
      expect(preferences.satanicZoneLoginCache).toEqual({ enabled: true });
      expect(preferences.satanicZonePortableCache).toEqual({ version: 2, enabled: false, automatic: false });
    });
    expect(fs.readFileSync(legacy)).toEqual(original);
  } finally { cleanupUserDataDir(userDataDir); }
});

test("generic owned response logs delivery while retaining a specific captured zone", async () => {
  await withCompanionApp(async ({ electronApp, page, userDataDir }) => {
    const invented = initialization(), login = invented.packets.at(-1);
    const specificBody = Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}');
    const specific = Buffer.alloc(8 + specificBody.length); specific.writeUInt32LE(specificBody.length, 4); specificBody.copy(specific, 8);
    await electronApp.evaluate((_electron, network) => globalThis.heroSiegeCompanionE2e.setSatanicZoneTestNetwork(network), invented.network);
    await electronApp.evaluate((_electron, packets) => globalThis.heroSiegeCompanionE2e.emitSatanicZoneTestPackets(packets), [
      ...invented.packets, { ...login, seq: login.seq + login.payload.length, payload: [...specific], payloadLength: specific.length }]);
    await expect.poll(async () => (await getRendererState(page)).satanicZone.current?.rawZone).toBe("Act_04_03");
    const passiveAt = (await getRendererState(page)).satanicZone.lastSuccessAt;
    expect((await getRendererState(page)).satanicZone.source).toBe("captured");
    const card = page.locator("#satanic-zone-card");
    await card.getByRole("button", { name: "Refresh Satanic Zone", exact: true }).click();
    await expect.poll(async () => (await getRendererState(page)).satanicZone.phase).toBe("refreshing");
    await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.completeSatanicZoneTestResponse(
      [...Buffer.from('{"satanicZoneName":"Unknown","buffs":"","debuffs":""}')]));
    await expect.poll(async () => (await getRendererState(page)).satanicZone).toMatchObject({ phase: "current", source: "captured", errorCode: null,
      current: { rawZone: "Act_04_03" } });
    const successAt = (await getRendererState(page)).satanicZone.lastSuccessAt;
    expect(successAt).toBeGreaterThan(passiveAt);
    await expect(card.locator(".zone-status")).toHaveAttribute("data-phase", "current");
    expect(await electronApp.evaluate(() => globalThis.heroSiegeCompanionE2e.getSatanicZoneTestAttemptCount())).toBe(1);
    const log = fs.readFileSync(path.join(userDataDir, "logs", "app-debug.log"), "utf8");
    expect(log.trim().split("\n").map(line => JSON.parse(line)).filter(row => row.type === "satanic-zone-refresh-completed")).toContainEqual(expect.objectContaining({
      type: "satanic-zone-refresh-completed", phase: "current", source: "captured", errorCode: null,
      observationPresent: true, ownedObservationDelivered: true, successAt }));
    expect(log).not.toMatch(/CANARY|1234567890|9876543210|account_uid|checksum/);
  });
});
