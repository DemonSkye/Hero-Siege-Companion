import net from "node:net";
import type { SatanicZoneDiagnosticState } from "../shared/satanic-zone-diagnostic";
import { buildDirectApiFrame, buildDirectApiPingFrame, buildDirectSatanicZoneFrame, extractSatanicZoneObservation } from "./direct-satanic-zone-protocol";
import type { InitializedProbeIdentity } from "./satanic-zone-initialized-protocol";
import { InitializedProbeResponseFrames, isProbeConnectAcknowledgment, summarizeProbeConnectAcknowledgment, successfulProbeIdentifier } from "./satanic-zone-initialized-protocol";
import type { DiagnosticCaptureScope } from "./satanic-zone-diagnostic-stream";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import type { SatanicZoneProviderObservation } from "./satanic-zone-refresh-provider";

export interface InitializedProbeInput {
  connectBody: Buffer;
  postLoginBody: Buffer;
  identity: InitializedProbeIdentity;
  scope: DiagnosticCaptureScope;
  nativePort: number;
}
export interface InitializedProbeProgress {
  connectAcknowledgment: SatanicZoneDiagnosticState["connectAcknowledgment"];
  stage: SatanicZoneDiagnosticState["probeStage"];
  inboundFrames: number;
  outboundFrames: number;
  controlFrames: number;
  bytes: number;
  zoneWritten: boolean;
  /** Main-only, present exclusively for a validated owned-socket response. */
  observation?: SatanicZoneProviderObservation;
}
export type InitializedProbeOutcome = "success" | "timeout" | "failed" | "cancelled" | "byte-limit";
export const INITIALIZED_PROBE_ATTEMPT_MS = 30_000;

/** One owned socket. No retry, persistence, payload logging or passive success. */
export function runInitializedSatanicZoneProbe(input: InitializedProbeInput, signal: AbortSignal,
  budget: SatanicZoneDiagnosticBufferBudget, progress: (value: InitializedProbeProgress) => void,
  socketFactory: () => net.Socket = () => new net.Socket()): Promise<InitializedProbeOutcome> {
  return new Promise(resolve => {
    const frames = new InitializedProbeResponseFrames(budget);
    const pendingWrites = new Set<Buffer>();
    let socket: net.Socket | null = null;
    let done = false;
    let stage: InitializedProbeProgress["stage"] = "connecting";
    let inboundFrames = 0, outboundFrames = 0, controlFrames = 0, bytes = 0, counter = 0;
    let zoneWritten = false;
    let globalIdentifier: string | null = null;
    let connectAcknowledgment: InitializedProbeProgress["connectAcknowledgment"] = null;
    let observation: SatanicZoneProviderObservation | undefined;
    const publish = () => progress({ stage, inboundFrames, outboundFrames, controlFrames, bytes, zoneWritten, connectAcknowledgment, observation });
    const timer = setTimeout(() => finish("timeout"), INITIALIZED_PROBE_ATTEMPT_MS);
    timer.unref?.();
    const aborted = () => finish("cancelled");
    function finish(outcome: InitializedProbeOutcome): void {
      if (done) return; done = true;
      clearTimeout(timer); signal.removeEventListener("abort", aborted);
      if (socket) {
        socket.removeListener("data", incoming); socket.removeListener("error", failed);
        socket.removeListener("close", closed); socket.removeListener("end", closed);
        socket.destroy();
      }
      frames.dispose();
      for (const frame of pendingWrites) budget.release(frame);
      pendingWrites.clear(); globalIdentifier = null;
      try { publish(); } finally { observation = undefined; resolve(outcome); }
    }
    function failed(): void { finish(budget.exceeded ? "byte-limit" : "failed"); }
    function closed(): void { finish("failed"); }
    function write(frame: Buffer, after?: () => void): void {
      if (done) { budget.release(frame); return; }
      pendingWrites.add(frame); bytes += frame.length; outboundFrames++;
      if (bytes > budget.limit) { finish("byte-limit"); return; }
      publish();
      try {
        socket!.write(frame, error => {
          pendingWrites.delete(frame); budget.release(frame);
          if (done) return;
          if (error) { finish("failed"); return; }
          try { after?.(); } catch { failed(); }
        });
      } catch { failed(); }
    }
    function incoming(chunk: Buffer): void {
      if (done) return;
      let release: (() => void) | undefined;
      let next: "post-login" | "zone" | null = null;
      const receiveStage = stage;
      try {
        release = budget.reserve(chunk.length); bytes += chunk.length;
        if (bytes > budget.limit) { finish("byte-limit"); return; }
        frames.push(chunk, body => {
          if (done) return;
          inboundFrames++;
          const opcode = body.readUInt16LE(0);
          if (opcode === 0x1000) connectAcknowledgment = summarizeProbeConnectAcknowledgment(body);
          if (body.length === 2 || opcode === 0x1000) controlFrames++;
          if (opcode === 1 && body.length === 2) return;
          if (receiveStage === "connect" && opcode === 0x1000) {
            if (!isProbeConnectAcknowledgment(body) || next) throw new Error("invalid-frame"); next = "post-login"; return;
          }
          if (receiveStage === "post-login" && opcode === 0x53) {
            const identifier = successfulProbeIdentifier(body);
            if (!identifier || next) throw new Error("invalid-frame");
            globalIdentifier = identifier; next = "zone"; return;
          }
          // A success/status arriving out of stage is ambiguous, never reusable.
          if (opcode === 0x53 || opcode === 0x1000) throw new Error("invalid-frame");
          if (receiveStage === "zone" && zoneWritten) {
            const zone = extractSatanicZoneObservation(body, Date.now());
            if (zone) { observation = { zone, observedAt: zone.updatedAt }; finish("success"); }
          }
        });
        if (done) return;
        publish();
        // Never count a coalesced pre-request zone as the requested response.
        // A partially received initialization frame also prevents advancement.
        if (next && !frames.empty) throw new Error("invalid-frame");
        if (next === "post-login") {
          stage = "post-login"; publish(); write(buildDirectApiFrame(input.postLoginBody, counter++, budget));
        } else if (next === "zone" && globalIdentifier) {
          stage = "zone"; publish();
          write(buildDirectSatanicZoneFrame({ ...input.identity, crossregionIdentifier: globalIdentifier,
            generation: 1, revision: 1, updatedAt: Date.now(), scopeKey: "initialized-probe",
            endpoint: { address: input.scope.remoteAddress, port: input.scope.remotePort } }, counter++, budget),
          () => { zoneWritten = true; publish(); });
        }
      } catch { failed(); }
      finally { release?.(); chunk.fill(0); }
    }
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) { finish("cancelled"); return; }
    try {
      socket = socketFactory();
      socket.on("data", incoming); socket.on("error", failed); socket.on("end", closed); socket.on("close", closed);
      publish();
      socket.connect(input.scope.remotePort, input.scope.remoteAddress, () => {
        if (done) return;
        // Ensure this connection is separate from the selected game-owned flow.
        if (socket!.localAddress !== input.scope.localAddress || socket!.remoteAddress !== input.scope.remoteAddress
          || socket!.remotePort !== input.scope.remotePort || !socket!.localPort || socket!.localPort === input.nativePort) {
          finish("failed"); return;
        }
        try {
          stage = "connect"; publish();
          write(buildDirectApiFrame(input.connectBody, counter++, budget), () => {
            // The verified native sender permits pings between initialization
            // operations. One initial ping advances our own application counter.
            write(buildDirectApiPingFrame(counter++, budget));
          });
        } catch { failed(); }
      });
    } catch { failed(); }
  });
}
