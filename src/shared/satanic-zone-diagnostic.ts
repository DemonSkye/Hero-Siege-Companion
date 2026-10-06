export const SZ_DIAGNOSTIC_TIMEOUT_MS = 120_000;
export const SZ_DIAGNOSTIC_MAX_BYTES = 1_048_576;

export const SZ_DIAGNOSTIC_NATIVE_FAILURES = ["native-frame-length", "native-frame-token", "native-request-counter",
  "native-connect-shape", "native-connect-repeat", "native-identity-format",
  "native-post-login-order", "native-post-login-coherence", "native-ack-order", "native-ack-format",
  "native-login-order", "native-login-format"] as const;
export type DiagnosticNativeFailure = typeof SZ_DIAGNOSTIC_NATIVE_FAILURES[number];
export type DiagnosticSelectionStatus = "idle" | "checking-capture" | "waiting-syn" | "api-flow-no-syn"
  | "endpoint-changed-no-syn" | "waiting-owner" | "attributed" | "no-api-flow" | "adapter-changed" | "ambiguous";

export type SatanicZoneDiagnosticPhase =
  | "idle" | "arming" | "waiting-initialization" | "collecting" | "ready" | "requesting"
  | "complete" | "incomplete" | "ambiguous" | "timed-out" | "cancelled" | "unavailable";
export type SatanicZoneDiagnosticReason =
  | "none" | "game-not-ready" | "adapter-unavailable" | "unsupported-capture"
  | "busy" | "scope-changed" | "missing-initialization" | "missing-baseline"
  | "stream-gap" | "invalid-frame" | "ambiguous-flow" | "byte-limit"
  | "capture-truncated" | "capture-failed" | "context-unavailable" | "direct-failed"
  | "deadline" | "user-cancelled" | "shutdown" | DiagnosticNativeFailure;
export type DiagnosticFrameKind = "ping" | "zone-request" | "connect-shaped" | "api-request" | "region-api-request" | "other-api" | "generic";
export type DiagnosticControlClassification = "not-observed" | "same-as-pong" | "other-control" | "not-control";
export interface DiagnosticConnectAcknowledgment {
  bodyBytes: number;
  opcode: "0x1000" | "0x0001" | "other" | "missing";
  trailingNul: boolean;
  embeddedNul: boolean;
}

export interface DiagnosticFrameSummary {
  direction: "outbound" | "inbound";
  kind: DiagnosticFrameKind;
  bodyBytes: number;
  counter: number | null;
  control: DiagnosticControlClassification;
  // One-based parsed frame/body ordinals; these do not pair requests and replies.
  inboundOrdinal: number | null;
  controlOrdinal: number | null;
  zoneObserved: boolean;
}

export interface DiagnosticTransportEvent {
  kind: "connected" | "bootstrap-write" | "bootstrap-pong" | "zone-write" | "response-chunk" | "second-control" | "zone-observation";
  direction: "outbound" | "inbound" | "local";
  bytes: number;
  control: DiagnosticControlClassification;
  controlOrdinal: 1 | 2 | null;
}

// This is the entire renderer/log contract. No payload, endpoint, hash, identity,
// arbitrary exception, or unrecognized protocol string belongs in it.
export interface SatanicZoneDiagnosticState {
  connectAcknowledgment: DiagnosticConnectAcknowledgment | null;
  selectionStatus: DiagnosticSelectionStatus;
  capturePackets: number;
  apiFlowCount: number;
  probeStage: "idle" | "collecting" | "ready" | "connecting" | "connect" | "post-login" | "zone" | "finished"
    | "native-connect" | "native-acknowledgment" | "native-post-login" | "native-login"
    | "native-outbound-framing" | "native-inbound-framing";
  outboundFrames: number;
  inboundFrames: number;
  controlFrames: number;
  phase: SatanicZoneDiagnosticPhase;
  reason: SatanicZoneDiagnosticReason;
  startedAt: number | null;
  deadlineAt: number | null;
  bytesObserved: number;
  peakOwnedBufferBytes: number;
  freshSyn: boolean;
  attributed: boolean;
  // Legacy key: complete captured framing, not independent-session initialization.
  initializationComplete: boolean;
  naturalBaseline: boolean;
  // First validated zone object after the native SZ request on this flow.
  nativeZoneInboundOrdinal: number | null;
  frames: DiagnosticFrameSummary[];
  directEvents: DiagnosticTransportEvent[];
  frameSummaryLimited: boolean;
  requestDispatched: boolean;
  directOutcome: "not-attempted" | "pending" | "success" | "timeout" | "failed" | "cancelled";
  // Legacy key: the first direct frame has the validated two-byte 01 00 body.
  bootstrapPong: boolean;
  secondControl: DiagnosticControlClassification;
  nativeBootstrapControl: DiagnosticControlClassification;
  secondControlMatchesNative: boolean | null;
  requestBodyMatchesNative: boolean | null;
}

