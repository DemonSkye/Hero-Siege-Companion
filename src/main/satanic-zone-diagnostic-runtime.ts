import { getDefaultCaptureLocalAddress, getHeroSiegeNetworkState } from "./capture-network";
import { createDirectSatanicZoneTransport } from "./direct-satanic-zone-provider";
import { getTcpSegment } from "./packet-decoder";
import { SatanicZoneDiagnosticController, type SatanicZoneDiagnosticDependencies } from "./satanic-zone-diagnostic-controller";
import type { CapturePreferences } from "../shared/app-state";
import type { SatanicZoneListenScope } from "./satanic-zone-diagnostic-stream";

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
    ...createDiagnosticCaptureDependencies(options.syntheticOnly),
    transport: (context, signal, trace, bufferBudget) => createDirectSatanicZoneTransport(context, signal, () => undefined, { trace, bufferBudget }),
  });
}

type CaptureDependencies<Scope> = Pick<SatanicZoneDiagnosticDependencies<Scope>, "prepare" | "open" | "networkState">;
export function createDiagnosticCaptureDependencies(syntheticOnly: boolean, endpointPolicy: "startup-api"): CaptureDependencies<SatanicZoneListenScope>;
export function createDiagnosticCaptureDependencies(syntheticOnly?: boolean, endpointPolicy?: "fixed" | "fresh-api"): Pick<SatanicZoneDiagnosticDependencies, "prepare" | "open" | "networkState">;
export function createDiagnosticCaptureDependencies(syntheticOnly = false, endpointPolicy: "fixed" | "fresh-api" | "startup-api" = "fixed"):
  CaptureDependencies<SatanicZoneListenScope> {
  return {
    async prepare() {
      // Test application boot must never load cap or inspect real connections.
      if (syntheticOnly) throw new Error("unavailable");
      const state = await getHeroSiegeNetworkState();
      const connections = state.connections.filter((connection) => state.gameProcessIds.includes(connection.owningProcess)
        && [6668, 6669].includes(connection.remotePort) && IPV4.test(connection.localAddress)
        && IPV4.test(connection.remoteAddress));
      if (endpointPolicy === "startup-api" && connections.length === 0) {
        const localAddress = await getDefaultCaptureLocalAddress();
        if (!localAddress) throw new Error("unavailable");
        return { localAddress };
      }
      if (connections.length === 0 || (endpointPolicy === "fixed" && connections.length !== 1)
        || new Set(connections.map(connection => connection.localAddress)).size !== 1) throw new Error("unavailable");
      const connection = connections[0];
      return { localAddress: connection.localAddress, remoteAddress: connection.remoteAddress, remotePort: connection.remotePort };
    },
    async open(scope, onPacket, failed, budget) {
      if (syntheticOnly) throw new Error("unavailable");
      const { findNpcapDevice, openPacketCapture } = await import("./capture-adapter");
      const device = findNpcapDevice(scope.localAddress);
      if (!device) throw new Error("unavailable");
      const buffer = budget.allocate(65_535);
      let releaseNative: (() => void) | undefined;
      try {
        releaseNative = budget.reserve(65_536);
        // A restart may change native API server/port. Capture those two known
        // ports on the selected adapter before the fresh SYN pins an endpoint.
        const filter = endpointPolicy !== "fixed"
          ? `ip and tcp and host ${scope.localAddress} and (port 6668 or port 6669)`
          : `ip and tcp and host ${scope.localAddress} and host ${scope.remoteAddress} and port ${scope.remotePort}`;
        let linkType = "";
        const handle = openPacketCapture(device, filter, buffer, (nbytes, truncated) => {
          let packet: ReturnType<typeof getTcpSegment> = null;
          try {
            packet = getTcpSegment(buffer, nbytes, linkType, true);
            if (packet) onPacket(packet, truncated);
            else if (truncated) failed();
          } catch { failed(); }
          finally { packet?.payload.fill(0); buffer.fill(0); }
        }, { nativeBufferBytes: 65_536, immediate: true });
        linkType = handle.linkType;
        if (!LINK_TYPES.has(linkType)) { handle.cap.close(); buffer.fill(0); throw new Error("unavailable"); }
        let closed = false;
        return { close() { if (closed) return; closed = true; try { handle.cap.close(); }
          finally { budget.release(buffer); releaseNative?.(); } } };
      } catch { budget.release(buffer); releaseNative?.(); throw new Error("unavailable"); }
    },
    networkState: getHeroSiegeNetworkState,
  };
}
