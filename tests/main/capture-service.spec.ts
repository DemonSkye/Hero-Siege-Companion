import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CaptureService, type CaptureUpdate } from "../../src/main/capture";
import type { ParsedPayload } from "../../src/main/packet-decoder";
import type { CaptureConnection } from "../../src/shared/app-state";
import { EVENT_NAMES } from "../../src/shared/constants";
import type { MessageValue } from "../../src/shared/fields";
import type { ParsedEvent } from "../../src/shared/parser";

const mocks = vi.hoisted(() => ({
  closeCapture: vi.fn(),
  findNpcapDevice: vi.fn(),
  getHeroSiegeNetworkState: vi.fn(),
  getNpcapRegistry: vi.fn(),
  getNpcapServiceStatus: vi.fn(),
  listNpcapDevices: vi.fn(),
  openPacketCapture: vi.fn(),
}));

vi.mock("../../src/main/capture-adapter", () => ({
  findNpcapDevice: mocks.findNpcapDevice,
  listNpcapDevices: mocks.listNpcapDevices,
  openPacketCapture: mocks.openPacketCapture,
}));

vi.mock("../../src/main/capture-network", () => ({
  captureConnectionFlowKey: (connection: CaptureConnection) =>
    `${connection.localAddress}:${connection.localPort}->${connection.remoteAddress}:${connection.remotePort}`,
  capturePacketFlowKey: (packet: ParsedPayload, localAddress: string) =>
    packet.src === localAddress
      ? `${packet.src}:${packet.srcPort}->${packet.dst}:${packet.dstPort}`
      : packet.dst === localAddress
        ? `${packet.dst}:${packet.dstPort}->${packet.src}:${packet.srcPort}`
        : null,
  connectionSignature: (connections: CaptureConnection[]) =>
    connections.map((connection) => `${connection.localAddress}->${connection.remoteAddress}:${connection.remotePort}`).join("|"),
  getHeroSiegeNetworkState: mocks.getHeroSiegeNetworkState,
  getNpcapRegistry: mocks.getNpcapRegistry,
  getNpcapServiceStatus: mocks.getNpcapServiceStatus,
  refreshRetainedCaptureTargets: (
    retainedTargets: Map<string, { target: { remoteAddress: string; remotePort: number }; expiresAt: number }>,
    connections: CaptureConnection[],
    now: number,
    graceMs: number,
  ) => {
    for (const connection of connections) {
      const target = { remoteAddress: connection.remoteAddress, remotePort: connection.remotePort };
      retainedTargets.set(`${target.remoteAddress}:${target.remotePort}`, { target, expiresAt: now + graceMs });
    }
    for (const [key, retained] of retainedTargets.entries()) {
      if (retained.expiresAt <= now) retainedTargets.delete(key);
    }
    return Array.from(retainedTargets.values(), ({ target }) => target);
  },
  selectGameServerConnections: (connections: CaptureConnection[]) => connections.filter((connection) => ![80, 443].includes(connection.remotePort)),
  stableCaptureFilter: (localAddress: string, targets: Array<{ remoteAddress: string; remotePort: number }> = []) =>
    `tcp and host ${localAddress} + targets:${targets.map((target) => `${target.remoteAddress}:${target.remotePort}`).join(",")}`,
  summarizeConnections: (connections: CaptureConnection[]) => connections,
  uniqueCaptureTargets: (connections: CaptureConnection[]) =>
    connections.map((connection) => ({ remoteAddress: connection.remoteAddress, remotePort: connection.remotePort })),
}));

interface RefreshableCaptureService {
  refreshCaptureSafely(source: string): Promise<void>;
}

interface LifecycleCaptureService extends RefreshableCaptureService {
  writeDiagnosticHeartbeat(): void;
}

interface CaptureFlowService {
  activeLocalAddress: string;
  refreshCaptureFlows(connections: CaptureConnection[], now?: number): void;
  isCaptureFlowPacket(packet: ParsedPayload, now?: number): boolean;
}

interface ParserFailureCaptureService {
  recordParserFailure(stage: string, error: unknown, payloadText: string): void;
}

interface WideDebugCaptureService {
  writeWidePacketLog(packet: ParsedPayload, nbytes: number, truncated: boolean): void;
  writeWidePayloadLog(packet: ParsedPayload, payloadText: string): void;
}

