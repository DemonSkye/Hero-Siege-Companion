import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CaptureService, type CaptureUpdate } from "../../src/main/capture";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import { DirectMarketSearchProvider } from "../../src/main/direct-market-search-provider";
import { MarketReadinessController } from "../../src/main/market-readiness-controller";
import { MarketRegionDirectory } from "../../src/main/market-region-directory";
import type { MarketReadiness } from "../../src/shared/market-readiness";
import type { CaptureConnection } from "../../src/shared/app-state";
import { frameDiagnosticBody, requestDiagnosticBody } from "../fixtures/satanic-zone-diagnostic-frames";
import { replayIdentity, replayMarketRequest, replayPacket, replayScope, type ReplaySegment } from "../fixtures/network-replay";

const workers = vi.hoisted(() => [] as Array<EventEmitter & { terminate: ReturnType<typeof vi.fn> }>);
vi.mock("node:worker_threads", async importOriginal => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  const { EventEmitter } = await import("node:events");
  const replacement = { ...actual, Worker: class extends EventEmitter {
    terminate = vi.fn(async () => 0);
    constructor() { super(); workers.push(this); }
  } };
  return { ...replacement, default: replacement };
});
// The real capture decoder/reassembler runs; no native handle, process query or network is opened.
vi.mock("../../src/main/capture-adapter", () => ({
  openPacketCapture: vi.fn(), findNpcapDevice: vi.fn(), listNpcapDevices: vi.fn(),
}));

const cleanups: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); workers.length = 0; vi.useRealTimers(); });
const success = { response: { ok: true, result: { listings: [{ price: 4000 }], totalMatches: 1 } }, diagnostics: {} };
const connection = (localPort = 5000, remotePort = replayScope.remotePort): CaptureConnection => ({ ...replayScope, remotePort, localPort, owningProcess: 42, state: "Established" });

function harness(remotePort = replayScope.remotePort) {
  const store = new CapturedSessionContextStore();
  store.observeGameProcessIds([42]);
  let readiness!: MarketReadiness;
  const readinessTransitions: MarketReadiness[] = [];
  const controller = new MarketReadinessController(store, next => { readiness = next; readinessTransitions.push(next); });
  controller.setCaptureRunning(true);
  const provider = new DirectMarketSearchProvider(store);
  const captureUpdates: CaptureUpdate[] = [];
  // The same production store seam used by main.ts, without importing Electron.
  const update = (next: CaptureUpdate) => {
    captureUpdates.push(next);
    store.observeCaptureUpdate(next);
    if (next.running !== undefined) controller.setCaptureRunning(next.running);
  };
  const service = new CaptureService(update, undefined, undefined, false, payload => store.observe(payload), ids => store.observeGameProcessIds(ids),
    packet => store.observeTcpLifecycle(packet));
  const capture = service as unknown as {
    activeLocalAddress: string; activeLinkType: string; buffer: Buffer;
    cap: { close(): void } | null;
    processPacket(bytes: number, truncated: boolean): void;
    refreshCaptureFlows(connections: CaptureConnection[]): void;
    closeCapture(reason: string): void;
    resetPacketState(): void;
    recoverParser(reason: string): void;
    stopTimers(): void;
    observeGameProcessIdsSafely(ids: number[]): void;
    packetBuffers: { stats(): { streams: number; pendingSegments: number; bufferedBytes: number } };
  };
  capture.activeLocalAddress = replayScope.localAddress;
  capture.observeGameProcessIdsSafely([42]);
  capture.activeLinkType = "ETHERNET";
  capture.refreshCaptureFlows([connection(5000, remotePort), connection(6000, remotePort)]);
  const sequences = new Map<number, number>();
  function feed(payload: Buffer, options: Partial<ReplaySegment> & { localPort?: number; truncated?: boolean; shorten?: number } = {}) {
    const localPort = options.localPort ?? 5000;
    const sequence = options.sequence ?? sequences.get(localPort) ?? 101;
    const packet = replayPacket({ outbound: true, sequence, flags: 24, payload, ...options }, localPort);
    packet.writeUInt16BE(remotePort, options.outbound === false ? 34 : 36);
    capture.buffer = packet.subarray(0, packet.length - (options.shorten ?? 0));
    capture.processPacket(capture.buffer.length, options.truncated ?? false);
    const next = sequence + payload.length + ((options.flags ?? 24) & 3 ? 1 : 0);
    // Captured retransmissions do not move the synthetic sender's sequence head backwards.
    sequences.set(localPort, (options.flags ?? 24) & 2 ? next : Math.max(sequences.get(localPort) ?? next, next));
  }
  function identity(localPort = 5000) { feed(frameDiagnosticBody(replayIdentity(), 9), { localPort }); }
  function fields(text: string, localPort = 5000) {
    feed(frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, text), 10), { localPort });
  }
  function reopen(reason: "reopen" | "parser-recovery") {
    capture.cap = { close: vi.fn() };
    if (reason === "parser-recovery") capture.recoverParser("synthetic parser recovery");
    else { capture.closeCapture(reason); capture.resetPacketState(); }
    // Substitute only the native open result, with unchanged process/TCP tuples.
    capture.activeLocalAddress = replayScope.localAddress;
    capture.activeLinkType = "ETHERNET";
    capture.refreshCaptureFlows([connection(5000, remotePort), connection(6000, remotePort)]);
  }
  const dispose = () => { capture.stopTimers(); provider.dispose(); controller.dispose(); store.dispose(); };
  cleanups.push(dispose);
  return { store, provider, feed, fields, identity, update, reopen,
    stopResume: () => { capture.cap = { close: vi.fn() }; service.stop(); reopen("reopen"); capture.observeGameProcessIdsSafely([42]); update({ running: true }); },
    processes: (ids: number[]) => { sequences.clear(); capture.observeGameProcessIdsSafely(ids); },
    readiness: () => readiness, readinessTransitions, captureUpdates, packetStats: () => capture.packetBuffers.stats(),
    nextSequence: (localPort = 5000) => sequences.get(localPort) ?? 101,
    syncConnections: (connections: CaptureConnection[], observationBoundary?: number) => {
      update({ connections, ...(observationBoundary !== undefined ? { observationBoundary } : {}) }); capture.refreshCaptureFlows(connections);
    } };
}

