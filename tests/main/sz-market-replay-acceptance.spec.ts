import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CapturedSessionContextStore } from "../../src/main/captured-session-context";
import type { HeroSiegeNetworkState } from "../../src/main/capture-network";
import { DirectMarketSearchProvider } from "../../src/main/direct-market-search-provider";
import { InitializedSatanicZoneRefreshProvider } from "../../src/main/initialized-satanic-zone-provider";
import { buildDirectMarketRequestBody } from "../../src/main/market-direct-search-worker";
import { inspectDirectMarketResponse } from "../../src/main/market-direct-response";
import { MarketReadinessController } from "../../src/main/market-readiness-controller";
import { getTcpSegment, PacketBuffers, type ParsedPayload } from "../../src/main/packet-decoder";
import { SatanicZoneController } from "../../src/main/satanic-zone-controller";
import { runInitializedSatanicZoneProbe } from "../../src/main/satanic-zone-initialized-transport";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { EVENT_NAMES } from "../../src/shared/constants";
import { createInitialCompanionState } from "../../src/shared/initial-state";
import { captureMessages, messageToEvents, type SatanicZoneInfo } from "../../src/shared/parser";
import { frameDiagnosticBody } from "../fixtures/satanic-zone-diagnostic-frames";
import { genericProbeFrame, inventedZoneBody } from "../fixtures/satanic-zone-initialized";
import { evidence, fragmentedFrame, replayAck, replayChecksumRejection, replayIdentity, replayInitialization, replayLogin,
  replayMarketIdentifier, replayMarketRequest, replayOwnedIdentifier, replayPacket, replayScope, type ReplaySegment } from "../fixtures/network-replay";

const launch = vi.hoisted(() => ({ steam: vi.fn(), executable: vi.fn() }));
vi.mock("electron", () => ({ shell: { openExternal: launch.steam, openPath: launch.executable } }));
import { GameCaptureCoordinator } from "../../src/main/game-capture-coordinator";

async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
class ReplaySocket extends EventEmitter {
  localAddress = replayScope.localAddress; localPort = 6000;
  remoteAddress = replayScope.remoteAddress; remotePort = replayScope.remotePort;
  writes: Buffer[] = [];
  connect(_port: number, _address: string, connected: () => void) { connected(); return this; }
  write(frame: Buffer, done: () => void) { this.writes.push(Buffer.from(frame)); done(); return true; }
  destroy = vi.fn(() => this);
  receive(body: Buffer) {
    const frame = genericProbeFrame(body);
    // Actual owned socket framing/reassembly consumes split data events.
    this.emit("data", frame.subarray(0, 5)); this.emit("data", frame.subarray(5));
  }
}

const cleanups: (() => void)[] = [];
const cachePassphrase = "SYNTHETIC evidence replay passphrase";
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); launch.steam.mockReset(); vi.useRealTimers(); });

