import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
import { inventedConnect, inventedPostLogin, inventedProbeScope as scope, inventedProbeIdentity as identity } from "../fixtures/satanic-zone-initialized";
import { loadSatanicZoneLoginCacheEnabled, loadSatanicZoneLoginCacheAutomatic, saveSatanicZoneLoginCacheEnabled } from "../../src/main/persistence";

// Synthetic material only. Production encryption and filesystem are exercised.
const passphrase = "SYNTHETIC portable cache passphrase";
let directory: string;
const caches: SatanicZoneLoginCache[] = [], stores: SatanicZoneLoginCacheStore[] = [];
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-login-cache-")); });
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
  for (const store of stores.splice(0)) store.lock();
  vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true });
});
function fixture(file = path.join(directory, "login.portable")) {
  const budget = new SatanicZoneDiagnosticBufferBudget(), store = new SatanicZoneLoginCacheStore(file);
  stores.push(store);
  const snapshots: unknown[] = [], diagnostics: { stage: string; result: string }[] = [];
  const network = { gameProcessIds: [42], antiCheatProcessIds: [], connections: [{ ...scope, localPort: 5000, owningProcess: 42, state: "established" }] };
  const networkState = vi.fn(async () => network);
  const cache = new SatanicZoneLoginCache({ store, networkState, onChange: state => snapshots.push(state),
    onDiagnostic: (stage, result) => diagnostics.push({ stage, result }) });
  caches.push(cache); cache.attachBudget(budget);
  const input = { connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), identity, scope, nativePort: 5000 };
  const payload = { text: `unique_account_id=${identity.uniqueAccountId}&beta=0`, direction: "outbound" as const,
    ...scope, localPort: 5000 };
  return { file, budget, store, cache, snapshots, diagnostics, network, networkState, input, payload };
}
async function savedFixture() {
  const f = fixture(); f.cache.configure(true); expect(await f.cache.unlock(passphrase)).toBe(true);
  await f.cache.remember(f.input, 42); expect(f.cache.snapshot().status).toBe("saved"); return f;
}
// Independent decoding pins file format/minimum data, not a production helper.
function openPortable(bytes: Buffer) {
  const key = scryptSync(passphrase, bytes.subarray(8, 24), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(24, 36));
    cipher.setAAD(Buffer.from("HSCSZ001")); cipher.setAuthTag(bytes.subarray(36, 52));
    return Buffer.concat([cipher.update(bytes.subarray(52)), cipher.final()]);
  } finally { key.fill(0); }
}
function malformedAuthenticatedFile(connect = inventedConnect(), post = inventedPostLogin(), lengthDelta = 0) {
  const magic = Buffer.from("HSCSZ001"), salt = Buffer.alloc(16, 17), iv = Buffer.alloc(12, 19);
  const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const plain = Buffer.concat([Buffer.alloc(8), connect, post]);
  plain.writeUInt32LE(connect.length + lengthDelta, 0); plain.writeUInt32LE(post.length, 4);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(magic);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([magic, salt, iv, cipher.getAuthTag(), encrypted]);
  } finally { key.fill(0); plain.fill(0); }
}

