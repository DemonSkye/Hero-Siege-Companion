import { describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ network: vi.fn(), defaultAddress: vi.fn(), findDevice: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock("../../src/main/capture-network", () => ({ getHeroSiegeNetworkState: mocks.network, getDefaultCaptureLocalAddress: mocks.defaultAddress }));
vi.mock("../../src/main/capture-adapter", () => ({ findNpcapDevice: mocks.findDevice, openPacketCapture: mocks.open }));
import { createDiagnosticCaptureDependencies, createSatanicZoneDiagnosticRuntime } from "../../src/main/satanic-zone-diagnostic-runtime";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
async function flush() { for (let index = 0; index < 24; index++) await Promise.resolve(); }
function fixture() {
  mocks.network.mockResolvedValue({ gameProcessIds: [42], antiCheatProcessIds: [], connections: [{ owningProcess: 42, state: "established",
    localAddress: "192.0.2.10", remoteAddress: "198.51.100.20", localPort: 4999, remotePort: 6669 }] });
  mocks.findDevice.mockReturnValue("invented-device"); mocks.open.mockReturnValue({ cap: { close: mocks.close }, linkType: "RAW" });
  return createSatanicZoneDiagnosticRuntime({ canArm: () => true, onChange: () => {} });
}
describe("diagnostic adapter wiring with mocked native module", () => {
  test("startup listener opens on the default route before any game process or API connection exists", async () => {
    const legacy = fixture(); mocks.network.mockResolvedValue({ gameProcessIds: [], antiCheatProcessIds: [], connections: [] });
    mocks.defaultAddress.mockResolvedValue("192.0.2.10");
    const dependencies = createDiagnosticCaptureDependencies(false, "startup-api");
    const scope = await dependencies.prepare(); expect(scope).toEqual({ localAddress: "192.0.2.10" });
    const budget = new SatanicZoneDiagnosticBufferBudget(), handle = await dependencies.open(scope, vi.fn(), vi.fn(), budget);
    expect(mocks.findDevice).toHaveBeenCalledWith("192.0.2.10");
    expect(mocks.open.mock.calls[0][1]).toBe("ip and tcp and host 192.0.2.10 and (port 6668 or port 6669)");
    expect(budget.peakBytes).toBe(131_071); handle.close(); budget.dispose(); legacy.dispose();
  });
  test("startup selection uses the actual game adapter after login and fails closed on an ambiguous default route", async () => {
    const legacy = fixture();
    await expect(createDiagnosticCaptureDependencies(false, "startup-api").prepare()).resolves.toMatchObject({ localAddress: "192.0.2.10" });
    expect(mocks.defaultAddress).not.toHaveBeenCalled();
    mocks.network.mockResolvedValue({ gameProcessIds: [], antiCheatProcessIds: [], connections: [] });
    mocks.defaultAddress.mockResolvedValue(null);
    await expect(createDiagnosticCaptureDependencies(false, "startup-api").prepare()).rejects.toThrow("unavailable");
    expect(mocks.open).not.toHaveBeenCalled(); legacy.dispose();
  });
  test("fresh API collection listens before restart on both API ports rather than the old server", async () => {
    const legacy = fixture(), dependencies = createDiagnosticCaptureDependencies(false, "fresh-api");
    const scope = await dependencies.prepare(), budget = new SatanicZoneDiagnosticBufferBudget();
    const handle = await dependencies.open(scope, vi.fn(), vi.fn(), budget);
    expect(mocks.findDevice).toHaveBeenCalledWith("192.0.2.10");
    expect(mocks.open.mock.calls[0][1]).toBe("ip and tcp and host 192.0.2.10 and (port 6668 or port 6669)");
    expect(mocks.open.mock.calls[0][1]).not.toContain("198.51.100.20");
    expect(mocks.open.mock.calls[0][4]).toEqual({ nativeBufferBytes: 65_536, immediate: true });
    expect(budget.peakBytes).toBe(131_071); handle.close(); budget.dispose(); legacy.dispose();
  });
  test("multiple pre-restart API endpoints may share one adapter; the legacy fixed scope still rejects them", async () => {
    const legacy = fixture(), state = await mocks.network();
    mocks.network.mockResolvedValue({ ...state, connections: [...state.connections,
      { ...state.connections[0], remoteAddress: "203.0.113.30", remotePort: 6668, localPort: 4998 }] });
    const fresh = createDiagnosticCaptureDependencies(false, "fresh-api");
    await expect(fresh.prepare()).resolves.toEqual({ localAddress: "192.0.2.10", remoteAddress: "198.51.100.20", remotePort: 6669 });
    await expect(createDiagnosticCaptureDependencies().prepare()).rejects.toThrow("unavailable");
    expect(mocks.open).not.toHaveBeenCalled(); legacy.dispose();
  });
  test("pre-restart connections on different adapters do not choose an adapter arbitrarily", async () => {
    const legacy = fixture(), state = await mocks.network();
    mocks.network.mockResolvedValue({ ...state, connections: [...state.connections,
      { ...state.connections[0], localAddress: "192.0.2.11" }] });
    await expect(createDiagnosticCaptureDependencies(false, "fresh-api").prepare()).rejects.toThrow("unavailable");
    expect(mocks.open).not.toHaveBeenCalled(); legacy.dispose();
  });
  test("requests a separately accounted 64 KiB native capacity and zeroes the read buffer on cancel", async () => {
    const controller = fixture(); controller.arm(); await flush();
    expect(mocks.open).toHaveBeenCalledTimes(1); expect(mocks.open.mock.calls[0][4]).toEqual({ nativeBufferBytes: 65_536, immediate: true });
    expect(mocks.open.mock.calls[0][1]).toBe("ip and tcp and host 192.0.2.10 and host 198.51.100.20 and port 6669");
    const buffer: Buffer = mocks.open.mock.calls[0][2]; expect(buffer.length).toBe(65_535);
    expect(controller.snapshot().peakOwnedBufferBytes).toBe(131_071); buffer.fill(9); controller.cancel();
    expect(buffer).toEqual(Buffer.alloc(buffer.length)); expect(mocks.close).toHaveBeenCalledTimes(1); controller.dispose();
  });
  test("an unsupported native link closes only its handle and returns a bounded failure", async () => {
    const controller = fixture(); mocks.open.mockReturnValueOnce({ cap: { close: mocks.close }, linkType: "CANARY_UNSUPPORTED" });
    controller.arm(); await flush(); expect(controller.snapshot()).toMatchObject({ phase: "unavailable", reason: "adapter-unavailable" });
    expect(JSON.stringify(controller.snapshot())).not.toContain("CANARY"); expect(mocks.close).toHaveBeenCalledTimes(1); controller.dispose();
  });
  test("a native open exception retains no read-buffer data or arbitrary error text", async () => {
    const controller = fixture(); let buffer!: Buffer;
    mocks.open.mockImplementationOnce((_device, _filter, bytes) => { buffer = bytes; buffer.fill(9); throw new Error("CANARY_SECRET"); });
    controller.arm(); await flush(); expect(controller.snapshot().reason).toBe("adapter-unavailable");
    expect(buffer).toEqual(Buffer.alloc(buffer.length)); expect(JSON.stringify(controller.snapshot())).not.toContain("CANARY"); controller.dispose();
  });
});
