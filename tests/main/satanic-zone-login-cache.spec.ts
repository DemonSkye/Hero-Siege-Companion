import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
import { ElectronSatanicZoneTestRuntime } from "../../src/main/electron-satanic-zone-test-runtime";
import { inventedConnect, inventedPostLogin, inventedProbeScope as scope, inventedProbeIdentity as identity } from "../fixtures/satanic-zone-initialized";
import { loadSatanicZoneLoginCacheEnabled, saveSatanicZoneLoginCacheEnabled } from "../../src/main/persistence";
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-login-cache-")); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const file = path.join(directory, "login.encrypted"), budget = new SatanicZoneDiagnosticBufferBudget();
  const crypto = new ElectronSatanicZoneTestRuntime().cacheEncryption;
  const store = new SatanicZoneLoginCacheStore(file, crypto), snapshots: unknown[] = [];
  const network = { gameProcessIds: [42], antiCheatProcessIds: [], connections: [{ ...scope, localPort: 5000, owningProcess: 42, state: "established" }] };
  const buildIdentity = vi.fn(async () => "e".repeat(64)), networkState = vi.fn(async () => network);
  const cache = new SatanicZoneLoginCache({ store, buildIdentity, networkState, onChange: state => snapshots.push(state) });
  cache.attachBudget(budget);
  const input = { connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), identity, scope, nativePort: 5000 };
  const payload = { text: `unique_account_id=${identity.uniqueAccountId}&beta=0`, direction: "outbound" as const,
    ...scope, localPort: 5000 };
  return { file, budget, crypto, store, cache, snapshots, network, buildIdentity, networkState, input, payload };
}
describe("experimental encrypted login cache, invented material and mocked encryption/build only", () => {
  test("off by default; plaintext identity/bodies never appear on disk or status; exact pair restores unverified", async () => {
    const f = fixture(); expect(f.cache.snapshot()).toEqual({ enabled: false, status: "disabled" });
    await f.cache.remember(f.input, 42); expect(fs.existsSync(f.file)).toBe(false);
    f.cache.configure(true); await f.cache.remember(f.input, 42);
    expect(f.cache.snapshot().status).toBe("saved"); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
    expect(fs.readFileSync(f.file).toString()).not.toMatch(/CANARY|account|123456789/);
    f.cache.dispose(); expect(f.budget.usedBytes).toBe(0); expect(fs.existsSync(f.file)).toBe(true);
    const reopened = fixture(); reopened.cache.configure(true);
    expect(reopened.cache.snapshot().status).toBe("unverified"); expect(reopened.cache.restoreInput()).toBeNull();
    await reopened.cache.observe(reopened.payload);
    expect(reopened.cache.restoreInput()).toMatchObject({ connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), pid: 42 });
    expect(JSON.stringify(reopened.snapshots)).not.toMatch(/CANARY|account_uid|123456789|eeeeeeee/);
    reopened.cache.dispose();
  });
  test("only the minimum pair/schema/build are encrypted; old counters/identifiers/socket state are absent", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    const record = JSON.parse(f.crypto.decryptString(fs.readFileSync(f.file)));
    expect(Object.keys(record).sort()).toEqual(["build", "connect", "post", "schema"]);
    expect(Buffer.from(record.connect, "hex")).toEqual(f.input.connectBody); f.cache.dispose();
  });
  test.each(["unique_account_id=888888&beta=0", `unique_account_id=${identity.uniqueAccountId}&beta=1`, `unique_account_id=${identity.uniqueAccountId}&beta=0&account_id=other-123`])("wrong account/mode clears cache: %s", async text => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    await f.cache.observe({ ...f.payload, text });
    expect(f.cache.snapshot().status).toBe("identity_mismatch"); expect(f.cache.restoreInput()).toBeNull();
    expect(fs.existsSync(f.file)).toBe(false); expect(f.budget.usedBytes).toBe(0); f.cache.dispose();
  });
  test("partial, inbound, unattributed and metadata-only identity cannot validate", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    for (const payload of [{ ...f.payload, text: `unique_account_id=${identity.uniqueAccountId}` },
      { ...f.payload, direction: "inbound" as const }, { ...f.payload, localPort: undefined }, { ...f.payload, localPort: 6000 }]) await f.cache.observe(payload);
    expect(f.cache.restoreInput()).toBeNull(); expect(f.buildIdentity).toHaveBeenCalledTimes(1); f.cache.dispose();
  });
  test("matching identity still requires current build; mismatched build forgets, unavailable build blocks", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    f.buildIdentity.mockResolvedValueOnce(null as unknown as string); await f.cache.observe(f.payload);
    expect(f.cache.snapshot().status).toBe("build_unavailable"); expect(f.cache.restoreInput()).toBeNull();
    f.buildIdentity.mockResolvedValueOnce("f".repeat(64)); await f.cache.observe(f.payload);
    expect(f.cache.snapshot().status).toBe("build_mismatch"); expect(fs.existsSync(f.file)).toBe(false); f.cache.dispose();
  });
  test("capture gap and delayed validation cannot restore continuity; a new identity observation is required", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    let release!: (build: string) => void;
    f.buildIdentity.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const validation = f.cache.observe(f.payload); await Promise.resolve(); await Promise.resolve();
    f.cache.suspend(); release("e".repeat(64)); await validation;
    expect(f.cache.restoreInput()).toBeNull();
    await f.cache.observe(f.payload); const restored = f.cache.restoreInput()!;
    expect(await f.cache.preflight({ ...restored.scope, pid: 42, localPort: 5000 })).toBe(true);
    f.cache.suspend(); expect(await f.cache.preflight({ ...restored.scope, pid: 42, localPort: 5000 })).toBe(false); f.cache.dispose();
  });
  test("preflight rejects changed topology/build even if initial restore matched", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42); await f.cache.observe(f.payload);
    f.network.connections[0].owningProcess = 43;
    expect(await f.cache.preflight({ ...scope, pid: 42, localPort: 5000 })).toBe(false);
    expect(f.cache.restoreInput()).toBeNull(); f.cache.dispose();
  });
  test("encryption unavailable or throwing cannot write/restore credentials", async () => {
    const f = fixture(); vi.spyOn(f.crypto, "isEncryptionAvailable").mockReturnValue(false);
    f.cache.configure(true); await f.cache.remember(f.input, 42);
    expect(f.cache.snapshot().status).toBe("encryption_unavailable"); expect(fs.existsSync(f.file)).toBe(false);
    expect(f.budget.usedBytes).toBe(0); f.cache.dispose();
  });
  test("encryption becoming unavailable after restore blocks explicit preflight and clears RAM", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42); await f.cache.observe(f.payload);
    const secret = f.cache.restoreInput()!.connectBody;
    vi.spyOn(f.crypto, "isEncryptionAvailable").mockReturnValue(false);
    expect(await f.cache.preflight({ ...scope, pid: 42, localPort: 5000 })).toBe(false);
    expect(f.cache.snapshot().status).toBe("encryption_unavailable"); expect(secret.every(byte => byte === 0)).toBe(true);
    expect(f.budget.usedBytes).toBe(0); f.cache.dispose();
  });
  test("encryption exceptions, missing build and process loss during save never persist plaintext", async () => {
    const f = fixture(); f.cache.configure(true);
    vi.spyOn(f.crypto, "encryptString").mockImplementationOnce(() => { throw new Error("PRIVATE_LOGIN"); });
    await f.cache.remember(f.input, 42); expect(f.cache.snapshot().status).toBe("storage_error");
    f.buildIdentity.mockResolvedValueOnce(null as unknown as string); await f.cache.remember(f.input, 42);
    expect(f.cache.snapshot().status).toBe("build_unavailable");
    let release!: (hash: string) => void; f.buildIdentity.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const saving = f.cache.remember(f.input, 42); f.cache.observeProcesses([]); release("e".repeat(64)); await saving;
    expect(fs.existsSync(f.file)).toBe(false); expect(f.budget.usedBytes).toBe(0);
    expect(JSON.stringify(f.snapshots)).not.toContain("PRIVATE_LOGIN"); f.cache.dispose();
  });
  test.each(["garbage", "oversized", "wrong-schema", "incoherent"])("invalid cache fails closed and is forgotten: %s", async kind => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42); f.cache.dispose();
    if (kind === "garbage") fs.writeFileSync(f.file, Buffer.from("garbage"));
    if (kind === "oversized") fs.writeFileSync(f.file, Buffer.alloc(131073));
    if (kind === "wrong-schema" || kind === "incoherent") {
      const record = JSON.parse(f.crypto.decryptString(fs.readFileSync(f.file)));
      if (kind === "wrong-schema") record.schema = 2; else record.post = inventedPostLogin("444444").toString("hex");
      fs.writeFileSync(f.file, f.crypto.encryptString(JSON.stringify(record)));
    }
    const reopened = fixture(); reopened.cache.configure(true);
    expect(reopened.cache.snapshot().status).toBe("storage_error"); expect(reopened.cache.restoreInput()).toBeNull();
    expect(fs.existsSync(f.file)).toBe(false); expect(reopened.budget.usedBytes).toBe(0); reopened.cache.dispose();
  });
  test("atomic write failure leaves previous ciphertext intact and removes temporary file", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    const previous = fs.readFileSync(f.file); vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("PRIVATE_CANARY"); });
    await f.cache.remember(f.input, 42);
    expect(fs.readFileSync(f.file)).toEqual(previous); expect(fs.existsSync(`${f.file}.tmp`)).toBe(false);
    expect(f.cache.snapshot().status).toBe("storage_error"); expect(JSON.stringify(f.snapshots)).not.toContain("PRIVATE_CANARY"); f.cache.dispose();
  });
  test("disable/clear zero RAM, delete ciphertext and cancel an in-flight save", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42); await f.cache.observe(f.payload);
    const secret = f.cache.restoreInput()!.connectBody; f.cache.clear();
    expect(secret.every(byte => byte === 0)).toBe(true); expect(f.cache.restoreInput()).toBeNull(); expect(fs.existsSync(f.file)).toBe(false);
    let release!: (build: string) => void; f.buildIdentity.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const saving = f.cache.remember(f.input, 42); f.cache.configure(false); release("e".repeat(64)); await saving;
    expect(f.cache.snapshot()).toEqual({ enabled: false, status: "disabled" }); expect(fs.existsSync(f.file)).toBe(false);
    expect(f.budget.usedBytes).toBe(0); f.cache.dispose();
  });
  test("delete failure reports a concrete error and prevents cached use", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => { throw Object.assign(new Error("private path"), { code: "EACCES" }); });
    f.cache.configure(false); expect(f.cache.snapshot()).toEqual({ enabled: false, status: "clear_failed" });
    expect(f.cache.restoreInput()).toBeNull(); expect(f.budget.usedBytes).toBe(0); f.cache.dispose();
  });
  test("wrong account cannot hide failed deletion behind a successful-cleared message", async () => {
    const f = fixture(); f.cache.configure(true); await f.cache.remember(f.input, 42);
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => { throw Object.assign(new Error("private path"), { code: "EACCES" }); });
    await f.cache.observe({ ...f.payload, text: "unique_account_id=888888&beta=0" });
    expect(f.cache.snapshot().status).toBe("clear_failed"); expect(fs.existsSync(f.file)).toBe(true);
    expect(f.cache.restoreInput()).toBeNull(); expect(f.budget.usedBytes).toBe(0); f.cache.dispose();
  });
  test("explicit opt-in alone persists; missing, malformed, corrupted and saved Off remain off", () => {
    const file = path.join(directory, "preferences.json"); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    expect(saveSatanicZoneLoginCacheEnabled(file, true)).toBe(true); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(true);
    saveSatanicZoneLoginCacheEnabled(file, false); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    fs.writeFileSync(file, '{"satanicZoneLoginCache":{"enabled":"true"}}'); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
    fs.writeFileSync(file, "garbage"); expect(loadSatanicZoneLoginCacheEnabled(file)).toBe(false);
  });
});