interface SatanicZoneDiagnosticCaptureService {
  activeLocalAddress: string;
  activeSignature: string;
  recordEndpointTraffic(packet: ParsedPayload, kind: "packet" | "payload"): void;
  probeSatanicZonePayload(packet: ParsedPayload, payloadText: string, messages: MessageValue[], events: ParsedEvent[]): void;
}

interface ParsedEventDebugCaptureService {
  payloadsAssembled: number;
  messagesDecoded: number;
  parsedEvents: number;
  writeParsedEventDebugLog(events: ParsedEvent[], totalEvents: number): void;
}

interface PacketProcessingCaptureService {
  activeLocalAddress: string;
  activeLinkType: string;
  buffer: Buffer;
  packetBuffers: { push(packet: ParsedPayload): unknown };
  refreshCaptureFlows(connections: CaptureConnection[], now?: number): void;
  processPacket(nbytes: number, truncated: boolean): void;
}

let tempDir = "";

function connection(overrides: Partial<CaptureConnection> = {}): CaptureConnection {
  return {
    owningProcess: 123,
    state: "Established",
    localAddress: "10.0.0.2",
    localPort: 50000,
    remoteAddress: "203.0.113.10",
    remotePort: 26921,
    ...overrides,
  };
}

function packet(overrides: Partial<ParsedPayload> = {}): ParsedPayload {
  return {
    src: "10.0.0.2",
    srcPort: 50000,
    dst: "203.0.113.10",
    dstPort: 26921,
    seq: 1,
    ack: 10,
    flags: 0x18,
    payloadLength: 90,
    payload: Buffer.alloc(90),
    text: "",
    ...overrides,
  };
}

function rawTcpPacket(payloadValue: string | Buffer, seq = 1): Buffer {
  const payload = typeof payloadValue === "string" ? Buffer.from(payloadValue, "utf8") : payloadValue;
  const packetBuffer = Buffer.alloc(40 + payload.length);
  packetBuffer[0] = 0x45;
  packetBuffer.writeUInt16BE(packetBuffer.length, 2);
  packetBuffer[8] = 64;
  packetBuffer[9] = 6;
  packetBuffer.set([10, 0, 0, 2], 12);
  packetBuffer.set([203, 0, 113, 10], 16);
  packetBuffer.writeUInt16BE(50000, 20);
  packetBuffer.writeUInt16BE(26921, 22);
  packetBuffer.writeUInt32BE(seq, 24);
  packetBuffer.writeUInt32BE(10, 28);
  packetBuffer[32] = 0x50;
  packetBuffer[33] = 0x18;
  payload.copy(packetBuffer, 40);
  return packetBuffer;
}

