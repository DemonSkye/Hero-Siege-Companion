import { EventEmitter } from "node:events";
import type net from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InitializedSatanicZoneRefreshProvider } from "../../src/main/initialized-satanic-zone-provider";
import { runInitializedSatanicZoneProbe, type InitializedProbeInput } from "../../src/main/satanic-zone-initialized-transport";
import type { ParsedPayload } from "../../src/main/packet-decoder";
import type { HeroSiegeNetworkState } from "../../src/main/capture-network";
import type { SatanicZonePreparation } from "../../src/shared/satanic-zone-preparation";
import { frameDiagnosticBody } from "../fixtures/satanic-zone-diagnostic-frames";
import { inventedProbeScope as scope, inventedConnect, inventedPostLogin, genericProbeFrame as generic,
  opcodeOnlyReadyBody, inventedLoginSuccess, inventedZoneBody } from "../fixtures/satanic-zone-initialized";

async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
class Socket extends EventEmitter {
  localAddress = scope.localAddress; localPort = 6000;
  remoteAddress = scope.remoteAddress; remotePort = scope.remotePort;
  connect(_port: number, _address: string, connected: () => void) { connected(); return this; }
  writes: Buffer[] = [];
  write(frame: Buffer, done: () => void) { this.writes.push(Buffer.from(frame)); done(); return true; }
  destroy = vi.fn(() => this);
  receive(body: Buffer) { this.emit("data", generic(body)); }
}
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  let receive!: (packet: ParsedPayload, truncated: boolean) => void;
  const snapshots: SatanicZonePreparation[] = [], sockets: Socket[] = [], inputs: InitializedProbeInput[] = [];
  const close = vi.fn(); let canPrepare = true;
  const network: HeroSiegeNetworkState = { gameProcessIds: [42], antiCheatProcessIds: [],
    connections: [{ ...scope, localPort: 4999, owningProcess: 42, state: "established" }] };
  const prepare = vi.fn(async () => scope), open = vi.fn(async (_scope, callback) => { receive = callback; return { close }; });
  const provider = new InitializedSatanicZoneRefreshProvider({ canPrepare: () => canPrepare,
    onPreparation: state => snapshots.push(state), dependencies: { prepare, open, networkState: async () => network,
      attempt: (input, signal, budget, progress) => {
        inputs.push(input); const socket = new Socket(); sockets.push(socket);
        return runInitializedSatanicZoneProbe(input, signal, budget, progress, () => socket as unknown as net.Socket);
      } } });
  function packet(outbound: boolean, seq: number, payload = Buffer.alloc(0), flags = 16): ParsedPayload {
    return { src: outbound ? scope.localAddress : scope.remoteAddress, dst: outbound ? scope.remoteAddress : scope.localAddress,
      srcPort: outbound ? 5000 : scope.remotePort, dstPort: outbound ? scope.remotePort : 5000,
      seq, ack: outbound ? 201 : 101, flags, payload, payloadLength: payload.length, text: "" };
  }
  async function collect() {
    provider.prepare(); await flush();
    network.connections[0].localPort = 5000;
    receive(packet(true, 100, undefined, 2), false); receive(packet(false, 200, undefined, 18), false);
    const connect = frameDiagnosticBody(inventedConnect(), 7), ack = generic(opcodeOnlyReadyBody);
    receive(packet(true, 101, connect), false); receive(packet(false, 201, ack), false);
    receive(packet(true, 101 + connect.length, frameDiagnosticBody(inventedPostLogin(), 8)), false);
    receive(packet(false, 201 + ack.length, generic(inventedLoginSuccess())), false);
    await vi.advanceTimersByTimeAsync(1_000); await flush();
  }
  async function dispatch(signal?: AbortSignal) {
    const request = provider.requestRefresh({ signal }); await flush();
    sockets.at(-1)!.receive(opcodeOnlyReadyBody); sockets.at(-1)!.receive(inventedLoginSuccess());
    return request;
  }
  return { provider, collect, dispatch, sockets, inputs, snapshots, network, close, prepare, open,
    denyPreparation: () => { canPrepare = false; } };
}
afterEach(() => vi.useRealTimers());
describe("normal Refresh using the proven initialized transport, all boundaries mocked", () => {
  test("preparation is explicit, emits only two readiness fields, closes capture at Ready and sends nothing", async () => {
    const f = fixture(); expect(f.prepare).not.toHaveBeenCalled(); await f.collect();
    expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: 121_000 });
    expect(f.close).toHaveBeenCalledTimes(1); expect(f.sockets).toHaveLength(0);
    expect(f.provider.suppressRawLogging).toBe(true);
    expect(f.snapshots.every(snapshot => Object.keys(snapshot).sort().join() === "expiresAt,phase")).toBe(true);
    expect(JSON.stringify(f.snapshots)).not.toMatch(/CANARY|1234567890|9876543210|checksum|192\.0\.2/);
    f.provider.dispose(); expect(f.provider.suppressRawLogging).toBe(false);
  });
  test("only an owned zone is returned; repeated explicit clicks reuse bytes within the original absolute expiry", async () => {
    const f = fixture(); await f.collect(); const first = await f.dispatch();
    expect(first.accepted).toBe(true);
    expect(f.sockets[0].writes).toHaveLength(4);
    const wait = f.provider.waitForObservation(first.correlationId!, { timeoutMs: 30_000 });
    f.sockets[0].receive(inventedZoneBody);
    expect(await wait).toMatchObject({ kind: "observation", observation: { zone: { rawZone: "Act_04_03" } }, availabilityConsumed: false });
    await flush(); expect(f.provider.preparation).toEqual({ phase: "ready", expiresAt: 121_000 });
    expect(f.inputs[0].connectBody).toEqual(inventedConnect());
    expect(f.sockets[0].destroy).toHaveBeenCalledTimes(1);
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "refresh_cooldown" });
    await vi.advanceTimersByTimeAsync(30_000);
    const second = await f.dispatch();
    expect(f.inputs[1].connectBody).toBe(f.inputs[0].connectBody);
    expect(f.sockets[1].writes[0]).toEqual(f.sockets[0].writes[0]);
    const waitAgain = f.provider.waitForObservation(second.correlationId!, { timeoutMs: 30_000 });
    f.sockets[1].receive(inventedZoneBody); expect((await waitAgain)?.kind).toBe("observation"); await flush();
    expect(f.provider.preparation.expiresAt).toBe(121_000);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(f.provider.preparation.phase).toBe("expired");
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
    expect(f.inputs[0].postLoginBody.every(byte => byte === 0)).toBe(true);
    expect(f.inputs[0].identity.uniqueAccountId).toBe("");
    expect(f.provider.suppressRawLogging).toBe(false); expect(f.sockets).toHaveLength(2);
  });
  test.each(["pid", "port", "server", "adapter", "extra-flow", "closed-flow"])("%s change invalidates retained readiness without replay", async change => {
    const f = fixture(); await f.collect();
    if (change === "pid") f.network.gameProcessIds = [];
    if (change === "port") f.network.connections[0].localPort++;
    if (change === "server") f.network.connections[0].remoteAddress = "203.0.113.1";
    if (change === "adapter") f.network.connections[0].localAddress = "192.0.2.11";
    if (change === "extra-flow") f.network.connections.push({ ...f.network.connections[0], localPort: 5001 });
    if (change === "closed-flow") f.network.connections[0].state = "closewait";
    if (change === "pid") f.provider.observeProcessIds(f.network.gameProcessIds);
    else f.provider.observeConnections(f.network.connections);
    expect(f.provider.preparation.phase).toBe("unavailable"); expect(f.sockets).toHaveLength(0);
    expect(f.provider.suppressRawLogging).toBe(false);
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "helper_not_ready" });
  });
  test("scope is revalidated before login writes and invalidation during initialization cancels the socket", async () => {
    const f = fixture(); await f.collect(); f.network.connections[0].localPort++;
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "helper_failed" });
    expect(f.sockets).toHaveLength(0);
    const g = fixture(); await g.collect(); const pending = g.provider.requestRefresh(); await flush();
    expect(g.sockets[0].writes).toHaveLength(2); g.network.gameProcessIds = [];
    g.provider.observeProcessIds(g.network.gameProcessIds); await flush();
    expect(await pending).toMatchObject({ accepted: false, errorCode: "helper_failed" });
    expect(g.sockets[0].destroy).toHaveBeenCalledTimes(1);
    expect(g.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
  });
  test("a valid owned response cannot settle after the game flow changes before its topology event", async () => {
    const f = fixture(); await f.collect(); const dispatched = await f.dispatch();
    const wait = f.provider.waitForObservation(dispatched.correlationId!, { timeoutMs: 30_000 });
    f.network.connections[0].localPort = 5001;
    f.sockets[0].receive(inventedZoneBody);
    expect(await wait).toMatchObject({ kind: "terminal", errorCode: "helper_failed" });
    expect(f.provider.preparation.phase).toBe("unavailable");
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
  });
  test.each(["cancel", "stop", "dispose", "account", "beta", "process"])("%s clears RAM and prevents late results", async action => {
    const f = fixture(); await f.collect(); const dispatched = await f.dispatch();
    const abort = new AbortController();
    const wait = f.provider.waitForObservation(dispatched.correlationId!, { timeoutMs: 30_000, signal: abort.signal });
    if (action === "cancel") abort.abort();
    if (action === "stop") f.provider.stop();
    if (action === "dispose") f.provider.dispose();
    if (action === "process") f.provider.observeProcessIds([]);
    if (action === "account" || action === "beta") f.provider.observeSessionPayload({ direction: "outbound", ...scope,
      text: action === "account" ? "unique_account_id=555" : "unique_account_id=12345678901234567890&beta=1" });
    expect((await wait)?.kind).toBe("terminal");
    f.sockets[0].receive(inventedZoneBody); await flush();
    expect(f.provider.preparation.phase).not.toBe("ready");
    expect(f.inputs[0].connectBody.every(byte => byte === 0)).toBe(true);
    expect(f.provider.suppressRawLogging).toBe(false);
  });
  test("one flight, deadline and no automatic retry after missing owned response", async () => {
    const f = fixture(); await f.collect(); const dispatched = await f.dispatch();
    const wait = f.provider.waitForObservation(dispatched.correlationId!, { timeoutMs: 30_000 });
    expect(await f.provider.requestRefresh()).toMatchObject({ accepted: false, errorCode: "refresh_in_progress" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await wait).toMatchObject({ kind: "terminal", errorCode: "response_timeout" });
    expect(f.provider.preparation.phase).toBe("expired");
    await vi.advanceTimersByTimeAsync(90_000); expect(f.sockets).toHaveLength(1);
  });
  test("Stop between accepted dispatch and observation registration does not strand a pending request", async () => {
    const f = fixture(); await f.collect(); expect((await f.dispatch()).accepted).toBe(true);
    // Main can disable/Stop before its controller registers the observation wait.
    f.provider.stop(); await flush();
    await vi.advanceTimersByTimeAsync(30_000); await f.collect();
    expect(f.provider.preparation.phase).toBe("ready");
    const second = await f.dispatch(); expect(second.accepted).toBe(true);
    const wait = f.provider.waitForObservation(second.correlationId!, { timeoutMs: 30_000 });
    f.sockets[1].receive(inventedZoneBody); expect((await wait)?.kind).toBe("observation");
    f.provider.dispose();
  });
  test("disabled/busy preparation cannot open a capture and default E2E mode stays native/socket free", async () => {
    const f = fixture(); f.denyPreparation(); f.provider.prepare(); await flush();
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.provider.preparation.phase).toBe("unavailable");
    const nativeFree = new InitializedSatanicZoneRefreshProvider({ syntheticOnly: true, canPrepare: () => true, onPreparation: vi.fn() });
    nativeFree.prepare(); await flush(); expect(nativeFree.preparation.phase).toBe("unavailable");
    expect(await nativeFree.requestRefresh()).toMatchObject({ accepted: false }); nativeFree.dispose();
  });
});
