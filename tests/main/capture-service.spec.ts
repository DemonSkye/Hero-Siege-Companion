import { beforeEach, describe, expect, test, vi } from "vitest";
import { CaptureService, type CaptureUpdate } from "../../src/main/capture";
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
    mocks.closeCapture.mockReset();
    mocks.findNpcapDevice.mockReset().mockReturnValue("npcap-device");
    mocks.getHeroSiegeNetworkState.mockReset();
    mocks.getNpcapRegistry.mockReset().mockResolvedValue({ adminOnly: false, winPcapCompatible: true });
    mocks.getNpcapServiceStatus.mockReset().mockResolvedValue("Running");
    mocks.listNpcapDevices.mockReset().mockReturnValue("npcap-device (10.0.0.2)");
    mocks.openPacketCapture.mockReset().mockReturnValue({ cap: { close: mocks.closeCapture }, linkType: "RAW" });
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
  });
});
