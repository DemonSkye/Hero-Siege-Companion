import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { InitializedSatanicZoneRefreshProvider } from "../../src/main/initialized-satanic-zone-provider";
import { SatanicZoneController } from "../../src/main/satanic-zone-controller";
import { runInitializedSatanicZoneProbe } from "../../src/main/satanic-zone-initialized-transport";
import { satanicZoneRefreshControl } from "../../src/renderer/src/lib/satanic-zone-display";
import { inventedConnect, inventedPostLogin, inventedProbeIdentity as identity, inventedProbeScope as scope,
  genericProbeFrame, inventedLoginSuccess, inventedZoneBody, opcodeOnlyReadyBody } from "../fixtures/satanic-zone-initialized";

const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
class Socket extends EventEmitter {
  localAddress = "192.0.2.99"; localPort = 6000; remoteAddress = scope.remoteAddress; remotePort = scope.remotePort;
  writes: Buffer[] = []; destroyed = false;
  connect(_port: number, _address: string, connected: () => void) { connected(); return this; }
  write(bytes: Buffer, done: () => void) { this.writes.push(Buffer.from(bytes)); done(); return true; }
  destroy() { this.destroyed = true; return this; }
  receive(body: Buffer) { this.emit("data", genericProbeFrame(body)); }
}
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function fixture(file: string) {
  let provider: InitializedSatanicZoneRefreshProvider | undefined, controller: SatanicZoneController | undefined;
  const networkState = vi.fn(async () => ({ gameProcessIds: [], antiCheatProcessIds: [], connections: [] }));
  const prepare = vi.fn(async () => { throw new Error("No capture listener in saved-input workflow"); });
  const open = vi.fn(async () => { throw new Error("No capture listener in saved-input workflow"); });
  const diagnostics: { stage: string; result: string }[] = [], sockets: Socket[] = [];
  const cache = new SatanicZoneLoginCache({ store: new SatanicZoneLoginCacheStore(file), networkState,
    onChange: () => provider?.cacheChanged(), onDiagnostic: (stage, result) => diagnostics.push({ stage, result }) });
  provider = new InitializedSatanicZoneRefreshProvider({ loginCache: cache, canPrepare: () => false,
    canRefresh: () => true, onPreparation: preparation => controller?.setPreparation(preparation), dependencies: { prepare, open, networkState,
      attempt: (input, signal, budget, progress) => { const socket = new Socket(); sockets.push(socket);
        return runInitializedSatanicZoneProbe(input, signal, budget, progress, () => socket as unknown as net.Socket); } } });
  controller = new SatanicZoneController({ provider, now: Date.now, onStateChange: () => {} });
  return { provider, cache, controller, sockets, diagnostics, networkState, prepare, open };
}
async function saved() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-saved-refresh-")); directories.push(directory);
  const file = path.join(directory, "login.portable"), original = fixture(file);
  original.cache.configure(true); expect(await original.cache.enableAutomatic("SYNTHETIC saved-refresh passphrase")).toBe(true);
  await original.cache.remember({ connectBody: inventedConnect(), postLoginBody: inventedPostLogin(), identity, scope, nativePort: 5000 }, 42);
  original.controller.dispose(); original.provider.dispose();
  const reopened = fixture(file); reopened.cache.configure(true, true); await flush();
  return { ...reopened, file };
}
describe("saved SZ inputs after a real-file Companion restart, no game or capture", () => {
  test("automatic load offers Refresh without any game packets, process, listener or background authentication", async () => {
    const f = await saved();
    expect(f.cache.snapshot()).toMatchObject({ enabled: true, unlocked: true, automatic: true });
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached", expiresAt: null });
    expect(await f.provider.getAvailability()).toMatchObject({ available: true });
    expect(satanicZoneRefreshControl(f.controller.getState(), Date.now(), false).disabled).toBe(false);
    expect(f.sockets).toHaveLength(0); expect(f.prepare).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled();
    expect(f.networkState).not.toHaveBeenCalled(); f.controller.dispose(); f.provider.dispose();
  });
  test("explicit Refresh uses fresh socket initialization and delivers its zone to public UI", async () => {
    const f = await saved(), before = fs.readFileSync(f.file);
    const request = f.controller.refreshNow(); await flush();
    expect(f.sockets).toHaveLength(1); expect(f.sockets[0].writes).toHaveLength(2);
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
    expect(await request).toMatchObject({ accepted: true, errorCode: null });
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect(f.controller.getState()).toMatchObject({ phase: "current", source: "manual", errorCode: null,
      current: { rawZone: "Act_04_03" } });
    expect(f.sockets[0].writes).toHaveLength(4); expect(f.sockets[0].destroyed).toBe(true);
    expect(fs.readFileSync(f.file)).toEqual(before); expect(f.networkState).not.toHaveBeenCalled();
    f.controller.dispose(); f.provider.dispose();
  });
  test("default synthetic mode cannot construct a socket for loaded saved inputs", async () => {
    const original = await saved(); original.controller.dispose(); original.provider.dispose();
    const constructor = vi.spyOn(net, "Socket").mockImplementation(() => { throw new Error("Offline test forbids real socket construction"); });
    let provider: InitializedSatanicZoneRefreshProvider | undefined;
    const cache = new SatanicZoneLoginCache({ store: new SatanicZoneLoginCacheStore(original.file),
      networkState: async () => ({ gameProcessIds: [], antiCheatProcessIds: [], connections: [] }), onChange: () => provider?.cacheChanged() });
    provider = new InitializedSatanicZoneRefreshProvider({ syntheticOnly: true, loginCache: cache, canPrepare: () => true, onPreparation: () => {} });
    cache.configure(true, true); expect(provider.preparation.phase).toBe("ready");
    expect(await provider.requestRefresh()).toMatchObject({ accepted: false });
    expect(constructor).not.toHaveBeenCalled(); provider.dispose(); constructor.mockRestore();
  });
  test.each(["Lock", "Forget", "disable", "shutdown"])("%s cancels an initialized saved attempt and rejects late delivery", async action => {
    const f = await saved(), before = fs.readFileSync(f.file);
    const request = f.provider.requestRefresh(); await flush();
    f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
    const accepted = await request, waiting = f.provider.waitForObservation(accepted.correlationId!, { timeoutMs: 30_000 });
    if (action === "Lock") f.cache.lock();
    if (action === "Forget") f.cache.clear();
    if (action === "disable") f.provider.stop();
    if (action === "shutdown") f.provider.dispose();
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect((await waiting)?.kind).toBe("terminal"); expect(f.sockets[0].destroyed).toBe(true);
    expect(f.sockets).toHaveLength(1);
    if (action === "Forget") expect(fs.existsSync(f.file)).toBe(false); else expect(fs.readFileSync(f.file)).toEqual(before);
    f.controller.dispose(); f.provider.dispose();
  });
  test("capture gaps, process changes and listener failures cannot revoke deliberately saved inputs or send automatically", async () => {
    const f = await saved();
    f.provider.observeCaptureUpdate({ observationGap: true }, true); f.provider.observeProcessIds([]);
    f.provider.observeConnections([]); f.provider.observeTcpLifecycle({ src: scope.localAddress, dst: scope.remoteAddress, srcPort: 5000, dstPort: 6669, flags: 1 });
    f.provider.observeSessionPayload({ ...scope, localPort: 5000, direction: "outbound", text: "unique_account_id=88888&beta=1" });
    await f.provider.preparePassively(); await flush();
    expect(f.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
    expect(f.sockets).toHaveLength(0); expect(f.prepare).not.toHaveBeenCalled();
    f.controller.dispose(); f.provider.dispose();
  });
  test("one flight, bounded timeout and explicit retry preserve saved data without automatic authentication", async () => {
    const f = await saved(), before = fs.readFileSync(f.file); vi.useFakeTimers();
    const request = f.provider.requestRefresh(); await flush();
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "refresh_in_progress" });
    await vi.advanceTimersByTimeAsync(30_000); expect(await request).toMatchObject({ accepted: false, errorCode: "response_timeout" });
    expect(f.sockets).toHaveLength(1); expect(f.sockets[0].destroyed).toBe(true);
    expect(f.provider.preparation.phase).toBe("ready"); expect(fs.readFileSync(f.file)).toEqual(before);
    await vi.advanceTimersByTimeAsync(600_000); expect(f.sockets).toHaveLength(1);
    const retry = f.provider.requestRefresh(); await flush(); expect(f.sockets).toHaveLength(2);
    f.sockets[1].receive(Buffer.from([0,16,0,0])); // Malformed acknowledgment fails this single attempt.
    expect(await retry).toMatchObject({ accepted: false }); expect(fs.readFileSync(f.file)).toEqual(before);
    f.controller.dispose(); f.provider.dispose();
  });
  test.each(["before dispatch", "after dispatch"])("explicit cancellation %s preserves the loaded file and permits a later click", async stage => {
    const f = await saved(), before = fs.readFileSync(f.file), abort = new AbortController();
    const request = f.provider.requestRefresh({ signal: abort.signal }); await flush();
    let waiting: ReturnType<typeof f.provider.waitForObservation> | undefined;
    if (stage === "after dispatch") {
      f.sockets[0].receive(opcodeOnlyReadyBody); f.sockets[0].receive(inventedLoginSuccess());
      const accepted = await request; waiting = f.provider.waitForObservation(accepted.correlationId!, { timeoutMs: 30_000, signal: abort.signal });
    }
    abort.abort(); await flush();
    if (waiting) expect((await waiting)?.kind).toBe("terminal"); else expect(await request).toMatchObject({ accepted: false });
    expect(f.sockets[0].destroyed).toBe(true); expect(fs.readFileSync(f.file)).toEqual(before);
    expect(f.provider.preparation.phase).toBe("ready"); f.controller.dispose(); f.provider.dispose();
  });
});