export function createInitialSatanicZoneDiagnosticState(): SatanicZoneDiagnosticState {
  return {
    connectAcknowledgment: null,
    selectionStatus: "idle", capturePackets: 0, apiFlowCount: 0,
    probeStage: "idle", outboundFrames: 0, inboundFrames: 0, controlFrames: 0,
    phase: "idle", reason: "none", startedAt: null, deadlineAt: null,
    bytesObserved: 0, peakOwnedBufferBytes: 0, freshSyn: false, attributed: false, initializationComplete: false,
    naturalBaseline: false, nativeZoneInboundOrdinal: null, frames: [], directEvents: [], frameSummaryLimited: false, requestDispatched: false,
    directOutcome: "not-attempted", bootstrapPong: false, secondControl: "not-observed",
    nativeBootstrapControl: "not-observed", secondControlMatchesNative: null, requestBodyMatchesNative: null,
  };
}

export function isSatanicZoneDiagnosticActive(state: SatanicZoneDiagnosticState): boolean {
  return ["arming", "waiting-initialization", "collecting", "ready", "requesting"].includes(state.phase);
}

export function copySatanicZoneDiagnosticState(state: SatanicZoneDiagnosticState): SatanicZoneDiagnosticState {
  // Project rather than spread: internal additions can never silently become IPC.
  return {
    connectAcknowledgment: state.connectAcknowledgment ? {
      bodyBytes: state.connectAcknowledgment.bodyBytes, opcode: state.connectAcknowledgment.opcode,
      trailingNul: state.connectAcknowledgment.trailingNul, embeddedNul: state.connectAcknowledgment.embeddedNul,
    } : null,
    selectionStatus: state.selectionStatus, capturePackets: state.capturePackets, apiFlowCount: state.apiFlowCount,
    probeStage: state.probeStage, outboundFrames: state.outboundFrames,
    inboundFrames: state.inboundFrames, controlFrames: state.controlFrames,
    phase: state.phase, reason: state.reason, startedAt: state.startedAt, deadlineAt: state.deadlineAt,
    bytesObserved: state.bytesObserved, freshSyn: state.freshSyn, attributed: state.attributed,
    peakOwnedBufferBytes: state.peakOwnedBufferBytes,
    initializationComplete: state.initializationComplete, naturalBaseline: state.naturalBaseline,
    nativeZoneInboundOrdinal: state.nativeZoneInboundOrdinal,
    frames: state.frames.slice(0, 32).map((frame) => ({
      direction: frame.direction, kind: frame.kind, bodyBytes: frame.bodyBytes, counter: frame.counter, control: frame.control,
      inboundOrdinal: frame.inboundOrdinal, controlOrdinal: frame.controlOrdinal, zoneObserved: frame.zoneObserved,
    })),
    directEvents: state.directEvents.slice(0, 32).map((event) => ({ kind: event.kind, direction: event.direction,
      bytes: event.bytes, control: event.control, controlOrdinal: event.controlOrdinal })),
    frameSummaryLimited: state.frameSummaryLimited, requestDispatched: state.requestDispatched,
    directOutcome: state.directOutcome, bootstrapPong: state.bootstrapPong,
    secondControl: state.secondControl, requestBodyMatchesNative: state.requestBodyMatchesNative,
    nativeBootstrapControl: state.nativeBootstrapControl, secondControlMatchesNative: state.secondControlMatchesNative,
  };
}
