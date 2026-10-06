import type { CaptureConnection } from "../shared/app-state";
import type { DiagnosticCaptureScope } from "./satanic-zone-diagnostic-stream";
import type { CapturedTcpLifecycle } from "./packet-decoder";

export interface SatanicZoneSessionScope extends DiagnosticCaptureScope { pid: number; localPort: number; }

export function satanicZoneSessionTerminated(scope: SatanicZoneSessionScope, packet: CapturedTcpLifecycle): boolean {
  const outbound = packet.src === scope.localAddress && packet.srcPort === scope.localPort
    && packet.dst === scope.remoteAddress && packet.dstPort === scope.remotePort;
  const inbound = packet.dst === scope.localAddress && packet.dstPort === scope.localPort
    && packet.src === scope.remoteAddress && packet.srcPort === scope.remotePort;
  return (outbound || inbound) && ((packet.flags & 5) !== 0
    || (outbound && (packet.flags & 2) !== 0 && (packet.flags & 16) === 0));
}

/** Tuple presence is a snapshot, not incarnation/identity proof after an observation gap.
 * The context owner must separately enforce continuous observation or fresh initialization.
 * Missing topology is inconclusive. An explicit replacement or closed flow is not.
 */
export function satanicZoneSessionScopeStatus(scope: SatanicZoneSessionScope,
  connections: readonly CaptureConnection[]): "current" | "changed" | "unknown" {
  const matching = connections.filter(connection => connection.localAddress === scope.localAddress
    && connection.localPort === scope.localPort && connection.remoteAddress === scope.remoteAddress
    && connection.remotePort === scope.remotePort);
  if (matching.some(connection => connection.owningProcess !== scope.pid)) return "changed";
  const state = (connection: CaptureConnection) => String(connection.state).toLowerCase();
  if (matching.some(connection => ["established", "5"].includes(state(connection)))) return "current";
  if (matching.some(connection => ["closed", "1", "finwait1", "6", "finwait2", "7", "closewait", "8",
    "closing", "9", "lastack", "10", "timewait", "11", "deletetcb", "12"].includes(state(connection)))) return "changed";
  if (!matching.length && connections.some(connection => connection.owningProcess === scope.pid
    && [6668, 6669].includes(connection.remotePort) && ["established", "5"].includes(state(connection)))) return "changed";
  return "unknown";
}
