import { describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ network: vi.fn(), findDevice: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock("../../src/main/capture-network", () => ({ getHeroSiegeNetworkState: mocks.network }));
vi.mock("../../src/main/capture-adapter", () => ({ findNpcapDevice: mocks.findDevice, openPacketCapture: mocks.open }));
import { createSatanicZoneDiagnosticRuntime } from "../../src/main/satanic-zone-diagnostic-runtime";
async function flush() { for (let index = 0; index < 24; index++) await Promise.resolve(); }
function fixture() {
  mocks.network.mockResolvedValue({ gameProcessIds: [42], antiCheatProcessIds: [], connections: [{ owningProcess: 42, state: "established",
    localAddress: "192.0.2.10", remoteAddress: "198.51.100.20", localPort: 4999, remotePort: 6669 }] });
  mocks.findDevice.mockReturnValue("invented-device"); mocks.open.mockReturnValue({ cap: { close: mocks.close }, linkType: "RAW" });
  return createSatanicZoneDiagnosticRuntime({ canArm: () => true, onChange: () => {} });
}
describe("diagnostic adapter wiring with mocked native module", () => {
  test("requests a separately accounted 64 KiB native capacity and zeroes the read buffer on cancel", async () => {
    const controller = fixture(); controller.arm(); await flush();
    expect(mocks.open).toHaveBeenCalledTimes(1); expect(mocks.open.mock.calls[0][4]).toEqual({ nativeBufferBytes: 65_536 });
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