describe("portable login cache with production encryption and synthetic secrets", () => {
  test("identity received while Locked binds after unlock without requiring another packet", async () => {
    const original = await savedFixture(); original.cache.dispose();
    const reopened = fixture(); reopened.cache.configure(true);
    await reopened.cache.observe(reopened.payload);
    expect(reopened.cache.restoreInput()).toBeNull();
    expect(await reopened.cache.unlock(passphrase)).toBe(true);
    expect(reopened.cache.snapshot().status).toBe("validated");
    expect(reopened.cache.restoreInput()?.connectBody).toEqual(inventedConnect());
  });
  test("eight characters can set a new portable passphrase", async () => {
    const f = fixture(); f.cache.configure(true);
    expect(await f.cache.unlock("SYNTHET8")).toBe(true);
    await f.cache.remember(f.input, 42);
    expect(f.cache.snapshot().status).toBe("saved");
  });
  test("opt-in stays locked; passive identity and remember cannot create a file until explicit unlock", async () => {
    const f = fixture(); f.cache.configure(true);
    expect(f.cache.snapshot()).toEqual({ enabled: true, unlocked: false, status: "locked" });
    await f.cache.remember(f.input, 42); await f.cache.observe(f.payload);
    expect(fs.existsSync(f.file)).toBe(false); expect(f.cache.restoreInput()).toBeNull(); expect(f.budget.usedBytes).toBeLessThan(2048);
    expect(await f.cache.unlock(passphrase)).toBe(true);
    expect(f.cache.snapshot()).toEqual({ enabled: true, unlocked: true, status: "empty" });
    expect(fs.existsSync(f.file)).toBe(false); expect(f.store.isUnlocked()).toBe(true);
  });
  test("atomic save, dispose, reopen and unlock preserve the byte-exact pair and require fresh identity", async () => {
    const f = await savedFixture(), encrypted = fs.readFileSync(f.file);
    expect(encrypted.subarray(0, 8).toString()).toBe("HSCSZ001");
    expect(encrypted.includes(f.input.connectBody)).toBe(false); expect(encrypted.includes(f.input.postLoginBody)).toBe(false);
    expect(encrypted.toString()).not.toMatch(/CANARY|account_uid|123456789|SYNTHETIC/);
    expect(fs.readdirSync(directory)).toEqual(["login.portable"]); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
    const plain = openPortable(encrypted);
    expect(plain.readUInt32LE(0)).toBe(f.input.connectBody.length); expect(plain.readUInt32LE(4)).toBe(f.input.postLoginBody.length);
    expect(plain).toEqual(Buffer.concat([plain.subarray(0, 8), f.input.connectBody, f.input.postLoginBody]));
    plain.fill(0); f.cache.dispose(); expect(f.budget.usedBytes).toBe(0);
    const reopened = fixture(); reopened.cache.configure(true); expect(reopened.cache.snapshot().status).toBe("locked");
    expect(await reopened.cache.unlock(passphrase)).toBe(true);
    expect(reopened.cache.snapshot().status).toBe("unverified"); expect(reopened.cache.restoreInput()).toBeNull();
    await reopened.cache.observe(reopened.payload); const restored = reopened.cache.restoreInput()!;
    expect(restored.connectBody).toEqual(inventedConnect()); expect(restored.postLoginBody).toEqual(inventedPostLogin());
    expect(restored).toMatchObject({ pid: 42, nativePort: 5000 });
    expect(await reopened.cache.preflight({ ...scope, pid: 42, localPort: 5000 })).toBe(true);
    expect(JSON.stringify([...f.snapshots, ...f.diagnostics, ...reopened.snapshots])).not.toMatch(/CANARY|account_uid|123456789|SYNTHETIC/);
  });
  test("a copied portable file unlocks in a separate directory without an adjacent key or machine service", async () => {
    const original = await savedFixture(), moved = path.join(directory, "moved", "login.portable");
    original.cache.dispose(); fs.mkdirSync(path.dirname(moved)); fs.copyFileSync(original.file, moved);
    const reopened = fixture(moved); reopened.cache.configure(true); expect(await reopened.cache.unlock(passphrase)).toBe(true);
    await reopened.cache.observe(reopened.payload); expect(reopened.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
    expect(fs.readdirSync(path.dirname(moved))).toEqual(["login.portable"]);
  });
  test.each(["wrong passphrase", "tampered ciphertext", "tampered tag", "truncated", "oversized", "wrong version", "incoherent pair", "invalid lengths"])(
    "%s fails locked and preserves the file for explicit recovery", async kind => {
    const f = await savedFixture(); f.cache.dispose(); let bytes = fs.readFileSync(f.file);
    if (kind === "tampered ciphertext") bytes[bytes.length - 1] ^= 1;
    if (kind === "tampered tag") bytes[36] ^= 1;
    if (kind === "truncated") bytes = bytes.subarray(0, 55);
    if (kind === "oversized") bytes = Buffer.alloc(52 + 8 + 2 * 16_384 + 1);
    if (kind === "wrong version") bytes.write("HSCSZ002", 0);
    if (kind === "incoherent pair") bytes = malformedAuthenticatedFile(inventedConnect(), inventedPostLogin("444444"));
    if (kind === "invalid lengths") bytes = malformedAuthenticatedFile(undefined, undefined, 1);
    fs.writeFileSync(f.file, bytes); const reopened = fixture(); reopened.cache.configure(true);
    expect(await reopened.cache.unlock(kind === "wrong passphrase" ? "OTHER synthetic passphrase" : passphrase)).toBe(false);
    expect(reopened.cache.snapshot()).toEqual({ enabled: true, unlocked: false, status: "unlock_failed" });
    expect(reopened.cache.restoreInput()).toBeNull(); expect(reopened.budget.usedBytes).toBe(0);
    expect(fs.readFileSync(f.file)).toEqual(bytes); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
  });
  test.each(["short", "é".repeat(513)])("invalid passphrase cannot create a file or key", async value => {
    const f = fixture(); f.cache.configure(true); expect(await f.cache.unlock(value)).toBe(false);
    expect(f.cache.snapshot().status).toBe("unlock_failed"); expect(f.budget.usedBytes).toBe(0); expect(fs.existsSync(f.file)).toBe(false);
  });
  test("wrong passphrase does not prevent a later correct unlock", async () => {
    const f = await savedFixture(); f.cache.lock(); expect(await f.cache.unlock("OTHER synthetic passphrase")).toBe(false);
    expect(await f.cache.unlock(passphrase)).toBe(true); await f.cache.observe(f.payload);
    expect(f.cache.restoreInput()?.connectBody).toEqual(inventedConnect());
  });
  test.each(["lock", "disable", "dispose", "forget"] as const)("%s cancels a pending real KDF without resurrecting secrets", async action => {
    const f = fixture(); f.cache.configure(true); const pending = f.cache.unlock(passphrase);
    expect(f.cache.snapshot().status).toBe("unlocking");
    if (action === "lock") f.cache.lock(); else if (action === "disable") f.cache.configure(false);
    else if (action === "dispose") f.cache.dispose(); else f.cache.clear();
    expect(await pending).toBe(false); expect(f.store.isUnlocked()).toBe(false);
    expect(f.budget.usedBytes).toBe(0); expect(f.cache.restoreInput()).toBeNull(); expect(fs.existsSync(f.file)).toBe(false);
    if (action !== "dispose") expect(f.cache.snapshot().status).toBe(action === "disable" ? "disabled" : "locked");
  });
  test("concurrent unlock cannot replace a pending passphrase; lock and retry cannot adopt the older key", async () => {
    const f = fixture(); f.cache.configure(true); const first = f.cache.unlock(passphrase);
    expect(await f.cache.unlock("OTHER synthetic passphrase")).toBe(false); f.cache.lock();
    const retry = f.cache.unlock("OTHER synthetic passphrase"); expect(await retry).toBe(false); expect(await first).toBe(false);
    expect(f.store.isUnlocked()).toBe(false); expect(f.budget.usedBytes).toBe(0); expect(await f.cache.unlock(passphrase)).toBe(true);
  });
  test.each(["lock", "disable and reenable"])("%s cannot reenter unlock while an older store operation is pending", async action => {
    const f = fixture(); f.cache.configure(true); let release!: (bodies: null) => void;
    const unlock = vi.spyOn(f.store, "unlock").mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const older = f.cache.unlock(passphrase);
    if (action === "lock") f.cache.lock(); else { f.cache.configure(false); f.cache.configure(true); }
    expect(f.cache.snapshot().status).toBe("locked");
    expect(await f.cache.unlock("OTHER synthetic passphrase")).toBe(false); expect(unlock).toHaveBeenCalledTimes(1);
    release(null); expect(await older).toBe(false); expect(f.store.isUnlocked()).toBe(false); expect(f.budget.usedBytes).toBe(0);
    expect(await f.cache.unlock(passphrase)).toBe(true); expect(unlock).toHaveBeenCalledTimes(2);
    await f.cache.remember(f.input, 42); expect(f.cache.snapshot().status).toBe("saved");
  });
  test.each(["lock", "disable and reenable"])("%s cannot reenter between store fulfillment and cache continuation", async action => {
    const f = fixture(); f.cache.configure(true); let release!: (bodies: null) => void;
    const unlock = vi.spyOn(f.store, "unlock").mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const older = f.cache.unlock(passphrase);
    release(null);
    // Keep this synchronous: the store has fulfilled, but cache.unlock has not resumed.
    if (action === "lock") f.cache.lock(); else { f.cache.configure(false); f.cache.configure(true); }
    const retry = f.cache.unlock("OTHER synthetic passphrase");
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(await retry).toBe(false); expect(await older).toBe(false);
    expect(f.store.isUnlocked()).toBe(false); expect(f.budget.usedBytes).toBe(0);
    expect(await f.cache.unlock(passphrase)).toBe(true); expect(unlock).toHaveBeenCalledTimes(2);
  });
  test.each(["unique_account_id=888888&beta=0", `unique_account_id=${identity.uniqueAccountId}&beta=1`, `unique_account_id=${identity.uniqueAccountId}&beta=0&account_id=other-123`])(
    "contrary current account/mode forgets the pair: %s", async text => {
    const f = await savedFixture(); await f.cache.observe({ ...f.payload, text });
    expect(f.cache.snapshot().status).toBe("identity_mismatch"); expect(f.cache.restoreInput()).toBeNull();
    expect(fs.existsSync(f.file)).toBe(false); expect(f.budget.usedBytes).toBe(0); expect(f.store.isUnlocked()).toBe(false);
  });
  test("partial, inbound, unattributed or another socket identity cannot validate the pair", async () => {
    const f = await savedFixture();
    for (const payload of [{ ...f.payload, text: `unique_account_id=${identity.uniqueAccountId}` },
      { ...f.payload, direction: "inbound" as const }, { ...f.payload, localPort: undefined }, { ...f.payload, localPort: 6000 }]) await f.cache.observe(payload);
    expect(f.cache.restoreInput()).toBeNull(); expect(f.cache.snapshot().status).toBe("saved");
  });
  test.each(["not game owned", "not established", "ambiguous"])("matching account/mode rejects a %s tuple", async kind => {
    const f = await savedFixture();
    if (kind === "not game owned") f.network.gameProcessIds = [43];
    if (kind === "not established") f.network.connections[0].state = "close_wait";
    if (kind === "ambiguous") f.network.connections.push({ ...f.network.connections[0] });
    await f.cache.observe(f.payload); expect(f.cache.restoreInput()).toBeNull();
  });
  test.each(["suspend", "lock", "disable", "forget", "dispose"] as const)("%s during delayed OS validation cannot restore continuity", async action => {
    const f = await savedFixture(); let release!: (state: typeof f.network) => void;
    f.networkState.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const validation = f.cache.observe(f.payload);
    if (action === "suspend") f.cache.suspend(); else if (action === "lock") f.cache.lock();
    else if (action === "disable") f.cache.configure(false); else if (action === "forget") f.cache.clear(); else f.cache.dispose();
    release(f.network); await validation; expect(f.cache.restoreInput()).toBeNull();
    if (action === "suspend") { await f.cache.observe(f.payload); expect(f.cache.restoreInput()).not.toBeNull(); }
    else expect(f.budget.usedBytes).toBe(0);
  });
  test("process/flow loss, FIN and unknown gaps each require new fresh evidence", async () => {
    const f = await savedFixture();
    const invalidations = [() => f.cache.observeProcesses([]), () => f.cache.observeConnections([{ ...f.network.connections[0], localPort: 5001 }]),
      () => f.cache.observeLifecycle({ src: scope.localAddress, dst: scope.remoteAddress, srcPort: 5000, dstPort: scope.remotePort, flags: 1 }),
      () => f.cache.suspend()];
    for (const invalidate of invalidations) {
      await f.cache.observe(f.payload); expect(f.cache.restoreInput()).not.toBeNull(); invalidate();
      expect(f.cache.restoreInput()).toBeNull(); expect(await f.cache.preflight({ ...scope, pid: 42, localPort: 5000 })).toBe(false);
      expect(fs.existsSync(f.file)).toBe(true);
    }
  });
  test("a delayed preflight cannot authorize dispatch after a gap or changed ownership", async () => {
    const f = await savedFixture(); await f.cache.observe(f.payload); let release!: (state: typeof f.network) => void;
    f.networkState.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.cache.preflight({ ...scope, pid: 42, localPort: 5000 }); f.cache.suspend(); release(f.network);
    expect(await pending).toBe(false); await f.cache.observe(f.payload); f.network.connections[0].owningProcess = 43;
    expect(await f.cache.preflight({ ...scope, pid: 42, localPort: 5000 })).toBe(false); expect(f.cache.restoreInput()).toBeNull();
  });
  test.each(["open", "write", "fsync", "rename"] as const)("%s failure preserves previous ciphertext and removes owned temporary bytes", async stage => {
    const f = await savedFixture(), previous = fs.readFileSync(f.file);
    const error = () => { throw Object.assign(new Error("PRIVATE_FILE_PATH"), { code: "EACCES" }); };
    if (stage === "open") { const open = fs.openSync; vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (String(file) === `${f.file}.tmp`) return error(); return open(file, flags, mode);
    }); } else if (stage === "write") vi.spyOn(fs, "writeFileSync").mockImplementationOnce(error);
    else if (stage === "fsync") vi.spyOn(fs, "fsyncSync").mockImplementationOnce(error);
    else vi.spyOn(fs, "renameSync").mockImplementationOnce(error);
    await f.cache.remember(f.input, 42); expect(f.cache.snapshot().status).toBe("storage_error");
    expect(fs.readFileSync(f.file)).toEqual(previous); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
    expect(JSON.stringify([...f.snapshots, ...f.diagnostics])).not.toContain("PRIVATE_FILE_PATH");
  });
  test("lock during filesystem finalization cancels replacement and removes the temporary file", async () => {
    const f = await savedFixture(), previous = fs.readFileSync(f.file), fsync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(fd => { fsync(fd); f.store.lock(); });
    expect(() => f.store.save(f.input, f.budget)).toThrow("storage_error");
    expect(fs.readFileSync(f.file)).toEqual(previous); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false); expect(f.store.isUnlocked()).toBe(false);
  });
  test("unowned existing temporary file is preserved and blocks replacement", async () => {
    const f = await savedFixture(), previous = fs.readFileSync(f.file), unrelated = Buffer.from("unrelated synthetic artifact");
    fs.writeFileSync(`${f.file}.tmp`, unrelated); await f.cache.remember(f.input, 42);
    expect(f.cache.snapshot().status).toBe("storage_error"); expect(fs.readFileSync(f.file)).toEqual(previous);
    expect(fs.readFileSync(`${f.file}.tmp`)).toEqual(unrelated);
  });
  test("read permission failure reports a safe error and leaves the file intact", async () => {
    const f = await savedFixture(), previous = fs.readFileSync(f.file); f.cache.lock(); const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (String(file) === f.file && flags === "r") throw Object.assign(new Error("PRIVATE_FILE_PATH"), { code: "EACCES" }); return open(file, flags, mode);
    });
    expect(await f.cache.unlock(passphrase)).toBe(false); expect(f.cache.snapshot().status).toBe("storage_error");
    vi.restoreAllMocks(); expect(fs.readFileSync(f.file)).toEqual(previous); expect(f.budget.usedBytes).toBe(0);
    expect(JSON.stringify([...f.snapshots, ...f.diagnostics])).not.toContain("PRIVATE_FILE_PATH");
  });
  test("disable locks and zeros RAM but retains the file; explicit Forget deletes file and temporary data", async () => {
    const f = await savedFixture(); await f.cache.observe(f.payload); const secret = f.cache.restoreInput()!.connectBody;
    f.cache.configure(false); expect(secret.every(byte => byte === 0)).toBe(true); expect(f.budget.usedBytes).toBe(0);
    expect(f.cache.snapshot()).toEqual({ enabled: false, unlocked: false, status: "disabled" }); expect(fs.existsSync(f.file)).toBe(true);
    f.cache.configure(true); expect(await f.cache.unlock(passphrase)).toBe(true); fs.writeFileSync(`${f.file}.tmp`, "synthetic stale temporary");
    f.cache.configure(false); f.cache.clear(); expect(fs.existsSync(f.file)).toBe(false); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
    expect(f.cache.snapshot()).toEqual({ enabled: false, unlocked: false, status: "disabled" }); expect(f.budget.usedBytes).toBe(0);
  });
  test("identity invalidation cannot hide a failed deletion or restore cached use", async () => {
    const f = await savedFixture(); vi.spyOn(fs, "unlinkSync").mockImplementation(() => { throw Object.assign(new Error("PRIVATE_FILE_PATH"), { code: "EACCES" }); });
    await f.cache.observe({ ...f.payload, text: "unique_account_id=888888&beta=0" });
    expect(f.cache.snapshot().status).toBe("clear_failed"); expect(f.cache.restoreInput()).toBeNull();
    expect(fs.existsSync(f.file)).toBe(true); expect(f.budget.usedBytes).toBe(0); expect(f.store.isUnlocked()).toBe(false);
  });
  test("bounded buffer denial leaves neither a usable key nor a file", async () => {
    const f = fixture(); f.cache.attachBudget(new SatanicZoneDiagnosticBufferBudget(1)); f.cache.configure(true);
    expect(await f.cache.unlock(passphrase)).toBe(false); expect(f.store.isUnlocked()).toBe(false); expect(fs.existsSync(f.file)).toBe(false);
  });
  test("only portable consent persists; legacy encrypted-cache consent, malformed values and Off stay off", () => {
    const file = path.join(directory, "preferences.json"); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    fs.writeFileSync(file, '{"satanicZoneLoginCache":{"enabled":true}}'); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    expect(saveSatanicZoneLoginCacheEnabled(file, true)).toBe(true); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).satanicZonePortableCache).toEqual({ version: 2, enabled: true, automatic: false });
    expect(loadSatanicZoneLoginCacheAutomatic(file)).toBe(false);
    saveSatanicZoneLoginCacheEnabled(file, false); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    fs.writeFileSync(file, '{"satanicZonePortableCache":{"version":1,"enabled":"true"}}'); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    fs.writeFileSync(file, '{"satanicZonePortableCache":{"version":3,"enabled":true}}'); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    fs.writeFileSync(file, "garbage"); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
  });
  test("legacy portable consent never implies automatic consent; explicit v2 choice survives reopening", () => {
    const file = path.join(directory, "preferences.json");
    fs.writeFileSync(file, '{"unrelated":42,"satanicZonePortableCache":{"version":1,"enabled":true,"automatic":true}}');
    expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(true); expect(loadSatanicZoneLoginCacheAutomatic(file)).toBe(false);
    saveSatanicZoneLoginCacheEnabled(file, true, true);
    expect(loadSatanicZoneLoginCacheAutomatic(file)).toBe(true); expect(JSON.parse(fs.readFileSync(file, "utf8")).unrelated).toBe(42);
    saveSatanicZoneLoginCacheEnabled(file, false, true); expect(loadSatanicZoneLoginCacheAutomatic(file)).toBe(false);
  });
  test("explicit automatic migration preserves existing ciphertext and reopens without the passphrase", async () => {
    const old = await savedFixture(), encrypted = fs.readFileSync(old.file); old.cache.dispose();
    const migrated = fixture(); migrated.cache.configure(true);
    expect(fs.existsSync(`${old.file}.key`)).toBe(false);
    await migrated.cache.observe(migrated.payload);
    expect(await migrated.cache.enableAutomatic(passphrase)).toBe(true);
    expect(migrated.cache.snapshot()).toMatchObject({ automatic: true, status: "validated" });
    expect(fs.readFileSync(old.file)).toEqual(encrypted);
    const retained = fs.readFileSync(`${old.file}.key`);
    expect(retained.length).toBe(56); expect(retained.subarray(0, 8).toString()).toBe("HSCSZK01");
    expect(retained.toString()).not.toContain(passphrase);
    migrated.cache.dispose(); expect(migrated.budget.usedBytes).toBe(0);
    const reopened = fixture(); reopened.cache.configure(true, true);
    expect(reopened.cache.snapshot()).toEqual({ enabled: true, automatic: true, unlocked: true, status: "unverified" });
    expect(reopened.cache.restoreInput()).toBeNull();
    await reopened.cache.observe(reopened.payload);
    expect(reopened.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
    expect(fs.readFileSync(old.file)).toEqual(encrypted);
  });
  test("eight-character automatic setup saves the next native pair and startup alone cannot authorize it", async () => {
    const f = fixture(); f.cache.configure(true);
    expect(await f.cache.enableAutomatic("SYNTHET8")).toBe(true);
    expect(fs.existsSync(f.file)).toBe(false); expect(fs.existsSync(`${f.file}.key`)).toBe(true);
    await f.cache.remember(f.input, 42); f.cache.dispose();
    const reopened = fixture(); reopened.cache.configure(true, true);
    expect(reopened.cache.snapshot().status).toBe("unverified"); expect(reopened.cache.restoreInput()).toBeNull();
    await reopened.cache.observe(reopened.payload); expect(reopened.cache.snapshot().status).toBe("validated");
  });
  test.each(["missing", "bad magic", "truncated", "oversized", "wrong key", "wrong salt"])("%s automatic key preserves ciphertext for manual recovery", async kind => {
    const f = await savedFixture(); expect(await f.cache.enableAutomatic(passphrase)).toBe(true);
    f.cache.dispose(); const cipher = fs.readFileSync(f.file), keyFile = `${f.file}.key`;
    let bytes = fs.readFileSync(keyFile);
    if (kind === "missing") fs.unlinkSync(keyFile);
    else {
      if (kind === "bad magic") bytes[0] ^= 1;
      if (kind === "truncated") bytes = bytes.subarray(0, 55);
      if (kind === "oversized") bytes = Buffer.alloc(57);
      if (kind === "wrong key") bytes[24] ^= 1;
      if (kind === "wrong salt") bytes[8] ^= 1;
      fs.writeFileSync(keyFile, bytes);
    }
    const reopened = fixture(); reopened.cache.configure(true, true);
    expect(reopened.cache.snapshot().status).toBe("unlock_failed"); expect(reopened.budget.usedBytes).toBe(0);
    expect(fs.readFileSync(f.file)).toEqual(cipher);
    expect(await reopened.cache.unlock(passphrase)).toBe(true); await reopened.cache.observe(reopened.payload);
    expect(reopened.cache.snapshot().status).toBe("validated");
  });
  test("Lock keeps automatic reopening consent; disable removes the retained key but preserves ciphertext", async () => {
    const f = await savedFixture(); await f.cache.enableAutomatic(passphrase); const cipher = fs.readFileSync(f.file);
    f.cache.lock(); expect(f.cache.snapshot()).toMatchObject({ automatic: true, unlocked: false, status: "locked" });
    expect(fs.existsSync(`${f.file}.key`)).toBe(true); expect(f.budget.usedBytes).toBe(0);
    f.cache.configure(false); expect(fs.existsSync(`${f.file}.key`)).toBe(false); expect(fs.readFileSync(f.file)).toEqual(cipher);
    f.cache.configure(true); expect(f.cache.snapshot().status).toBe("locked");
    f.cache.clear(); expect(fs.existsSync(f.file)).toBe(false);
  });
  test("automatic key write failure preserves the encrypted file and unowned temporary artifact", async () => {
    const f = await savedFixture(), cipher = fs.readFileSync(f.file), temp = `${f.file}.key.tmp`;
    fs.writeFileSync(temp, "UNRELATED");
    expect(await f.cache.enableAutomatic(passphrase)).toBe(false);
    expect(f.cache.snapshot().status).toBe("storage_error"); expect(fs.readFileSync(f.file)).toEqual(cipher);
    expect(fs.readFileSync(temp, "utf8")).toBe("UNRELATED"); expect(fs.existsSync(`${f.file}.key`)).toBe(false);
  });
  test("wrong migration passphrase cannot opt in or replace the existing encrypted data", async () => {
    const f = await savedFixture(), cipher = fs.readFileSync(f.file); f.cache.lock();
    expect(await f.cache.enableAutomatic("WRONG888")).toBe(false);
    expect(f.cache.snapshot()).toEqual({ enabled: true, unlocked: false, status: "unlock_failed" });
    expect(fs.existsSync(`${f.file}.key`)).toBe(false); expect(fs.readFileSync(f.file)).toEqual(cipher);
  });
  test("a failed retained-key removal disables reuse and publishes the actual deletion failure", async () => {
    const f = await savedFixture(); await f.cache.enableAutomatic(passphrase);
    const unlink = fs.unlinkSync; vi.spyOn(fs, "unlinkSync").mockImplementation(file => {
      if (String(file) === `${f.file}.key`) throw Object.assign(new Error("PRIVATE_PATH"), { code: "EACCES" });
      return unlink(file);
    });
    f.cache.configure(false);
    expect(f.cache.snapshot()).toEqual({ enabled: false, unlocked: false, status: "clear_failed" });
    expect(f.snapshots.at(-1)).toEqual(f.cache.snapshot()); expect(f.cache.restoreInput()).toBeNull();
    expect(f.budget.usedBytes).toBe(0); expect(fs.existsSync(f.file)).toBe(true); expect(fs.existsSync(`${f.file}.key`)).toBe(true);
    expect(JSON.stringify(f.diagnostics)).not.toContain("PRIVATE_PATH");
  });
  test("Lock during retained-key finalization cancels automatic opt-in without replacing ciphertext", async () => {
    const f = await savedFixture(), cipher = fs.readFileSync(f.file), fsync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(fd => { fsync(fd); f.cache.lock(); });
    expect(await f.cache.enableAutomatic(passphrase)).toBe(false);
    expect(fs.existsSync(`${f.file}.key`)).toBe(false); expect(fs.existsSync(`${f.file}.key.tmp`)).toBe(false);
    expect(fs.readFileSync(f.file)).toEqual(cipher); expect(f.budget.usedBytes).toBe(0);
  });
  test("pre-unlock identity metadata stays bounded and is cleared on disposal", async () => {
    const f = fixture(); f.cache.configure(true);
    for (let index = 0; index < 40; index++) await f.cache.observe({ ...f.payload, text: `unique_account_id=${"x".repeat(1024)}&beta=0&account_id=12345678901234567890` });
    expect(f.budget.usedBytes).toBeLessThan(2048); expect(f.cache.restoreInput()).toBeNull();
    expect(fs.existsSync(f.file)).toBe(false); expect(fs.existsSync(`${f.file}.key`)).toBe(false);
    f.cache.dispose(); expect(f.budget.usedBytes).toBe(0);
  });
  test("a burst while ownership is pending uses one query and one latest-evidence follow-up", async () => {
    const f = await savedFixture(); let release!: (network: typeof f.network) => void;
    f.networkState.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = f.cache.observe(f.payload);
    const burst = Array.from({ length: 40 }, () => f.cache.observe(f.payload));
    expect(f.networkState).toHaveBeenCalledTimes(1);
    release(f.network); await Promise.all([first, ...burst]);
    expect(f.networkState).toHaveBeenCalledTimes(2); expect(f.cache.snapshot().status).toBe("validated");
    expect(f.budget.usedBytes).toBeLessThan(2048);
  });
  test.each(["gap", "generation", "account", "uid", "partial beta"])("%s during deferred unlock cannot resurrect pre-load identity", async kind => {
    const old = await savedFixture(); old.cache.dispose(); const f = fixture(); f.cache.configure(true);
    f.cache.observeProcesses([42]); await f.cache.observe(f.payload);
    const pending = f.cache.unlock(passphrase);
    if (kind === "gap") f.cache.suspend();
    if (kind === "generation") f.cache.observeProcesses([43]);
    if (kind === "account") await f.cache.observe({ ...f.payload, text: "account_id=other-123" });
    if (kind === "uid") await f.cache.observe({ ...f.payload, text: "unique_account_id=888888&beta=0" });
    if (kind === "partial beta") await f.cache.observe({ ...f.payload, text: `unique_account_id=${identity.uniqueAccountId}&beta=1` });
    await pending; expect(f.cache.restoreInput()).toBeNull();
    expect(f.cache.snapshot().status).not.toBe("validated");
  });
  test("expired pre-load identity is rejected without introducing a Ready expiration", async () => {
    const old = await savedFixture(); old.cache.dispose(); const f = fixture(); f.cache.configure(true);
    await f.cache.observe({ ...f.payload, observedAt: Date.now() - 600_001 });
    await f.cache.unlock(passphrase); expect(f.cache.restoreInput()).toBeNull();
    await f.cache.observe(f.payload); expect(f.cache.restoreInput()).not.toBeNull();
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 600_001);
    expect(f.cache.restoreInput()).not.toBeNull(); expect(await f.cache.preflight({ ...scope, pid: 42, localPort: 5000 })).toBe(true);
  });
});
