import type { HeroSiegeNetworkState } from "./capture-network";
import type { InitializedProbeDependencies } from "./satanic-zone-initialized-controller";
import type { InitializedProbeOutcome, InitializedProbeProgress } from "./satanic-zone-initialized-transport";
import type { ParsedPayload } from "./packet-decoder";
import { extractSatanicZoneObservation } from "./direct-satanic-zone-protocol";

export type ElectronSatanicZoneTestPacket = Omit<ParsedPayload, "payload"> & { payload: number[] };

/** Installed only in E2E mode. No native adapter, process query or socket exists. */
export class ElectronSatanicZoneTestRuntime {
  /** Fake encryption for invented E2E material only. Production uses Electron safeStorage. */
  readonly cacheEncryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(Buffer.from(value).map(byte => byte ^ 0x5a)),
    decryptString: (value: Buffer) => Buffer.from(value.map(byte => byte ^ 0x5a)).toString("utf8"),
  };
  readonly buildIdentity = async () => "e".repeat(64);
  attemptCount = 0;
  private network: HeroSiegeNetworkState = { gameProcessIds: [], antiCheatProcessIds: [], connections: [] };
  private receive: ((packet: ParsedPayload, truncated: boolean) => void) | null = null;
  private complete: ((outcome: InitializedProbeOutcome) => void) | null = null;
  private progress: ((value: InitializedProbeProgress) => void) | null = null;
  readonly dependencies: Pick<InitializedProbeDependencies, "prepare" | "open" | "networkState" | "attempt"> = {
    prepare: async () => {
      const flow = this.network.connections[0];
      if (!flow) return { localAddress: "192.0.2.10" };
      return { localAddress: flow.localAddress, remoteAddress: flow.remoteAddress, remotePort: flow.remotePort };
    },
    open: async (_scope, receive) => {
      this.receive = receive;
      return { close: () => { if (this.receive === receive) this.receive = null; } };
    },
    networkState: async () => this.network,
    attempt: async (_input, signal, _budget, progress) => { this.attemptCount++; return new Promise(resolve => {
      this.progress = progress;
      const cancelled = () => finish("cancelled");
      const finish = (outcome: InitializedProbeOutcome) => {
        signal.removeEventListener("abort", cancelled); this.complete = null; this.progress = null; resolve(outcome);
      };
      this.complete = finish; signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) { finish("cancelled"); return; }
      progress({ stage: "zone", zoneWritten: true, inboundFrames: 2, outboundFrames: 4,
        controlFrames: 1, bytes: 0, connectAcknowledgment: null });
    }); },
  };
  setNetwork(network: HeroSiegeNetworkState): void { this.network = network; }
  emitPackets(packets: ElectronSatanicZoneTestPacket[]): void {
    for (const packet of packets) this.receive?.({ ...packet, payload: Buffer.from(packet.payload) }, false);
  }
  completeResponse(body: number[]): void {
    const zone = extractSatanicZoneObservation(Buffer.from(body), Date.now());
    if (!zone || !this.complete || !this.progress) return;
    this.progress({ stage: "zone", zoneWritten: true, inboundFrames: 3, outboundFrames: 4,
      controlFrames: 1, bytes: body.length, connectAcknowledgment: null, observation: { zone, observedAt: zone.updatedAt } });
    this.complete("success");
  }
}
