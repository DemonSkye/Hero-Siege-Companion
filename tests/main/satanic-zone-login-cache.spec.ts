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
  const snapshots: unknown[] = [], diagnostics: { stage: string; result: string; ciphertextPresent: boolean; keyPresent: boolean }[] = [];
  const network = { gameProcessIds: [42], antiCheatProcessIds: [], connections: [{ ...scope, localPort: 5000, owningProcess: 42, state: "established" }] };
  const networkState = vi.fn(async () => network);
  const cache = new SatanicZoneLoginCache({ store, networkState, onChange: state => snapshots.push(state),
    onDiagnostic: (stage, result, files) => diagnostics.push({ stage, result, ...files }) });
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
    cipher.setAAD(bytes.subarray(0, 8)); cipher.setAuthTag(bytes.subarray(36, 52));
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

describe("portable saved inputs with production encryption and synthetic secrets", () => {
  test("legacy ciphertext loads with route metadata only and remains byte-for-byte unchanged", async () => {
    const original = fixture(); original.cache.configure(true); expect(await original.cache.unlock(passphrase)).toBe(true);
    original.store.save({ connectBody: original.input.connectBody, postLoginBody: original.input.postLoginBody }, original.budget);
    original.store.retainUnlockingKey(original.budget); const previous = fs.readFileSync(original.file); original.cache.dispose();
    const f = fixture(); f.network.gameProcessIds = []; f.cache.configure(true, true);
    expect(f.cache.snapshot().status).toBe("route_required");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(f.cache.snapshot().status).toBe("loaded"); expect(f.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
    expect(fs.readFileSync(f.file)).toEqual(previous); expect(f.networkState).toHaveBeenCalledTimes(1);
    expect(f.diagnostics).toContainEqual({ stage: "load", result: "route_required", ciphertextPresent: true, keyPresent: true });
  });
  test("legacy loaded data stays intact when route discovery fails; later connection metadata resolves it", async () => {
    const original = fixture(); original.cache.configure(true); await original.cache.unlock(passphrase);
    original.store.save({ connectBody: original.input.connectBody, postLoginBody: original.input.postLoginBody }, original.budget);
    const previous = fs.readFileSync(original.file); original.cache.dispose();
    const f = fixture(); f.networkState.mockRejectedValue(new Error("PRIVATE_PATH_AND_ENDPOINT")); f.cache.configure(true);
    expect(await f.cache.unlock(passphrase)).toBe(true); expect(f.cache.snapshot().status).toBe("route_required");
    expect(f.cache.restoreInput()).toBeNull(); expect(fs.readFileSync(f.file)).toEqual(previous);
    f.cache.observeConnections(f.network.connections); expect(f.cache.restoreInput()?.connectBody).toEqual(inventedConnect());
    expect(JSON.stringify(f.diagnostics)).not.toMatch(/PRIVATE|192\.0\.2|198\.51/);
  });
  test("missing ciphertext is reported separately from locked, failed decrypt and explicit Forget", async () => {
    const f = await savedFixture(); await f.cache.enableAutomatic(passphrase);
    f.cache.configure(false); expect(f.diagnostics.at(-1)).toEqual({ stage: "load", result: "disabled", ciphertextPresent: true, keyPresent: false });
    f.cache.clear(); expect(f.diagnostics.at(-1)).toEqual({ stage: "forget", result: "disabled", ciphertextPresent: false, keyPresent: false });
    f.cache.configure(true); await f.cache.enableAutomatic(passphrase); f.cache.dispose();
    const reopened = fixture(); reopened.cache.configure(true, true);
    expect(reopened.diagnostics.at(-1)).toEqual({ stage: "load", result: "empty", ciphertextPresent: false, keyPresent: true });
  });
  test("failed explicit Forget reports remaining material while disabling RAM reuse", async () => {
    const f = await savedFixture(), previous = fs.readFileSync(f.file);
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => { throw new Error("PRIVATE_PATH"); });
    f.cache.clear(); expect(f.cache.snapshot().status).toBe("clear_failed"); expect(f.cache.restoreInput()).toBeNull();
    expect(fs.readFileSync(f.file)).toEqual(previous); expect(f.diagnostics.at(-1)).toEqual({ stage: "forget", result: "clear_failed", ciphertextPresent: true, keyPresent: false });
    expect(JSON.stringify(f.diagnostics)).not.toContain("PRIVATE_PATH");
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
    await f.cache.remember(f.input, 42); expect(fs.existsSync(f.file)).toBe(false); expect(f.cache.restoreInput()).toBeNull(); expect(f.budget.usedBytes).toBeLessThan(2048);
    expect(await f.cache.unlock(passphrase)).toBe(true);
    expect(f.cache.snapshot()).toEqual({ enabled: true, unlocked: true, status: "empty" });
    expect(fs.existsSync(f.file)).toBe(false); expect(f.store.isUnlocked()).toBe(true);
  });
  test("atomic save, dispose, reopen and unlock preserve the byte-exact pair and destination without game identity", async () => {
    const f = await savedFixture(), encrypted = fs.readFileSync(f.file);
    expect(encrypted.subarray(0, 8).toString()).toBe("HSCSZ002");
    expect(encrypted.includes(f.input.connectBody)).toBe(false); expect(encrypted.includes(f.input.postLoginBody)).toBe(false);
    expect(encrypted.toString()).not.toMatch(/CANARY|account_uid|123456789|SYNTHETIC/);
    expect(fs.readdirSync(directory)).toEqual(["login.portable"]); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
    const plain = openPortable(encrypted);
    expect(plain.readUInt32LE(0)).toBe(f.input.connectBody.length); expect(plain.readUInt32LE(4)).toBe(f.input.postLoginBody.length);
    const bodyEnd = 8 + f.input.connectBody.length + f.input.postLoginBody.length;
    expect(plain.subarray(0, bodyEnd)).toEqual(Buffer.concat([plain.subarray(0, 8), f.input.connectBody, f.input.postLoginBody]));
    expect(JSON.parse(plain.subarray(bodyEnd).toString())).toEqual({ address: scope.remoteAddress, port: scope.remotePort });
    plain.fill(0); f.cache.dispose(); expect(f.budget.usedBytes).toBe(0);
    const reopened = fixture(); reopened.cache.configure(true); expect(reopened.cache.snapshot().status).toBe("locked");
    expect(await reopened.cache.unlock(passphrase)).toBe(true);
    expect(reopened.cache.snapshot().status).toBe("loaded"); expect(reopened.cache.restoreInput()).not.toBeNull();
    const restored = reopened.cache.restoreInput()!;
    expect(restored.connectBody).toEqual(inventedConnect()); expect(restored.postLoginBody).toEqual(inventedPostLogin());
    expect(restored.scope).toEqual({ remoteAddress: scope.remoteAddress, remotePort: scope.remotePort });
    expect(restored).not.toHaveProperty("pid"); expect(restored).not.toHaveProperty("nativePort");
    expect(JSON.stringify([...f.snapshots, ...f.diagnostics, ...reopened.snapshots])).not.toMatch(/CANARY|account_uid|123456789|SYNTHETIC/);
  });
  test("a copied portable file unlocks in a separate directory without an adjacent key or machine service", async () => {
    const original = await savedFixture(), moved = path.join(directory, "moved", "login.portable");
    original.cache.dispose(); fs.mkdirSync(path.dirname(moved)); fs.copyFileSync(original.file, moved);
    const reopened = fixture(moved); reopened.cache.configure(true); expect(await reopened.cache.unlock(passphrase)).toBe(true);
    expect(reopened.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
    expect(fs.readdirSync(path.dirname(moved))).toEqual(["login.portable"]);
  });
  test.each(["wrong passphrase", "tampered ciphertext", "tampered tag", "truncated", "oversized", "wrong version", "incoherent pair", "invalid lengths"])(
    "%s fails locked and preserves the file for explicit recovery", async kind => {
    const f = await savedFixture(); f.cache.dispose(); let bytes = fs.readFileSync(f.file);
    if (kind === "tampered ciphertext") bytes[bytes.length - 1] ^= 1;
    if (kind === "tampered tag") bytes[36] ^= 1;
    if (kind === "truncated") bytes = bytes.subarray(0, 55);
    if (kind === "oversized") bytes = Buffer.alloc(52 + 8 + 2 * 16_384 + 129);
    if (kind === "wrong version") bytes.write("HSCSZ003", 0);
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
    expect(await f.cache.unlock(passphrase)).toBe(true); expect(f.cache.restoreInput()?.connectBody).toEqual(inventedConnect());
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
    const f = await savedFixture(); const secret = f.cache.restoreInput()!.connectBody;
    f.cache.configure(false); expect(secret.every(byte => byte === 0)).toBe(true); expect(f.budget.usedBytes).toBe(0);
    expect(f.cache.snapshot()).toEqual({ enabled: false, unlocked: false, status: "disabled" }); expect(fs.existsSync(f.file)).toBe(true);
    f.cache.configure(true); expect(await f.cache.unlock(passphrase)).toBe(true); fs.writeFileSync(`${f.file}.tmp`, "synthetic stale temporary");
    f.cache.configure(false); f.cache.clear(); expect(fs.existsSync(f.file)).toBe(false); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
    expect(f.cache.snapshot()).toEqual({ enabled: false, unlocked: false, status: "disabled" }); expect(f.budget.usedBytes).toBe(0);
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
    expect(await migrated.cache.enableAutomatic(passphrase)).toBe(true);
    expect(migrated.cache.snapshot()).toMatchObject({ automatic: true, status: "loaded" });
    expect(fs.readFileSync(old.file)).toEqual(encrypted);
    const retained = fs.readFileSync(`${old.file}.key`);
    expect(retained.length).toBe(56); expect(retained.subarray(0, 8).toString()).toBe("HSCSZK01");
    expect(retained.toString()).not.toContain(passphrase);
    migrated.cache.dispose(); expect(migrated.budget.usedBytes).toBe(0);
    const reopened = fixture(); reopened.cache.configure(true, true);
    expect(reopened.cache.snapshot()).toMatchObject({ enabled: true, automatic: true, unlocked: true, status: "loaded" });
    expect(reopened.cache.restoreInput()).not.toBeNull();
    expect(reopened.cache.restoreInput()?.postLoginBody).toEqual(inventedPostLogin());
    expect(fs.readFileSync(old.file)).toEqual(encrypted);
  });
  test("eight-character automatic setup saves the next native pair and startup loads it without identity evidence", async () => {
    const f = fixture(); f.cache.configure(true);
    expect(await f.cache.enableAutomatic("SYNTHET8")).toBe(true);
    expect(fs.existsSync(f.file)).toBe(false); expect(fs.existsSync(`${f.file}.key`)).toBe(true);
    await f.cache.remember(f.input, 42); f.cache.dispose();
    const reopened = fixture(); reopened.cache.configure(true, true);
    expect(reopened.cache.snapshot().status).toBe("loaded"); expect(reopened.cache.restoreInput()).not.toBeNull();
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
    expect(await reopened.cache.unlock(passphrase)).toBe(true); expect(reopened.cache.snapshot().status).toBe("loaded");
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
});