/** Real decoder, reassembly, stores/controllers and owned transport; only platform I/O is replaced. */
function harness(file?: string, gameplayCapture = true) {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse("2026-10-06T21:52:00Z"));
  const network: HeroSiegeNetworkState = { gameProcessIds: [], antiCheatProcessIds: [], connections: [] };
  const sockets: ReplaySocket[] = [], packets = new PacketBuffers(), events: string[] = [];
  let receive: ((packet: ParsedPayload, truncated: boolean) => void) | undefined, zone: SatanicZoneController;
  const cache = file ? new SatanicZoneLoginCache({ store: new SatanicZoneLoginCacheStore(file),
    networkState: async () => network, onChange: () => provider.cacheChanged() }) : undefined;
  const provider = new InitializedSatanicZoneRefreshProvider({ canPrepare: () => true, loginCache: cache,
    onPreparation: next => zone?.setPreparation(next), dependencies: {
      prepare: async () => replayScope, networkState: async () => network,
      open: async (_scope, callback) => { events.push("listener-open"); receive = callback;
        return { close: () => { receive = undefined; } }; },
      attempt: (input, signal, budget, progress) => {
        const socket = new ReplaySocket(); sockets.push(socket);
        return runInitializedSatanicZoneProbe(input, signal, budget, progress, () => socket as unknown as net.Socket);
      },
    } });
  zone = new SatanicZoneController({ provider, onStateChange: () => undefined });
  const context = new CapturedSessionContextStore();
  const marketStates: unknown[] = [];
  const marketReadiness = new MarketReadinessController(context, next => marketStates.push(next));
  marketReadiness.setCaptureRunning(true);
  cache?.configure(true);

  function game(localPort = 5000) {
    network.gameProcessIds = [42]; network.connections = [{ ...replayScope, localPort, owningProcess: 42, state: "established" }];
    context.observeGameProcessIds([42]); provider.observeProcessIds([42]); provider.observeConnections(network.connections);
  }
  function feed(segment: ReplaySegment, localPort = 5000) {
    const bytes = replayPacket(segment, localPort);
    const packet = getTcpSegment(bytes, bytes.length, evidence.passiveZone.linkType)!;
    expect(packet).not.toBeNull();
    if ((packet.flags & 2) !== 0 && segment.outbound) { events.push("first-syn"); packets.clear(); }
    if (gameplayCapture) provider.observeTcpLifecycle(packet);
    receive?.(packet, false);
    if (!gameplayCapture) return;
    if (!packet.payloadLength) return;
    for (const complete of packets.push(packet)) {
      const outbound = complete.packet.src === replayScope.localAddress;
      const payload = { text: complete.text, direction: outbound ? "outbound" as const : "inbound" as const,
        remoteAddress: replayScope.remoteAddress, remotePort: replayScope.remotePort, localAddress: replayScope.localAddress,
        localPort, observedAt: Date.now() };
      context.observe(payload); provider.observeSessionPayload(payload);
      if (complete.observationOnly) continue;
      for (const event of messageToEvents(captureMessages(complete.text))) {
        if (event.name === EVENT_NAMES.satanicZone) zone.observePassiveResponse(event.value as SatanicZoneInfo);
      }
    }
  }
  async function initialize(localPort = 5000, omitFragment = false) {
    game(localPort);
    const segments = replayInitialization();
    segments.forEach((segment, index) => { if (!omitFragment || index !== 3) feed(segment, localPort); });
    await vi.advanceTimersByTimeAsync(1_000); await flush();
  }
  async function refresh() {
    const pending = zone.refreshNow(); await flush();
    const socket = sockets.at(-1)!; socket.receive(replayAck); await flush(); socket.receive(replayLogin());
    const result = await pending; expect(result.accepted).toBe(true);
    socket.receive(inventedZoneBody); await flush();
    expect(zone.getState()).toMatchObject({ source: "manual", phase: "current", current: { rawZone: "Act_04_03" } });
    expect(socket.writes.at(-1)!.toString()).toContain(`crossregion_identifier=${replayOwnedIdentifier}`);
    return socket;
  }
  function dispose() { zone.dispose(); provider.dispose(); marketReadiness.dispose(); context.dispose(); packets.clear(); }
  cleanups.push(dispose);
  return { provider, zone, context, cache, sockets, events, network, marketStates, feed, game, initialize, refresh, dispose,
    startGameplayCapture: () => { gameplayCapture = true; } };
}