async function dispatch(f: ReturnType<typeof harness>) {
  const pending = f.provider.search(replayMarketRequest);
  await Promise.resolve();
  return { pending, worker: workers.at(-1)! };
}

describe("production capture to Market trust after lost evidence", () => {
  const account = "account_id=na-42&season=11&hardcore=0&beta=0";
  const transient = "unique_account_id=12345678901234567890&crossregion_identifier=1111111111&beta=0";

  test.each(["idle", "pending-capacity", "byte-capacity", "stream-capacity"])("%s discard invalidates old work and allows sufficient new context on the continuous flow", async loss => {
    const f = harness();
    // A completed legacy JSON record leaves framing undecided for its next record.
    // A native API stream instead discards unframed filler down to a possible header.
    if (loss === "byte-capacity") f.feed(Buffer.from(JSON.stringify({ account_id: "na-42",
      unique_account_id: "12345678901234567890", crossregion_identifier: "1111111111", season: 11, hardcore: 0, beta: 0 })));
    else f.identity();
    expect(f.readiness().canSearch).toBe(true);
    const oldRequest = await dispatch(f);
    const version = f.readiness().contextVersion, transitionStart = f.readinessTransitions.length;
    if (loss === "byte-capacity") {
      f.feed(Buffer.from('{"data":"'));
      for (let index = 0; index < 16; index++) f.feed(Buffer.alloc(60_000, 0xff));
      expect(f.packetStats().bufferedBytes).toBeGreaterThan(960_000);
      expect(f.captureUpdates.filter(update => update.observationGap)).toHaveLength(0);
      f.feed(Buffer.alloc(60_000, 0xff));
      expect(f.packetStats()).toEqual({ streams: 0, pendingSegments: 0, bufferedBytes: 0 });
    } else {
      f.feed(frameDiagnosticBody(replayIdentity(), 10).subarray(0, 9));
      if (loss === "idle") {
        expect(f.packetStats().bufferedBytes).toBe(9);
        await vi.advanceTimersByTimeAsync(30_001);
        // Production refresh polls renew connection admission every second.
        f.syncConnections([connection(5000), connection(6000)]);
        expect(f.captureUpdates.filter(update => update.observationGap)).toHaveLength(0);
      }
      if (loss === "pending-capacity") {
        const start = f.nextSequence();
        for (let index = 0; index < 257; index++) f.feed(Buffer.from([0xff]), { sequence: start + 10 + 2 * index });
      }
      if (loss === "stream-capacity") {
        f.syncConnections([connection(5000), connection(6000), ...Array.from({ length: 128 }, (_, index) => connection(7000 + index))]);
        for (let index = 0; index < 128; index++) {
          await vi.advanceTimersByTimeAsync(1);
          f.feed(Buffer.from([0xff]), { localPort: 7000 + index });
        }
      }
    }
    f.fields(`${account}&${transient.replace("&beta=0", "")}`);
    expect(f.captureUpdates.filter(update => update.observationGap).length).toBeGreaterThan(0);
    expect(f.readinessTransitions.slice(transitionStart).some(state => !state.canSearch)).toBe(true);
    expect(f.readiness().canSearch).toBe(true);
    expect(f.readiness().contextVersion).toBeGreaterThan(version!);
    oldRequest.worker.emit("message", success);
    expect((await oldRequest.pending).ok).toBe(false);
    expect(oldRequest.worker.terminate).toHaveBeenCalledOnce();
  });

  test("a complete newly observed native context beyond a TCP hole recovers without waiting for missing bytes", () => {
    const f = harness(); f.identity();
    const old = frameDiagnosticBody(replayIdentity(), 10), start = f.nextSequence();
    f.feed(old.subarray(0, 9), { sequence: start });
    f.feed(old.subarray(23), { sequence: start + 23 });
    expect(f.readiness().canSearch).toBe(false);
    f.fields(`${account}&${transient.replace("&beta=0", "").replace("1111111111", "3333333333")}`);
    expect(f.readiness().canSearch).toBe(true);
    expect(f.store.marketContext()?.fields.crossregion_identifier).toBe("3333333333");
    // A newer mode record can also be observed, while gameplay remains TCP ordered.
    f.fields(account.replace("hardcore=0", "hardcore=1"));
    const version = f.readiness().contextVersion;
    expect(f.store.marketContext()?.fields.hardcore).toBe("1");
    f.feed(old.subarray(9, 23), { sequence: start + 9 });
    expect(f.store.marketContext()?.fields).toMatchObject({ crossregion_identifier: "3333333333", hardcore: "1" });
    expect(f.readiness().contextVersion).toBe(version);
  });

  test("complete post-gap evidence may span pending packets and cannot be replayed after repair", () => {
    const f = harness(); f.identity();
    const old = frameDiagnosticBody(replayIdentity(), 10), start = f.nextSequence();
    f.feed(old.subarray(0, 9), { sequence: start }); f.feed(old.subarray(23), { sequence: start + 23 });
    const fresh = frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83,
      `${account}&${transient.replace("&beta=0", "").replace("1111111111", "3333333333")}`), 11);
    const freshStart = f.nextSequence();
    f.feed(fresh.subarray(0, 20), { sequence: freshStart });
    expect(f.readiness().canSearch).toBe(false);
    f.feed(fresh.subarray(20), { sequence: freshStart + 20 });
    expect(f.readiness().canSearch).toBe(true);
    const version = f.readiness().contextVersion;
    f.feed(old.subarray(9, 23), { sequence: start + 9 });
    expect(f.readiness().contextVersion).toBe(version);
    expect(f.store.marketContext()?.fields.crossregion_identifier).toBe("3333333333");
  });

  test("unframed, generic-header and malformed API lookalikes beyond a gap cannot recover context", () => {
    const f = harness(); f.identity();
    const old = frameDiagnosticBody(replayIdentity(), 10), start = f.nextSequence();
    f.feed(old.subarray(0, 9), { sequence: start }); f.feed(old.subarray(23), { sequence: start + 23 });
    const text = `${account}&${transient.replace("&beta=0", "")}`;
    const body = requestDiagnosticBody(3, "mailbox/get_mail", 83, text);
    const generic = Buffer.alloc(8 + body.length);
    generic.write("abcd"); generic.writeUInt32LE(body.length, 4); body.copy(generic, 8);
    const invalid = Buffer.from(body); invalid[0] = 4;
    for (const candidate of [Buffer.from(text), generic, frameDiagnosticBody(invalid, 12)]) {
      f.feed(candidate);
      expect(f.readiness().canSearch).toBe(false);
      expect(f.store.marketContext()).toBeNull();
    }
    f.fields(text);
    expect(f.readiness().canSearch).toBe(true);
  });

  test("recovery formed across separate transient records still excludes older unfinished evidence", () => {
    const f = harness(); f.identity();
    const old = frameDiagnosticBody(replayIdentity(), 10), start = f.nextSequence();
    f.feed(old.subarray(0, 9), { sequence: start });
    f.feed(old.subarray(23), { sequence: start + 23 });
    f.fields("unique_account_id=12345678901234567890&beta=0", 6000);
    f.fields("account_id=na-42&crossregion_identifier=3333333333&season=11&hardcore=1&beta=0", 6000);
    expect(f.readiness().canSearch).toBe(true);
    const version = f.readiness().contextVersion;
    f.feed(old.subarray(9, 23), { sequence: start + 9 });
    expect(f.store.marketContext()?.fields).toMatchObject({ crossregion_identifier: "3333333333", hardcore: "1" });
    expect(f.readiness().contextVersion).toBe(version);
  });

  test.each(["inventory", "FIN"])("%s excludes an older healthy-flow fragment without blocking subsequent new records", loss => {
    const f = harness(); f.syncConnections([connection(5000), connection(6000), connection(7000), connection(8000)]);
    f.fields(account, 5000); f.fields(transient, 6000);
    const old = frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, account), 10), start = f.nextSequence();
    f.feed(old.subarray(0, 20), { sequence: start });
    if (loss === "inventory") f.syncConnections([connection(5000), connection(7000), connection(8000)], 3);
    else f.feed(Buffer.alloc(0), { localPort: 6000, flags: 1 });
    f.fields(transient.replace("1111111111", "3333333333"), 7000);
    f.fields(account.replace("hardcore=0", "hardcore=1"), 8000);
    expect(f.readiness().canSearch).toBe(true);
    const version = f.readiness().contextVersion;
    f.feed(old.subarray(20), { sequence: start + 20 });
    expect(f.store.marketContext()?.fields.hardcore).toBe("1");
    expect(f.readiness().contextVersion).toBe(version);
    f.fields(account, 5000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("0");
  });

  test.each(["account-first", "transient-first"])("capture stop/resume recovers unchanged split transports with %s fresh evidence", order => {
    const f = harness(); f.fields(account, 5000); f.fields(transient, 6000); f.stopResume();
    expect(f.readiness().canSearch).toBe(false);
    if (order === "account-first") { f.fields(account, 5000); f.fields(transient, 6000); }
    else { f.fields(transient, 6000); f.fields(account, 5000); }
    expect(f.readiness().canSearch).toBe(true);
    f.fields(account.replace("hardcore=0", "hardcore=1"), 5000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("1");
  });

  test("a proved new process generation admits its new sequence space, restoring only retained account/mode", () => {
    const f = harness(); f.identity(); f.reopen("reopen"); f.processes([43]);
    expect(f.readiness().canSearch).toBe(false);
    f.feed(frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, transient), 10), { sequence: 1, localPort: 6000 });
    expect(f.readiness()).toMatchObject({ canSearch: true, retainedContext: true });
    f.feed(frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, account), 10), { sequence: 1, localPort: 5000 });
    expect(f.readiness()).toMatchObject({ canSearch: true, retainedContext: false });
  });

  test.each(["reopen", "parser-recovery"].flatMap(reason =>
    ["account-first", "transient-first"].map(order => ({ reason: reason as "reopen" | "parser-recovery", order }))))(
    "unscoped $reason invalidates old evidence without retiring continuous flows: $order", async ({ reason, order }) => {
      const f = harness(); f.fields(account, 5000); f.fields(transient, 6000);
      const oldRequest = await dispatch(f);
      f.reopen(reason);
      expect(f.store.marketContext()).toBeNull();
      expect((await f.provider.search(replayMarketRequest)).ok).toBe(false);
      if (order === "account-first") f.fields(account, 5000);
      else f.fields(transient.replace("1111111111", "3333333333"), 6000);
      expect(f.readiness()).toMatchObject({ canSearch: order === "transient-first", retainedContext: order === "transient-first" });
      if (order === "account-first") f.fields(transient.replace("1111111111", "3333333333"), 6000);
      else f.fields(account, 5000);
      expect(f.readiness().canSearch).toBe(true);
      f.fields(account.replace("hardcore=0", "hardcore=1"), 5000);
      expect(f.store.marketContext()?.fields.hardcore).toBe("1");
      oldRequest.worker.emit("message", success);
      expect((await oldRequest.pending).ok).toBe(false);
      expect(oldRequest.worker.terminate).toHaveBeenCalledOnce();
    });

  test.each(["reopen", "parser-recovery"] as const)("%s cannot turn pre-loss retransmissions into fresh evidence", reason => {
    const f = harness(); f.fields(account, 5000); f.fields(transient, 6000);
    const oldAccount = frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, account), 10);
    const oldTransient = frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, transient), 10);
    const aStart = f.nextSequence(5000), bStart = f.nextSequence(6000);
    f.feed(oldAccount.subarray(0, 9), { sequence: aStart, localPort: 5000 });
    f.feed(oldAccount.subarray(23), { sequence: aStart + 23, localPort: 5000 });
    f.feed(oldTransient.subarray(0, 9), { sequence: bStart, localPort: 6000 });
    f.feed(oldTransient.subarray(23), { sequence: bStart + 23, localPort: 6000 });
    f.reopen(reason);
    f.feed(oldAccount, { sequence: aStart, localPort: 5000 });
    f.feed(oldTransient, { sequence: bStart, localPort: 6000 });
    expect(f.store.marketContext()).toBeNull();
    expect(f.readiness().canSearch).toBe(false);
    f.fields(account, 5000); f.fields(transient.replace("1111111111", "3333333333"), 6000);
    expect(f.readiness().canSearch).toBe(true);
  });

  test.each(["account-first", "transient-first"])("post-loss fragmented account evidence remains usable with %s completion", order => {
    const f = harness(); f.fields(account, 5000); f.fields(transient, 6000); f.reopen("reopen");
    const frame = frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, account), 10), start = f.nextSequence();
    f.feed(frame.subarray(0, 20), { sequence: start });
    if (order === "transient-first") f.fields(transient, 6000);
    f.feed(frame.subarray(20), { sequence: start + 20 });
    if (order === "account-first") f.fields(transient, 6000);
    expect(f.readiness().canSearch).toBe(true);
    f.fields(account.replace("hardcore=0", "hardcore=1"), 5000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("1");
    // Loss also leaves B's continuous transport usable for fresh mode evidence.
    f.fields(account, 6000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("0");
    expect(f.store.marketContext()?.fields.crossregion_identifier).toBe("1111111111");
  });

  test.each(["account-first", "transient-first"])("account/identity change on continuous split flows accepts fresh %s evidence", order => {
    const f = harness(); f.fields(account, 5000); f.fields(transient, 6000);
    const nextAccount = account.replace("na-42", "na-99"), nextTransient = transient.replace("12345678901234567890", "NEW-UID");
    if (order === "account-first") { f.fields(nextAccount, 5000); f.fields(nextTransient, 6000); }
    else { f.fields(nextTransient, 6000); f.fields(nextAccount, 5000); }
    expect(f.readiness().canSearch).toBe(true);
    expect(f.store.marketContext()?.fields).toMatchObject({ account_id: "na-99", unique_account_id: "NEW-UID" });
    f.fields(nextAccount.replace("hardcore=0", "hardcore=1"), 5000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("1");
  });

  test.each([{ truncated: true }, { shorten: 1 }])("recognized incomplete packet invalidates credentials/readiness and blocks dispatch: %j", async loss => {
    const f = harness(); f.identity();
    expect(f.readiness()).toMatchObject({ phase: "ready", canSearch: true });
    f.feed(frameDiagnosticBody(replayIdentity(), 10), loss);
    expect(f.store.marketContext()).toBeNull();
    expect(f.readiness().canSearch).toBe(false);
    expect((await f.provider.search(replayMarketRequest)).ok).toBe(false);
    expect(workers).toHaveLength(0);
  });

  test("missing TCP bytes suspend dispatch until a complete newly reconstructed context arrives", async () => {
    const f = harness(); f.identity();
    const frame = frameDiagnosticBody(replayIdentity(), 10), start = f.nextSequence();
    f.feed(frame.subarray(0, 9), { sequence: start });
    f.feed(frame.subarray(23), { sequence: start + 23 });
    expect(f.store.marketContext()).toBeNull();
    expect((await f.provider.search(replayMarketRequest)).ok).toBe(false);
    expect(workers).toHaveLength(0);
    f.feed(frame.subarray(9, 23), { sequence: start + 9 });
    expect(f.readiness()).toMatchObject({ phase: "ready", canSearch: true });
    const { pending, worker } = await dispatch(f); worker.emit("message", success);
    expect((await pending).ok).toBe(true);
  });

  test("loss cancels an in-flight worker and a late old response cannot restore results or readiness", async () => {
    const f = harness(); f.identity(); const { pending, worker } = await dispatch(f);
    f.feed(frameDiagnosticBody(replayIdentity(), 10), { truncated: true });
    worker.emit("message", success);
    expect((await pending).ok).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(f.readiness().canSearch).toBe(false);
  });

  test("normal complete capture, cache reuse and identical evidence renewal remain usable", async () => {
    const f = harness(); f.identity(); const version = f.readiness().contextVersion;
    const { pending, worker } = await dispatch(f); worker.emit("message", success);
    expect(await pending).toMatchObject({ ok: true, cached: false });
    f.identity(); expect(f.readiness().contextVersion).toBe(version);
    expect(await f.provider.search(replayMarketRequest)).toMatchObject({ ok: true, cached: true });
    expect(workers).toHaveLength(1);
  });

  test("partial post-loss observations and public metadata cannot revive old credentials; complete fresh evidence recovers automatically", async () => {
    const f = harness(); f.identity(); const originalVersion = f.readiness().contextVersion!;
    f.feed(frameDiagnosticBody(replayIdentity(), 10), { truncated: true });
    f.store.applyRegionDirectory(new MarketRegionDirectory([{ address: replayScope.remoteAddress, port: replayScope.remotePort, beta: "0", region: "na" }]));
    expect(f.store.marketContext()).toBeNull();
    f.fields("account_id=na-42&unique_account_id=12345678901234567890&beta=0");
    expect(f.store.marketContext()).toBeNull();
    expect(f.readiness()).toMatchObject({ reason: "observation_gap", canSearch: false });
    expect(f.readiness().missingFields).toEqual(["crossregion_identifier", "season", "hardcore"]);
    expect((await f.provider.search(replayMarketRequest)).ok).toBe(false);
    f.fields("unique_account_id=12345678901234567890&crossregion_identifier=3333333333&season=11&hardcore=0&beta=0");
    expect(f.readiness()).toMatchObject({ phase: "ready", canSearch: true });
    expect(f.readiness().contextVersion).toBeGreaterThan(originalVersion);
    expect(f.store.marketContext()?.fields.crossregion_identifier).toBe("3333333333");
  });

  test("a same-account replacement flow discards old transient credentials and ignores late retired-flow packets", async () => {
    const f = harness(); f.identity();
    f.syncConnections([connection(6000)]);
    expect(f.store.marketContext()).toBeNull();
    f.fields("account_id=na-42&unique_account_id=12345678901234567890&beta=0", 6000);
    expect(f.readiness().canSearch).toBe(false);
    f.identity(5000); // Still admitted during capture's three-second grace, but no longer a current game flow.
    expect(f.readiness().canSearch).toBe(false);
    f.identity(6000);
    expect(f.readiness()).toMatchObject({ phase: "ready", canSearch: true });
    const { pending, worker } = await dispatch(f); worker.emit("message", success);
    expect((await pending).ok).toBe(true);
  });

  test.each([1, 4, 2])("TCP boundary flag %s invalidates the old context before a reused tuple can recover", flags => {
    const f = harness(); f.identity();
    f.feed(Buffer.alloc(0), { flags, sequence: 900 });
    expect(f.readiness().canSearch).toBe(false);
    if (flags !== 2) {
      f.identity(); expect(f.readiness().canSearch).toBe(false);
      f.feed(Buffer.alloc(0), { flags: 2, sequence: 1000 });
    }
    f.identity(); expect(f.readiness().canSearch).toBe(true);
  });

  test("an account switch cannot combine fresh partial identity with old mode/session or accept an old worker result", async () => {
    const f = harness(); f.identity(); const { pending, worker } = await dispatch(f);
    f.fields("account_id=na-99&unique_account_id=NEW-UID&beta=0", 6000);
    expect(f.store.marketContext()).toBeNull();
    worker.emit("message", success); expect((await pending).ok).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
    f.fields("account_id=na-99&unique_account_id=NEW-UID&crossregion_identifier=NEW-SESSION&season=12&hardcore=1&beta=0", 6000);
    expect(f.readiness().canSearch).toBe(true);
    expect(f.store.marketContext()?.fields).toMatchObject({ account_id: "na-99", hardcore: "1", season: "12" });
  });

  test("late reassembly from the interrupted old flow cannot replace a fresh account on another flow", () => {
    const f = harness(); f.identity();
    const old = frameDiagnosticBody(replayIdentity(), 10), start = f.nextSequence();
    f.feed(old.subarray(0, 9), { sequence: start });
    f.feed(old.subarray(23), { sequence: start + 23 });
    expect(f.readiness().canSearch).toBe(false);
    f.fields("account_id=na-99&unique_account_id=NEW-UID&crossregion_identifier=NEW-SESSION&season=12&hardcore=1&beta=0", 6000);
    const version = f.readiness().contextVersion;
    expect(f.store.marketContext()?.fields.account_id).toBe("na-99");
    f.feed(old.subarray(9, 23), { sequence: start + 9 });
    expect(f.store.marketContext()?.fields.account_id).toBe("na-99");
    expect(f.readiness().contextVersion).toBe(version);
  });

  test.each(["packet-loss", "connection-loss"].flatMap(loss =>
    ["account-first", "transient-first"].map(order => ({ loss, order }))))("healthy account flow survives $loss with $order recovery", async ({ loss, order }) => {
    const f = harness();
    const account = "account_id=na-42&season=11&hardcore=0&beta=0";
    const transient = "unique_account_id=12345678901234567890&crossregion_identifier=1111111111&beta=0";
    f.fields(account, 5000); f.fields(transient, 6000);
    expect(f.readiness().canSearch).toBe(true);
    if (loss === "packet-loss") {
      f.feed(frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, transient), 11), { localPort: 6000, truncated: true });
    } else {
      f.syncConnections([connection(5000)]);
      f.syncConnections([connection(5000), connection(6000)]);
    }
    expect(f.readiness().canSearch).toBe(false);
    expect((await f.provider.search(replayMarketRequest)).ok).toBe(false);
    const freshTransient = transient.replace("1111111111", "3333333333");
    if (order === "account-first") f.fields(account, 5000);
    else f.fields(freshTransient, 6000);
    // Fresh matching credentials restore retained account/mode; account evidence alone cannot.
    expect(f.readiness()).toMatchObject({ canSearch: order === "transient-first", retainedContext: order === "transient-first" });
    if (order === "account-first") {
      expect((await f.provider.search(replayMarketRequest)).ok).toBe(false);
      expect(workers).toHaveLength(0);
    }
    if (order === "account-first") f.fields(freshTransient, 6000);
    else f.fields(account, 5000);
    expect(f.readiness()).toMatchObject({ phase: "ready", canSearch: true });
    expect(f.store.marketContext()?.fields).toMatchObject({ account_id: "na-42", crossregion_identifier: "3333333333", season: "11", hardcore: "0" });
    // The healthy continuous source must also accept later normal mode evidence.
    f.fields(account.replace("hardcore=0", "hardcore=1"), 5000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("1");
    const { pending, worker } = await dispatch(f); worker.emit("message", success);
    expect((await pending).ok).toBe(true);
  });

  test.each(["account-first", "transient-first"])("healthy source remains usable and late interrupted reassembly stays rejected after %s replacement recovery", async order => {
    const f = harness();
    f.syncConnections([connection(5000), connection(6000), connection(7000)]);
    const account = "account_id=na-42&season=11&hardcore=0&beta=0";
    const transient = "unique_account_id=12345678901234567890&crossregion_identifier=1111111111&beta=0";
    f.fields(account, 5000); f.fields(transient, 6000);
    const oldRequest = await dispatch(f);
    const oldFrame = frameDiagnosticBody(requestDiagnosticBody(3, "mailbox/get_mail", 83, transient), 11);
    const start = f.nextSequence(6000);
    f.feed(oldFrame.subarray(0, 9), { localPort: 6000, sequence: start });
    f.feed(oldFrame.subarray(23), { localPort: 6000, sequence: start + 23 });
    expect(f.readiness().canSearch).toBe(false);
    const freshTransient = transient.replace("1111111111", "3333333333");
    if (order === "account-first") f.fields(account, 5000);
    else f.fields(freshTransient, 7000);
    expect(f.readiness()).toMatchObject({ canSearch: order === "transient-first", retainedContext: order === "transient-first" });
    if (order === "account-first") f.fields(freshTransient, 7000);
    else f.fields(account, 5000);
    expect(f.readiness().canSearch).toBe(true);
    const version = f.readiness().contextVersion;
    // B remains in the inventory: reject its old record without retiring its transport.
    f.feed(oldFrame.subarray(9, 23), { localPort: 6000, sequence: start + 9 });
    oldRequest.worker.emit("message", success);
    expect((await oldRequest.pending).ok).toBe(false);
    expect(oldRequest.worker.terminate).toHaveBeenCalledOnce();
    expect(f.readiness()).toMatchObject({ phase: "ready", canSearch: true, contextVersion: version });
    expect(f.store.marketContext()?.fields.crossregion_identifier).toBe("3333333333");
    f.fields(account.replace("hardcore=0", "hardcore=1"), 5000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("1");
    // The discarded record does not permanently retire B's still-open transport.
    f.fields(account, 6000);
    expect(f.store.marketContext()?.fields.hardcore).toBe("0");
    expect(f.store.marketContext()?.fields.crossregion_identifier).toBe("3333333333");
  });

  test("old cache and in-flight results cannot survive loss even when fresh context values are identical", async () => {
    const f = harness(); f.identity(); const { pending, worker } = await dispatch(f);
    f.feed(frameDiagnosticBody(replayIdentity(), 10), { truncated: true });
    f.identity(); expect(f.readiness().canSearch).toBe(true);
    worker.emit("message", success); expect((await pending).ok).toBe(false);
    // The real network cooldown is preserved across invalidation, even after recovery.
    expect(await f.provider.search(replayMarketRequest)).toMatchObject({ ok: false, errorCode: "search_pending" });
    await vi.advanceTimersByTimeAsync(15_000);
    const fresh = await dispatch(f); expect(workers).toHaveLength(2); fresh.worker.emit("message", success);
    expect(await fresh.pending).toMatchObject({ ok: true, cached: false });
  });

  test("loss on a proved unrelated flow preserves the continuous context and in-flight request", async () => {
    const f = harness(); f.identity(); const version = f.readiness().contextVersion;
    const { pending, worker } = await dispatch(f);
    f.feed(frameDiagnosticBody(replayIdentity(), 10), { localPort: 6000, truncated: true });
    expect(f.readiness()).toMatchObject({ phase: "ready", canSearch: true, contextVersion: version });
    expect(worker.terminate).not.toHaveBeenCalled(); worker.emit("message", success);
    expect((await pending).ok).toBe(true);
  });

  test("session evidence captured on an admitted game port also loses trust on truncation", async () => {
    const f = harness(26921); f.identity(); expect(f.readiness().canSearch).toBe(true);
    f.feed(frameDiagnosticBody(replayIdentity(), 10), { truncated: true });
    expect(f.store.marketContext()).toBeNull();
    expect((await f.provider.search(replayMarketRequest)).ok).toBe(false); expect(workers).toHaveLength(0);
  });

  test.each([{ observationGap: true as const }, { status: "error" as const }, { running: false },
    { running: false, observationGapFlow: { src: replayScope.localAddress, srcPort: 6000, dst: replayScope.remoteAddress, dstPort: replayScope.remotePort } },
    { status: "error" as const, observationGapFlow: { src: replayScope.localAddress, srcPort: 6000, dst: replayScope.remoteAddress, dstPort: replayScope.remotePort } },
  ])("capture interruption %j requires newly observed context after capture resumes", async update => {
    const f = harness(); f.identity(); f.update(update); f.update({ running: true });
    expect(f.readiness().canSearch).toBe(false);
    expect((await f.provider.search(replayMarketRequest)).ok).toBe(false);
    f.identity(); expect(f.readiness().canSearch).toBe(true);
  });
});
