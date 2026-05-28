import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CaptureService, type CaptureUpdate } from "../../src/main/capture";
import type { ParsedPayload } from "../../src/main/packet-decoder";
import type { CaptureConnection } from "../../src/shared/app-state";

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
  connectionSignature: (connections: CaptureConnection[]) =>
    connections.map((connection) => `${connection.localAddress}->${connection.remoteAddress}:${connection.remotePort}`).join("|"),
  getHeroSiegeNetworkState: mocks.getHeroSiegeNetworkState,
  getNpcapRegistry: mocks.getNpcapRegistry,
  getNpcapServiceStatus: mocks.getNpcapServiceStatus,
  selectGameServerConnections: (connections: CaptureConnection[]) => connections,
  stableCaptureFilter: (localAddress: string) => `tcp and host ${localAddress}`,
  summarizeConnections: (connections: CaptureConnection[]) => connections,
  uniqueCaptureTargets: (connections: CaptureConnection[]) =>
    connections.map((connection) => ({ remoteAddress: connection.remoteAddress, remotePort: connection.remotePort })),
}));

interface RefreshableCaptureService {
  refreshCaptureSafely(source: string): Promise<void>;
}

interface ParserFailureCaptureService {
  recordParserFailure(stage: string, error: unknown, payloadText: string): void;
}

interface WideDebugCaptureService {
  writeWidePacketLog(packet: ParsedPayload, nbytes: number, truncated: boolean): void;
  writeWidePayloadLog(packet: ParsedPayload, payloadText: string): void;
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

  afterEach(() => {
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
      ack: 10,
      payloadLength: 12,
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
  });
});