describe("evidence-backed SZ/Market journey replay with substituted bytes", () => {
  test("HSC opens the listener before the invented first SYN and reaches Ready without sending before gameplay capture starts", async () => {
    const f = harness(undefined, false), state = createInitialCompanionState();
    const service = { hasHeroSiegeProcess: async () => false, start: vi.fn(() => f.startGameplayCapture()) };
    launch.steam.mockImplementation(async () => { expect(f.events).toEqual(["listener-open"]); await f.initialize(); });
    const coordinator = new GameCaptureCoordinator({ state, getCaptureService: () => service as never,
      beforeCapture: () => f.provider.preparePassively(), addLog: vi.fn(), publishState: vi.fn(), writeAppLog: vi.fn() });
    await coordinator.launchOrCapture({ launchThroughSteam: true });
    expect(f.events.indexOf("listener-open")).toBeLessThan(f.events.indexOf("first-syn"));
    expect(f.provider.preparation.phase).toBe("ready");
    expect(f.zone.getState()).toMatchObject({ source: "captured", current: { rawZone: "Act_04_03" }, refreshAvailable: true });
    expect(f.sockets).toHaveLength(0); expect(service.start).not.toHaveBeenCalled();
    await f.refresh(); expect(f.sockets).toHaveLength(1); coordinator.clearLaunchCaptureTimer();
  });

  test("initial passive SZ arrives while only the private API listener is open", async () => {
    const f = harness(undefined, false); await f.provider.preparePassively(); await f.initialize();
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0);
    expect(f.zone.getState().current?.rawZone).toBe("Act_04_03");
  });

  test("native passive SZ after Ready uses bounded reassembly and never requires an explicit request", async () => {
    const f = harness(undefined, false); await f.provider.preparePassively(); await f.initialize();
    const previous = replayInitialization().at(-1)!;
    const frame = genericProbeFrame(Buffer.from('{"satanicZoneName":"Act_01_01","buffs":"","debuffs":""}'));
    fragmentedFrame(false, previous.sequence + previous.payload.length, frame).forEach(segment => f.feed(segment));
    expect(f.zone.getState()).toMatchObject({ source: "captured", current: { rawZone: "Act_01_01" } });
    expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0);
  });

  test("native passive SZ during manual Refresh updates display but cannot complete the owned request", async () => {
    const f = harness(undefined, false); await f.provider.preparePassively(); await f.initialize();
    const pending = f.zone.refreshNow(); await flush(); const socket = f.sockets[0];
    socket.receive(replayAck); await flush(); socket.receive(replayLogin());
    expect((await pending).accepted).toBe(true); await flush();
    const previous = replayInitialization().at(-1)!;
    const frame = genericProbeFrame(Buffer.from('{"satanicZoneName":"Act_01_01","buffs":"","debuffs":""}'));
    fragmentedFrame(false, previous.sequence + previous.payload.length, frame).forEach(segment => f.feed(segment)); await flush();
    expect(f.zone.getState()).toMatchObject({ phase: "refreshing", source: "captured", current: { rawZone: "Act_01_01" } });
    expect(socket.destroy).not.toHaveBeenCalled(); expect(f.sockets).toHaveLength(1);
    socket.receive(inventedZoneBody); await flush();
    expect(f.zone.getState()).toMatchObject({ phase: "current", source: "manual", current: { rawZone: "Act_04_03" } });
  });

  test("another local socket and a blind interval cannot supply a passive native observation", async () => {
    const f = harness(undefined, false); await f.provider.preparePassively(); await f.initialize();
    const before = f.zone.getState(), previous = replayInitialization().at(-1)!;
    const frame = genericProbeFrame(Buffer.from('{"satanicZoneName":"Act_01_01","buffs":"","debuffs":""}'));
    f.feed({ outbound: false, sequence: previous.sequence + previous.payload.length, payload: frame, flags: 24 }, 6000);
    expect(f.zone.getState()).toEqual(before);
    f.provider.observeCaptureUpdate({ observationGap: true }, true);
    await f.provider.preparePassively(); await flush();
    f.feed({ outbound: false, sequence: previous.sequence + previous.payload.length, payload: frame, flags: 24 });
    expect(f.zone.getState().current).toEqual(before.current); expect(f.zone.getState().lastSuccessAt).toBe(before.lastSuccessAt);
    expect(f.provider.preparation.phase).not.toBe("ready"); expect(f.sockets).toHaveLength(0);
  });

  test("late Companion cannot recover missed login; simulated new initialization after the reported vote reset allows explicit Refresh", async () => {
    const f = harness(); f.game(); await f.provider.preparePassively();
    expect(f.provider.preparation.reason).toBe("login_missed");
    f.feed(replayInitialization().at(-1)!);
    expect(f.zone.getState().current?.rawZone).toBe("Act_04_03");
    expect((await f.zone.refreshNow()).accepted).toBe(false); expect(f.sockets).toHaveLength(0);
    await f.initialize(5001); expect(f.provider.preparation.phase).toBe("ready"); expect(f.sockets).toHaveLength(0);
    await f.refresh(); await vi.advanceTimersByTimeAsync(31_000); await f.refresh(); expect(f.sockets).toHaveLength(2);
  });

  test("remembered invented pair survives Companion disposal and unlock permits Refresh without new identity", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-evidence-replay-")), file = path.join(directory, "login.encrypted");
    expect(path.dirname(fs.realpathSync(directory))).toBe(fs.realpathSync(os.tmpdir()));
    cleanups.unshift(() => fs.rmSync(directory, { recursive: true, force: true }));
    const original = harness(file); expect(await original.cache!.unlock(cachePassphrase)).toBe(true);
    await original.provider.preparePassively(); await original.initialize(); await flush();
    expect(original.cache!.snapshot().status).toBe("saved"); expect(fs.existsSync(file)).toBe(true);
    expect(original.sockets).toHaveLength(0); original.dispose();
    const restored = harness(file); restored.game(); await restored.provider.preparePassively();
    expect(restored.cache!.snapshot().status).toBe("locked"); expect((await restored.zone.refreshNow()).accepted).toBe(false);
    expect(restored.sockets).toHaveLength(0); expect(await restored.cache!.unlock(cachePassphrase)).toBe(true);
    expect(restored.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
    expect(restored.sockets).toHaveLength(0);
    const frame = frameDiagnosticBody(replayIdentity(), 10);
    restored.feed({ outbound: true, sequence: 9000, payload: frame.subarray(0, 9), flags: 24 }); await flush();
    expect(restored.provider.preparation.phase).toBe("ready");
    restored.feed({ outbound: true, sequence: 9009, payload: frame.subarray(9), flags: 24 }); await flush();
    expect(restored.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
    expect(restored.sockets).toHaveLength(0); await restored.refresh();
  });

  test.each(["no saved pair", "no fresh identity", "fresh UID without beta"])("cache reopen with %s distinguishes missing saved material from unnecessary identity evidence", async missing => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-evidence-cache-gap-")), file = path.join(directory, "login.encrypted");
    expect(path.dirname(fs.realpathSync(directory))).toBe(fs.realpathSync(os.tmpdir()));
    cleanups.unshift(() => fs.rmSync(directory, { recursive: true, force: true }));
    const original = harness(file);
    expect(await original.cache!.unlock(cachePassphrase)).toBe(true);
    if (missing !== "no saved pair") {
      await original.provider.preparePassively(); await original.initialize(); await flush();
      expect(original.cache!.snapshot().status).toBe("saved");
    }
    original.dispose(); const restored = harness(file); expect(await restored.cache!.unlock(cachePassphrase)).toBe(true);
    restored.game(); await restored.provider.preparePassively();
    if (missing !== "no fresh identity") {
      const identity = missing === "fresh UID without beta" ? Buffer.from(replayIdentity().toString().replace("&beta=0", "")) : replayIdentity();
      restored.feed({ outbound: true, sequence: 9000, payload: frameDiagnosticBody(identity, 10), flags: 24 }); await flush();
    }
    if (missing === "no saved pair") {
      expect(restored.provider.preparation.phase).not.toBe("ready"); expect(restored.provider.preparation.reason).toBe("cache_empty");
      expect((await restored.zone.refreshNow()).accepted).toBe(false);
    } else expect(restored.provider.preparation).toMatchObject({ phase: "ready", origin: "cached" });
    expect(restored.sockets).toHaveLength(0);
  });

  test.each(["same Companion", "reopened Companion"])("SZ then Market in %s keeps context separate and exposes the observed rejection category", async journey => {
    let f = harness(); await f.provider.preparePassively(); await f.initialize();
    const before = f.context.marketContext()!; expect(before.fields.crossregion_identifier).toBe(replayMarketIdentifier);
    await f.refresh(); expect(f.context.marketContext()).toEqual(before);
    if (journey === "reopened Companion") {
      f.dispose(); f = harness(); f.game(); await f.provider.preparePassively();
      f.feed({ outbound: true, sequence: 9000, payload: frameDiagnosticBody(replayIdentity(), 10), flags: 24 }); await flush();
      expect(f.context.marketReadiness()).toMatchObject({ phase: "ready", missingFields: [] });
      expect(f.provider.preparation.phase).not.toBe("ready"); // Market fields cannot invent an uncached native initialization.
      expect(f.sockets).toHaveLength(0);
    }
    const marketContext = f.context.marketContext()!, preparation = f.provider.preparation.phase;
    const forms: URLSearchParams[] = [];
    const market = new DirectMarketSearchProvider(f.context, vi.fn(), undefined, undefined, Date.now,
      async (context, request) => { forms.push(new URLSearchParams(buildDirectMarketRequestBody(context, request)));
        return inspectDirectMarketResponse(replayChecksumRejection, evidence.marketRejection.httpStatus); });
    for (let attempt = 0; attempt < evidence.marketRejection.attempts; attempt++) {
      expect(await market.search(replayMarketRequest)).toMatchObject({ ok: false, errorCode: "checksum_rejected" });
      await vi.advanceTimersByTimeAsync(16_000);
    }
    expect(forms).toHaveLength(3); expect(forms[0].get("crossregion_identifier")).toBe(replayMarketIdentifier);
    expect(forms[0].get("filter_masks")).toBe(evidence.marketSearch.publicFields.filter_masks);
    expect(forms[0].get("item_sort")).toBe("2"); // Product selects lowest price; observed native default was 0.
    expect(f.context.marketContext()).toEqual(marketContext); expect(f.provider.preparation.phase).toBe(preparation);
    if (journey === "same Companion") {
      expect(f.zone.getState()).toMatchObject({ source: "manual", current: { rawZone: "Act_04_03" } });
      expect(f.sockets).toHaveLength(1);
    } else expect(f.sockets).toHaveLength(0);
    market.dispose();
  });

  test("a missing TCP fragment permits passive SZ display but cannot invent complete initialization or send", async () => {
    const f = harness(); await f.provider.preparePassively(); await f.initialize(5000, true);
    expect(f.zone.getState().current?.rawZone).toBe("Act_04_03");
    expect(f.provider.preparation.phase).not.toBe("ready");
    expect((await f.zone.refreshNow()).accepted).toBe(false); expect(f.sockets).toHaveLength(0);
  });
});