function readJsonLog(logPath: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("CaptureService lifecycle", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-capture-service-"));
    mocks.closeCapture.mockReset();
    mocks.findNpcapDevice.mockReset().mockReturnValue("npcap-device");
    mocks.getHeroSiegeNetworkState.mockReset();
    mocks.getNpcapRegistry.mockReset().mockResolvedValue({ adminOnly: false, winPcapCompatible: true });
    mocks.getNpcapServiceStatus.mockReset().mockResolvedValue("Running");
    mocks.listNpcapDevices.mockReset().mockReturnValue("npcap-device (10.0.0.2)");
    mocks.openPacketCapture.mockReset().mockReturnValue({ cap: { close: mocks.closeCapture }, linkType: "RAW" });
  });

  test("uses an owned relay tuple for capture while emitting only game-owned connections", async () => {
    const updates: CaptureUpdate[] = [];
    const gameConnection = connection({
      owningProcess: 123,
      localPort: 50000,
      remoteAddress: "203.0.113.10",
      remotePort: 6668,
    });
    const relayConnection = connection({
      owningProcess: 456,
      localPort: 50001,
      remoteAddress: "203.0.113.20",
      remotePort: 6669,
    });
    const service = new CaptureService(
      (update) => updates.push(update),
      undefined,
      undefined,
      undefined,
      () => [456],
    );
    mocks.getHeroSiegeNetworkState.mockResolvedValue({
      gameProcessIds: [123],
      antiCheatProcessIds: [],
      connections: [gameConnection, relayConnection],
    });

    await service.start();

    expect(mocks.getHeroSiegeNetworkState).toHaveBeenCalledWith([456]);
    expect(mocks.openPacketCapture).toHaveBeenCalledTimes(1);
    expect(mocks.openPacketCapture.mock.calls[0][1]).toBe(
      "tcp and host 10.0.0.2 + targets:203.0.113.10:6668,203.0.113.20:6669",
    );
    const emittedConnections = updates.flatMap((update) => update.connections ?? []);
    expect(emittedConnections).toContainEqual(gameConnection);
    expect(emittedConnections).not.toContainEqual(relayConnection);
    expect(emittedConnections.every((item) => item.owningProcess === 123)).toBe(true);

    const flowService = service as unknown as CaptureFlowService;
    expect(flowService.isCaptureFlowPacket(packet({
      srcPort: relayConnection.localPort,
      dst: relayConnection.remoteAddress,
      dstPort: relayConnection.remotePort,
    }))).toBe(true);
    service.stop();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("closes the active capture and emits idle when the game process disappears", async () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));

    mocks.getHeroSiegeNetworkState
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [connection()] })
      .mockResolvedValueOnce({ gameProcessIds: [], antiCheatProcessIds: [], connections: [] });

    await service.start();
    await (service as unknown as RefreshableCaptureService).refreshCaptureSafely("test");

    expect(mocks.openPacketCapture).toHaveBeenCalledTimes(1);
    expect(mocks.closeCapture).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual(
      expect.objectContaining({
        running: false,
        status: "idle",
        connections: [],
        health: { device: null, filter: "" },
      }),
    );
    service.stop();
  });

  test("emits an error when adapter lookup fails", async () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    mocks.findNpcapDevice.mockReturnValue("");
    mocks.listNpcapDevices.mockReturnValue("");
    mocks.getHeroSiegeNetworkState.mockResolvedValue({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [connection()] });

    await service.start();

    expect(mocks.openPacketCapture).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "error",
        error: "Npcap cannot find the adapter for 10.0.0.2.",
        log: expect.objectContaining({ level: "error" }),
      }),
    );
    service.stop();
  });

  test("recovers from an initial network discovery failure so capture can be retried", async () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    mocks.getHeroSiegeNetworkState
      .mockRejectedValueOnce(new Error("network query failed"))
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [connection()] });

    await expect(service.start()).resolves.toBeUndefined();
    expect(updates).toContainEqual(
      expect.objectContaining({
        running: false,
        status: "error",
        error: "network query failed",
      }),
    );

    await service.start();
    expect(mocks.openPacketCapture).toHaveBeenCalledTimes(1);
    service.stop();
  });

  test("uses unknown diagnostics when Npcap PowerShell checks fail", async () => {
    const service = new CaptureService(() => undefined);
    mocks.getNpcapRegistry.mockRejectedValueOnce(new Error("registry query failed"));
    mocks.getNpcapServiceStatus.mockRejectedValueOnce(new Error("service query failed"));

    await expect(service.diagnostics()).resolves.toEqual({
      npcapService: "Unknown",
      winPcapCompatible: false,
      adminOnly: false,
    });
  });

  test("keeps capture failure non-fatal when openPacketCapture throws", async () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    mocks.openPacketCapture.mockImplementation(() => {
      throw new Error("open failed");
    });
    mocks.getHeroSiegeNetworkState.mockResolvedValue({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [connection()] });

    await service.start();

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "error",
        error: "open failed",
        log: expect.objectContaining({ message: "Capture failed: open failed" }),
      }),
    );
    service.stop();
  });

  test("waits for anti-cheat launch to finish before opening capture", async () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    mocks.getHeroSiegeNetworkState.mockResolvedValue({ gameProcessIds: [123], antiCheatProcessIds: [456], connections: [] });

    await service.start();

    expect(mocks.openPacketCapture).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({
        running: false,
        status: "idle",
        log: expect.objectContaining({ level: "warning" }),
      }),
    );
  });

  test("reopens capture when the process opens a new game endpoint", async () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    const gameConnection = connection({ remoteAddress: "203.0.113.10", remotePort: 6668 });
    const secondGameConnection = connection({ remoteAddress: "203.0.113.20", remotePort: 6600, localPort: 50001 });
    mocks.getHeroSiegeNetworkState
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [gameConnection] })
      .mockResolvedValueOnce({
        gameProcessIds: [123],
        antiCheatProcessIds: [],
        connections: [gameConnection, secondGameConnection],
      });

    await service.start();
    await (service as unknown as RefreshableCaptureService).refreshCaptureSafely("test");

    expect(mocks.openPacketCapture).toHaveBeenCalledTimes(2);
    expect(mocks.openPacketCapture.mock.calls[0][1]).toBe("tcp and host 10.0.0.2 + targets:203.0.113.10:6668");
    expect(mocks.openPacketCapture.mock.calls[1][1]).toBe(
      "tcp and host 10.0.0.2 + targets:203.0.113.10:6668,203.0.113.20:6600",
    );
    expect(mocks.closeCapture).toHaveBeenCalledTimes(1);
    service.stop();
  });

  test("logs privacy-safe generation breadcrumbs and lifecycle counters across a reopen", async () => {
    const debugLogPath = path.join(tempDir, "capture-debug.log");
    const service = new CaptureService(() => undefined, debugLogPath);
    const gameConnection = connection({ remoteAddress: "203.0.113.10", remotePort: 6668 });
    const secondGameConnection = connection({ remoteAddress: "203.0.113.20", remotePort: 6600, localPort: 50001 });
    mocks.getHeroSiegeNetworkState
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [gameConnection] })
      .mockResolvedValueOnce({
        gameProcessIds: [123],
        antiCheatProcessIds: [],
        connections: [gameConnection, secondGameConnection],
      });

    await service.start();
    const lifecycleService = service as unknown as LifecycleCaptureService;
    await lifecycleService.refreshCaptureSafely("test");
    lifecycleService.writeDiagnosticHeartbeat();
    service.stop();

    const records = readJsonLog(debugLogPath);
    const openStarts = records.filter((record) => record.type === "capture-open-start");
    const opens = records.filter((record) => record.type === "capture-open");
    const reopenClose = records.find((record) => record.type === "capture-close" && record.reason === "reopen");
    const reopenCloseReturned = records.find((record) => record.type === "capture-close-returned" && record.reason === "reopen");
    const heartbeats = records.filter((record) => record.type === "capture-heartbeat");

    expect(openStarts).toHaveLength(2);
    expect(openStarts[0]).toMatchObject({
      generation: 1,
      previousGeneration: null,
      reason: "initial",
      targetCount: 1,
      connectionCount: 1,
      lifecycle: { generationSequence: 1, activeGeneration: null, openAttempts: 1, opens: 0, reopens: 0 },
    });
    expect(openStarts[1]).toMatchObject({
      generation: 2,
      previousGeneration: 1,
      reason: "reopen",
      targetCount: 2,
      connectionCount: 2,
      lifecycle: { generationSequence: 2, activeGeneration: 1, openAttempts: 2, opens: 1, reopens: 0 },
    });
    expect(opens[1]).toMatchObject({
      phase: "returned",
      generation: 2,
      previousGeneration: 1,
      reason: "reopen",
      lifecycle: { activeGeneration: 2, opens: 2, reopens: 1, closeAttempts: 1, closes: 1, closeFailures: 0 },
    });
    expect(reopenClose).toMatchObject({
      phase: "start",
      generation: 1,
      targetCount: 1,
      connectionCount: 1,
    });
    expect(reopenCloseReturned).toMatchObject({
      generation: 1,
      lifecycle: { activeGeneration: null, closeAttempts: 1, closes: 1, closeFailures: 0 },
    });
    expect(heartbeats.at(-1)).toMatchObject({
      capOpen: true,
      activeTargetCount: 2,
      activeConnectionCount: 2,
      lifecycle: { activeGeneration: 2, opens: 2, reopens: 1 },
    });
    expect(JSON.stringify(openStarts)).not.toContain("203.0.113");
    expect(JSON.stringify(reopenCloseReturned)).not.toContain("203.0.113");
  });

  test("reports a sanitized close failure and continues reopening capture", async () => {
    const updates: CaptureUpdate[] = [];
    const debugLogPath = path.join(tempDir, "capture-debug.log");
    const service = new CaptureService((update) => updates.push(update), debugLogPath);
    const gameConnection = connection({ remoteAddress: "203.0.113.10", remotePort: 6668 });
    const secondGameConnection = connection({ remoteAddress: "203.0.113.20", remotePort: 6600, localPort: 50001 });
    mocks.closeCapture.mockImplementationOnce(() => {
      throw new Error("identifier=secret native close failed");
    });
    mocks.getHeroSiegeNetworkState
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [gameConnection] })
      .mockResolvedValueOnce({
        gameProcessIds: [123],
        antiCheatProcessIds: [],
        connections: [gameConnection, secondGameConnection],
      });

    await service.start();
    await expect((service as unknown as RefreshableCaptureService).refreshCaptureSafely("test")).resolves.toBeUndefined();

    expect(() => service.stop()).not.toThrow();
    expect(mocks.openPacketCapture).toHaveBeenCalledTimes(2);
    const log = fs.readFileSync(debugLogPath, "utf8");
    const closeError = readJsonLog(debugLogPath).find((record) => record.type === "capture-close-error");
    expect(log).not.toContain("identifier=secret");
    expect(closeError).toMatchObject({
      reason: "reopen",
      generation: 1,
      error: "identifier=<redacted> native close failed",
      lifecycle: { activeGeneration: null, closeAttempts: 1, closes: 0, closeFailures: 1 },
    });
    expect(updates).toContainEqual({
      log: {
        level: "warning",
        message: "Npcap handle close reported an error; capture recovery will continue: identifier=<redacted> native close failed",
      },
    });
  });

  test("keeps the capture filter while game endpoints drain within the grace window", async () => {
    const service = new CaptureService(() => undefined);
    const gameConnection = connection({ remoteAddress: "203.0.113.10", remotePort: 6668 });
    const secondGameConnection = connection({ remoteAddress: "203.0.113.20", remotePort: 6600, localPort: 50001 });
    mocks.getHeroSiegeNetworkState
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [gameConnection, secondGameConnection] })
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [gameConnection] });

    await service.start();
    await (service as unknown as RefreshableCaptureService).refreshCaptureSafely("test");

    expect(mocks.openPacketCapture).toHaveBeenCalledTimes(1);
    expect(mocks.closeCapture).not.toHaveBeenCalled();
    service.stop();
  });

  test("does not overlap asynchronous network refreshes", async () => {
    const service = new CaptureService(() => undefined);
    let resolveRefresh: ((state: { gameProcessIds: number[]; antiCheatProcessIds: number[]; connections: CaptureConnection[] }) => void) | undefined;
    const pendingRefresh = new Promise<{ gameProcessIds: number[]; antiCheatProcessIds: number[]; connections: CaptureConnection[] }>((resolve) => {
      resolveRefresh = resolve;
    });
    mocks.getHeroSiegeNetworkState
      .mockResolvedValueOnce({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [connection()] })
      .mockReturnValueOnce(pendingRefresh);

    await service.start();
    const refreshable = service as unknown as RefreshableCaptureService;
    const first = refreshable.refreshCaptureSafely("first");
    const second = refreshable.refreshCaptureSafely("second");

    expect(mocks.getHeroSiegeNetworkState).toHaveBeenCalledTimes(2);
    resolveRefresh?.({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [connection()] });
    await Promise.all([first, second]);
    service.stop();
  });

  test("accepts only selected process-owned flows during the connection grace window", () => {
    const service = new CaptureService(() => undefined);
    const flowService = service as unknown as CaptureFlowService;
    flowService.activeLocalAddress = "10.0.0.2";
    flowService.refreshCaptureFlows([connection()], 1000);

    expect(flowService.isCaptureFlowPacket(packet(), 3999)).toBe(true);
    expect(flowService.isCaptureFlowPacket(packet({ srcPort: 50001 }), 3999)).toBe(false);
    expect(flowService.isCaptureFlowPacket(packet(), 4000)).toBe(false);
  });

  test("discards Npcap-truncated payloads before TCP reassembly", () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    const internals = service as unknown as PacketProcessingCaptureService;
    const capturedPacket = rawTcpPacket('{"gold":1}\0');
    internals.activeLocalAddress = "10.0.0.2";
    internals.activeLinkType = "RAW";
    internals.buffer = capturedPacket;
    internals.refreshCaptureFlows([connection()], Date.now());
    const push = vi.spyOn(internals.packetBuffers, "push");

    internals.processPacket(capturedPacket.length, true);

    expect(push).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({
        health: { packetsSeen: 1 },
        log: expect.objectContaining({ message: expect.stringContaining("incomplete payload was discarded") }),
      }),
    );
  });

  test("reassembles a current multi-segment save frame through the capture pipeline", () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    const internals = service as unknown as PacketProcessingCaptureService;
    const slotData = JSON.stringify({
      name: "Dante",
      experience: 424_534,
      statisticTotalMonsterKills: 72_532,
      season: 11,
      hardcore: 0,
      inventorySnapshot: "x".repeat(4_400),
    });
    const body = Buffer.from(`\0\0save\0R\0account_id=1&slot_data=${slotData}&beta=0\0`);
    const header = Buffer.alloc(16);
    header.write("9db046d0b41c", 0, "ascii");
    header.writeUInt32LE(body.length, 12);
    const frame = Buffer.concat([header, body]);
    const segmentLengths = [1_380, 1_460, 1_460, frame.length - 4_300];

    internals.activeLocalAddress = "10.0.0.2";
    internals.activeLinkType = "RAW";
    internals.refreshCaptureFlows([connection()], Date.now());
    let offset = 0;
    for (const segmentLength of segmentLengths) {
      const capturedPacket = rawTcpPacket(frame.subarray(offset, offset + segmentLength), 10_000 + offset);
      internals.buffer = capturedPacket;
      internals.processPacket(capturedPacket.length, false);
      offset += segmentLength;
    }

    expect(updates.flatMap((update) => update.events ?? [])).toContainEqual(
      expect.objectContaining({
        name: EVENT_NAMES.account,
        value: expect.objectContaining({
          name: "Dante",
          experience: 424_534,
          totalMonsterKills: 72_532,
          season: 11,
          seasonMode: "GSS",
        }),
      }),
    );
  });

  test("resets capture after repeated parser failures", async () => {
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update));
    mocks.getHeroSiegeNetworkState.mockResolvedValue({ gameProcessIds: [123], antiCheatProcessIds: [], connections: [connection()] });

    await service.start();
    const parserService = service as unknown as ParserFailureCaptureService;
    parserService.recordParserFailure("captureMessages", new Error("bad payload"), "account_id=123");
    parserService.recordParserFailure("captureMessages", new Error("bad payload"), "account_id=123");
    parserService.recordParserFailure("captureMessages", new Error("bad payload"), "account_id=123");

    expect(mocks.closeCapture).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "waiting",
        health: expect.objectContaining({ parserErrors: 3, parserRestarts: 1 }),
        log: expect.objectContaining({ level: "warning" }),
      }),
    );
    service.stop();
  });

  test("verbose wide logs keep snippets but omit raw base64 payload fields", () => {
    const wideLogPath = path.join(tempDir, "capture-wide-debug.log");
    const service = new CaptureService(() => undefined, undefined, wideLogPath, true);
    const packet: ParsedPayload = {
      src: "10.0.0.2",
      srcPort: 50000,
      dst: "203.0.113.10",
      dstPort: 26921,
      seq: 1,
      ack: 10,
      flags: 0x18,
      payloadLength: Buffer.byteLength("account_id=123 hello"),
      payload: Buffer.from("account_id=123 hello"),
      text: "account_id=123 hello",
    };

    const wideService = service as unknown as WideDebugCaptureService;
    wideService.writeWidePacketLog(packet, 128, false);
    wideService.writeWidePayloadLog(packet, "identifier=secret payload");

    const log = fs.readFileSync(wideLogPath, "utf8");
    expect(log).not.toContain("payloadBase64");
    expect(log).not.toContain("textBase64");
    expect(log).not.toContain("secret");
    expect(log).toContain("account_id=<redacted>");
    expect(log).toContain("identifier=<redacted>");
    expect(readJsonLog(wideLogPath)[0]).toMatchObject({ tcpSequence: 1, tcpFlags: 0x18, nullBytes: 0 });
  });

  test("normal debug logs include parsed item event summaries without payload snippets", () => {
    const debugLogPath = path.join(tempDir, "capture-debug.log");
    const service = new CaptureService(() => undefined, debugLogPath);
    const debugService = service as unknown as ParsedEventDebugCaptureService;
    debugService.payloadsAssembled = 3;
    debugService.messagesDecoded = 5;
    debugService.parsedEvents = 2;

    debugService.writeParsedEventDebugLog(
      [
        {
          name: EVENT_NAMES.item,
          value: { label: "Rotten Pumpkin", source: "inventory", type: 10, id: 54, fingerprint: "secret-fingerprint" },
          raw: { message: "Success on inventory update ext", item_data: { b: 54 } },
          createdAt: 1,
        },
      ],
      1,
    );

    const records = readJsonLog(debugLogPath);
    expect(records).toContainEqual(
      expect.objectContaining({
        type: "parsed-events",
        count: 1,
        totalEvents: 1,
        eventNames: [EVENT_NAMES.item],
        payloadsAssembled: 3,
        messagesDecoded: 5,
        parsedEvents: 2,
        events: [
          expect.objectContaining({
            name: EVENT_NAMES.item,
            value: expect.objectContaining({
              label: "Rotten Pumpkin",
              source: "inventory",
              type: 10,
              id: 54,
              fingerprint: "<redacted>",
            }),
            rawKeys: "message,item_data",
            message: "Success on inventory update ext",
          }),
        ],
      }),
    );
    expect(fs.readFileSync(debugLogPath, "utf8")).not.toContain("payloadBase64");
    expect(fs.readFileSync(debugLogPath, "utf8")).not.toContain("secret-fingerprint");
  });

  test("normal parsed-event debug logs stay scoped to item events", () => {
    const debugLogPath = path.join(tempDir, "capture-debug.log");
    const service = new CaptureService(() => undefined, debugLogPath);
    const debugService = service as unknown as ParsedEventDebugCaptureService;

    debugService.writeParsedEventDebugLog(
      [
        {
          name: EVENT_NAMES.gold,
          value: { accountId: 123, GSS: 100, GSH: 0, GNS: 0, GNH: 0, GBP: 0 },
          raw: { currencyData: { account_id: 123, GSS: 100 } },
          createdAt: 1,
        },
      ],
      1,
    );

    expect(fs.existsSync(debugLogPath)).toBe(false);
  });

  test("logs each Satanic Zone request that does not produce a parsed update", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T16:30:00.000Z"));
    const debugLogPath = path.join(tempDir, "capture-debug.log");
    const service = new CaptureService(() => undefined, debugLogPath);
    const diagnostics = service as unknown as SatanicZoneDiagnosticCaptureService;
    diagnostics.activeLocalAddress = "10.0.0.2";
    diagnostics.activeSignature = "10.0.0.2->198.51.100.77:6669";
    const requestPacket = packet({ dst: "198.51.100.77", dstPort: 6669 });
    const payloadText =
      "abc123S satanic_zone_getRunique_account_id=3437205&crossregion_identifier=one def456S satanic_zone_getRunique_account_id=3437205&crossregion_identifier=two";

    diagnostics.recordEndpointTraffic(requestPacket, "packet");
    diagnostics.recordEndpointTraffic(requestPacket, "payload");
    diagnostics.probeSatanicZonePayload(requestPacket, payloadText, [{ route: "satanic_zone_get" }], []);
    vi.advanceTimersByTime(15_000);

    const records = readJsonLog(debugLogPath);
    const requests = records.filter((record) => record.type === "satanic-zone-request");
    const timeouts = records.filter((record) => record.type === "satanic-zone-request-timeout");
    expect(requests).toHaveLength(2);
    expect(timeouts).toHaveLength(2);
    expect(timeouts[0]).toMatchObject({
      endpoint: expect.objectContaining({ direction: "outbound", remoteAddress: "198.51.100.77", remotePort: 6669 }),
      endpointTraffic: expect.objectContaining({ inboundPackets: 0, outboundPackets: 1, inboundPayloads: 0, outboundPayloads: 1 }),
    });
  });

  test("emits passive Satanic Zone lifecycle updates even when diagnostics are disabled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T16:30:00.000Z"));
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update), undefined, undefined, {
      captureDebugLogging: false,
      capturePayloadLogging: false,
      captureWideLogging: false,
      satanicZoneDebugLogging: false,
    });
    const diagnostics = service as unknown as SatanicZoneDiagnosticCaptureService;
    diagnostics.activeLocalAddress = "10.0.0.2";
    diagnostics.probeSatanicZonePayload(
      packet({ dst: "198.51.100.77", dstPort: 6669 }),
      "abc123S satanic_zone_getRunique_account_id=redacted",
      [{ route: "satanic_zone_get" }],
      [],
    );

    expect(updates).toContainEqual({
      satanicZoneActivity: { kind: "request", observedAt: Date.now() },
    });

    vi.advanceTimersByTime(15_000);

    expect(updates).toContainEqual({
      satanicZoneActivity: {
        kind: "timeout",
        observedAt: Date.now(),
        requestedAt: Date.now() - 15_000,
      },
    });
  });

  test("resolves pending Satanic Zone requests when any backend returns zone data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T16:30:00.000Z"));
    const debugLogPath = path.join(tempDir, "capture-debug.log");
    const service = new CaptureService(() => undefined, debugLogPath);
    const diagnostics = service as unknown as SatanicZoneDiagnosticCaptureService;
    diagnostics.activeLocalAddress = "10.0.0.2";
    diagnostics.activeSignature = "10.0.0.2->203.0.113.55:7777";
    const requestPacket = packet({ dst: "203.0.113.55", dstPort: 7777 });
    const responsePacket = packet({ src: "203.0.113.55", srcPort: 7777, dst: "10.0.0.2", dstPort: 50000 });
    const zoneEvent: ParsedEvent = {
      name: EVENT_NAMES.satanicZone,
      value: { rawZone: "Act_01_01", zone: "Act 1: Siege Fields", pros: [], cons: [], buffs: [], updatedAt: Date.now() },
      raw: {},
      createdAt: Date.now(),
    };

    diagnostics.probeSatanicZonePayload(
      requestPacket,
      "abc123S satanic_zone_getRunique_account_id=3437205&crossregion_identifier=one",
      [{ route: "satanic_zone_get" }],
      [],
    );
    diagnostics.recordEndpointTraffic(responsePacket, "packet");
    diagnostics.recordEndpointTraffic(responsePacket, "payload");
    diagnostics.probeSatanicZonePayload(responsePacket, "satanic_zone_name=Act_01_01&zone_buffs=&zone_debuffs=", [], [zoneEvent]);
    vi.advanceTimersByTime(10_000);

    const records = readJsonLog(debugLogPath);
    expect(records.filter((record) => record.type === "satanic-zone-request-timeout")).toHaveLength(0);
    expect(records).toContainEqual(
      expect.objectContaining({
        type: "satanic-zone-request-resolved",
        requestIds: [1],
        responseEndpoint: expect.objectContaining({ direction: "inbound", remoteAddress: "203.0.113.55", remotePort: 7777 }),
        responseEndpointTraffic: expect.objectContaining({ inboundPackets: 1, inboundPayloads: 1 }),
      }),
    );
  });

  test("keeps a Satanic Zone request open for a valid response just beyond ten seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T22:00:00.000Z"));
    const debugLogPath = path.join(tempDir, "capture-debug.log");
    const updates: CaptureUpdate[] = [];
    const service = new CaptureService((update) => updates.push(update), debugLogPath, undefined, {
      captureDebugLogging: true,
      capturePayloadLogging: false,
      captureWideLogging: false,
      satanicZoneDebugLogging: true,
    });
    const diagnostics = service as unknown as SatanicZoneDiagnosticCaptureService;
    const requestPacket = packet({ dst: "198.51.100.77", dstPort: 6669 });
    const responsePacket = packet({ src: "198.51.100.77", srcPort: 6669, dst: "10.0.0.2" });
    const zoneEvent: ParsedEvent = {
      name: EVENT_NAMES.satanicZone,
      value: { rawZone: "Act_05_04", zone: "Act 5: Crystal Village", pros: [], cons: [], buffs: [], updatedAt: Date.now() },
      raw: {},
      createdAt: Date.now(),
    };

    diagnostics.activeLocalAddress = "10.0.0.2";
    diagnostics.probeSatanicZonePayload(
      requestPacket,
      "abc123S satanic_zone_getRunique_account_id=3437205&crossregion_identifier=one",
      [{ route: "satanic_zone_get" }],
      [],
    );
    vi.advanceTimersByTime(10_505);
    diagnostics.probeSatanicZonePayload(
      responsePacket,
      "satanic_zone_name=Act_05_04&zone_buffs=&zone_debuffs=",
      [],
      [zoneEvent],
    );
    vi.advanceTimersByTime(5_000);

    expect(updates.filter((update) => update.satanicZoneActivity?.kind === "timeout")).toHaveLength(0);
    expect(readJsonLog(debugLogPath).filter((record) => record.type === "satanic-zone-request-timeout")).toHaveLength(0);
  });
});
