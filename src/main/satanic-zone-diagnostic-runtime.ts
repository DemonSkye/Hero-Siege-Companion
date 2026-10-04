import { getHeroSiegeNetworkState } from "./capture-network";
import { createDirectSatanicZoneTransport } from "./direct-satanic-zone-provider";
import { getTcpSegment } from "./packet-decoder";
import { SatanicZoneDiagnosticController, type SatanicZoneDiagnosticDependencies } from "./satanic-zone-diagnostic-controller";
import type { CapturePreferences } from "../shared/app-state";

export function diagnosticCapturePreferences(preferences: CapturePreferences, active: boolean): CapturePreferences {
  return active ? { captureDebugLogging: false, capturePayloadLogging: false, captureWideLogging: false,
    satanicZoneDebugLogging: false } : { ...preferences };
}

const LINK_TYPES = new Set(["ETHERNET", "RAW", "NULL", "LINKTYPE_LINUX_SLL"]);
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function createSatanicZoneDiagnosticRuntime(options: Pick<SatanicZoneDiagnosticDependencies, "canArm" | "onChange">
  & { syntheticOnly?: boolean }): SatanicZoneDiagnosticController {
  return new SatanicZoneDiagnosticController({
    ...options,
    async prepare() {
      // Test application boot must never load cap or inspect real connections.
      if (options.syntheticOnly) throw new Error("unavailable");
      const state = await getHeroSiegeNetworkState();
      const connections = state.connections.filter((connection) => state.gameProcessIds.includes(connection.owningProcess)
        && [6668, 6669].includes(connection.remotePort) && IPV4.test(connection.localAddress)
        && IPV4.test(connection.remoteAddress));
      if (connections.length !== 1) throw new Error("unavailable");
      const connection = connections[0];
      return { localAddress: connection.localAddress, remoteAddress: connection.remoteAddress, remotePort: connection.remotePort };
    },
    async open(scope, onPacket, failed, budget) {
      if (options.syntheticOnly) throw new Error("unavailable");
      const { findNpcapDevice, openPacketCapture } = await import("./capture-adapter");
      const device = findNpcapDevice(scope.localAddress);
      if (!device) throw new Error("unavailable");
      const buffer = budget.allocate(65_535);
      let releaseNative: (() => void) | undefined;
      try {
        releaseNative = budget.reserve(65_536);
        const filter = `ip and tcp and host ${scope.localAddress} and host ${scope.remoteAddress} and port ${scope.remotePort}`;
        let linkType = "";
        const handle = openPacketCapture(device, filter, buffer, (nbytes, truncated) => {
          let packet: ReturnType<typeof getTcpSegment> = null;
          try {
            packet = getTcpSegment(buffer, nbytes, linkType, true);
            if (packet) onPacket(packet, truncated);
            else if (truncated) failed();
          } catch { failed(); }
          finally { packet?.payload.fill(0); buffer.fill(0); }
        }, { nativeBufferBytes: 65_536 });
        linkType = handle.linkType;
        if (!LINK_TYPES.has(linkType)) { handle.cap.close(); buffer.fill(0); throw new Error("unavailable"); }
        let closed = false;
        return { close() { if (closed) return; closed = true; try { handle.cap.close(); }
          finally { budget.release(buffer); releaseNative?.(); } } };
      } catch { budget.release(buffer); releaseNative?.(); throw new Error("unavailable"); }
    },
    networkState: getHeroSiegeNetworkState,
    transport: (context, signal, trace, bufferBudget) => createDirectSatanicZoneTransport(context, signal, () => undefined, { trace, bufferBudget }),
  });
}
