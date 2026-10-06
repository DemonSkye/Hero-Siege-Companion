import { copySatanicZoneDiagnosticState, createInitialSatanicZoneDiagnosticState, isSatanicZoneDiagnosticActive,
  SZ_DIAGNOSTIC_TIMEOUT_MS, SZ_DIAGNOSTIC_MAX_BYTES, SZ_DIAGNOSTIC_NATIVE_FAILURES,
  type SatanicZoneDiagnosticState, type SatanicZoneDiagnosticReason } from "../shared/satanic-zone-diagnostic";
import type { SatanicZoneDiagnosticDependencies, DiagnosticCaptureHandle } from "./satanic-zone-diagnostic-controller";
import { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import { SatanicZoneDiagnosticStream, DiagnosticFrameError, type DiagnosticFrame, type DiagnosticCaptureScope } from "./satanic-zone-diagnostic-stream";
import { connectProbeIdentity, coherentProbePostLogin, isProbePostLogin, isProbeConnectAcknowledgment, summarizeProbeConnectAcknowledgment, successfulProbeIdentifier,
  type InitializedProbeIdentity } from "./satanic-zone-initialized-protocol";
import { runInitializedSatanicZoneProbe, INITIALIZED_PROBE_ATTEMPT_MS } from "./satanic-zone-initialized-transport";
import { createDiagnosticCaptureDependencies } from "./satanic-zone-diagnostic-runtime";
import type { ParsedPayload } from "./packet-decoder";

export interface InitializedProbeDependencies extends Pick<SatanicZoneDiagnosticDependencies, "prepare" | "open" | "networkState" | "canArm" | "onChange"> {
  attempt: typeof runInitializedSatanicZoneProbe;
  now?: () => number;
}
interface Session {
  budget: SatanicZoneDiagnosticBufferBudget;
  abort: AbortController;
  scope: DiagnosticCaptureScope | null;
  captureScope: DiagnosticCaptureScope | null;
  stream: SatanicZoneDiagnosticStream | null;
  handle: DiagnosticCaptureHandle | null;
  deadline: ReturnType<typeof setTimeout>;
  poll: ReturnType<typeof setTimeout> | null;
  pid: number | null;
  identity: InitializedProbeIdentity | null;
  connectBody: Buffer | null;
  postLoginBody: Buffer | null;
  readyControl: boolean;
  loginSuccess: boolean;
  starting: boolean;
}
const STREAM_FAILURES = new Set<string>(["stream-gap", "invalid-frame", "ambiguous-flow", "byte-limit", ...SZ_DIAGNOSTIC_NATIVE_FAILURES]);

/** Exact native bodies are main-process RAM only, bounded by this session. */
export class SatanicZoneInitializedProbeController {
  private state = createInitialSatanicZoneDiagnosticState();
  private session: Session | null = null;
  private disposed = false;
  private nextAllowedAt = 0;
  private readonly now: () => number;
  constructor(private readonly dependencies: InitializedProbeDependencies) { this.now = dependencies.now ?? Date.now; }
  snapshot(): SatanicZoneDiagnosticState { return copySatanicZoneDiagnosticState(this.state); }
  get active(): boolean { return isSatanicZoneDiagnosticActive(this.state); }
  get blocksManualRefresh(): boolean { return this.active || this.now() < this.nextAllowedAt; }
  arm(): SatanicZoneDiagnosticState {
    if (this.disposed || this.active) return this.snapshot();
    this.state = createInitialSatanicZoneDiagnosticState();
    if (this.blocksManualRefresh || !this.dependencies.canArm()) {
      this.state.phase = "unavailable"; this.state.reason = "busy"; this.publish(); return this.snapshot();
    }
    const session: Session = { budget: new SatanicZoneDiagnosticBufferBudget(), abort: new AbortController(),
      scope: null, captureScope: null, stream: null, handle: null, poll: null, pid: null, identity: null, connectBody: null, postLoginBody: null,
      readyControl: false, loginSuccess: false, starting: false,
      deadline: setTimeout(() => this.finish(session, "timed-out", this.state.phase === "ready" ? "deadline" : "missing-initialization"), SZ_DIAGNOSTIC_TIMEOUT_MS) };
    session.deadline.unref?.(); this.session = session;
    this.state.phase = "arming"; this.state.probeStage = "collecting";
    this.state.selectionStatus = "checking-capture";
    this.state.startedAt = this.now(); this.state.deadlineAt = this.now() + SZ_DIAGNOSTIC_TIMEOUT_MS;
    // Main's synchronous onChange suspends raw logging BEFORE prepare/open.
    this.publish(); void this.collect(session); return this.snapshot();
  }
  startAttempt(): SatanicZoneDiagnosticState {
    const session = this.session;
    if (!session || this.state.phase !== "ready" || session.starting) return this.snapshot();
    session.starting = true; this.state.phase = "requesting"; this.state.probeStage = "connecting";
    this.state.outboundFrames = 0; this.state.inboundFrames = 0; this.state.controlFrames = 0;
    this.state.connectAcknowledgment = null;
    clearTimeout(session.deadline);
    session.deadline = setTimeout(() => this.finish(session, "timed-out", "deadline"), INITIALIZED_PROBE_ATTEMPT_MS);
    session.deadline.unref?.(); this.state.deadlineAt = this.now() + INITIALIZED_PROBE_ATTEMPT_MS;
    this.publish(); void this.attempt(session); return this.snapshot();
  }
  cancel(reason: "user-cancelled" | "shutdown" = "user-cancelled"): SatanicZoneDiagnosticState {
    if (this.session) this.finish(this.session, "cancelled", reason);
    return this.snapshot();
  }
  dispose(): void { this.disposed = true; this.cancel("shutdown"); }
  private current(session: Session): boolean { return this.session === session && !session.abort.signal.aborted; }
  private async collect(session: Session): Promise<void> {
    try {
      const scope = await this.dependencies.prepare(); if (!this.current(session)) return;
      session.captureScope = scope;
      const handle = await this.dependencies.open(scope, (packet, truncated) => this.packet(session, packet, truncated),
        () => this.finish(session, "incomplete", "capture-failed"), session.budget);
      if (!this.current(session)) { handle.close(); return; }
      session.handle = handle;
      this.state.phase = session.stream?.freshSyn ? "collecting" : "waiting-initialization";
      this.state.selectionStatus = session.stream ? "waiting-owner" : "waiting-syn";
      this.publish(); void this.poll(session);
    } catch { if (this.current(session)) this.finish(session, "unavailable", session.captureScope ? "adapter-unavailable" : "game-not-ready"); }
  }
  private packet(session: Session, packet: ParsedPayload, truncated: boolean): void {
    if (!this.current(session) || !session.captureScope) return;
    this.state.capturePackets++;
    const local = session.captureScope.localAddress;
    const outbound = packet.src === local;
    if (!outbound && packet.dst !== local) return;
    const remoteAddress = outbound ? packet.dst : packet.src;
    const remotePort = outbound ? packet.dstPort : packet.srcPort;
    if (![6668, 6669].includes(remotePort) || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(remoteAddress)) return;
    if (truncated) { this.finish(session, "incomplete", "capture-truncated"); return; }
    const freshSyn = outbound && (packet.flags & 2) !== 0 && (packet.flags & 16) === 0;
    if (!session.stream) {
      if (!freshSyn) { this.publish(); return; }
      session.scope = { localAddress: local, remoteAddress, remotePort };
      session.stream = new SatanicZoneDiagnosticStream(session.scope, frame => this.frame(session, frame), session.budget);
      this.state.selectionStatus = "waiting-owner";
    } else if (freshSyn && !session.stream.matches(packet)) {
      this.state.selectionStatus = "ambiguous"; this.finish(session, "ambiguous", "ambiguous-flow"); return;
    }
    if (!session.stream.matches(packet)) return;
    const localPort = outbound ? packet.srcPort : packet.dstPort;
    if (session.stream.port !== null && session.stream.port !== localPort && !freshSyn) return;
    if (packet.payload.length > SZ_DIAGNOSTIC_MAX_BYTES - this.state.bytesObserved) {
      this.finish(session, "incomplete", "byte-limit"); return;
    }
    this.state.bytesObserved += packet.payload.length;
    try {
      session.stream.push(packet); this.state.freshSyn = session.stream.freshSyn;
      if (this.state.freshSyn && this.state.phase === "waiting-initialization") this.state.phase = "collecting";
      this.checkReady(session); this.publish();
    } catch (error) { this.collectionFailure(session, error, "invalid-frame"); }
  }
  private frame(session: Session, frame: DiagnosticFrame): void {
    if (!this.current(session)) return;
    if (frame.outbound) this.state.outboundFrames++; else this.state.inboundFrames++;
    if (frame.body.length === 2 || (frame.body.length >= 2 && frame.body.readUInt16LE(0) === 0x1000)) this.state.controlFrames++;
    if (frame.outbound) {
      if (frame.kind === "connect-shaped") {
        this.state.probeStage = "native-connect";
        const identity = connectProbeIdentity(frame.body);
        if (session.connectBody) throw new Error("native-connect-repeat");
        // Fresh SYN/PID/tuple attribution establishes the captured prefix. A
        // native sender may start at a nonzero counter; the stream validates
        // its token and subsequent outbound continuity independently.
        if (!identity) throw new Error("native-identity-format");
        session.identity = identity; session.connectBody = session.budget.copy(frame.body);
      } else if (isProbePostLogin(frame.body)) {
        this.state.probeStage = "native-post-login";
        if (!session.identity || !session.readyControl || session.postLoginBody) throw new Error("native-post-login-order");
        if (!coherentProbePostLogin(frame.body, session.identity)) throw new Error("native-post-login-coherence");
        session.postLoginBody = session.budget.copy(frame.body);
      } else if (!session.connectBody && frame.kind !== "ping") {
        this.state.probeStage = "native-connect"; throw new Error("native-connect-shape");
      }
    } else if (frame.body.length >= 2) {
      const opcode = frame.body.readUInt16LE(0);
      if (opcode === 0x1000) {
        this.state.connectAcknowledgment = summarizeProbeConnectAcknowledgment(frame.body);
        this.state.probeStage = "native-acknowledgment";
        if (!session.connectBody || session.readyControl) throw new Error("native-ack-order");
        if (!isProbeConnectAcknowledgment(frame.body)) throw new Error("native-ack-format");
        session.readyControl = true;
      } else if (opcode === 0x53) {
        this.state.probeStage = "native-login";
        if (!session.postLoginBody || session.loginSuccess) throw new Error("native-login-order");
        if (!successfulProbeIdentifier(frame.body)) throw new Error("native-login-format");
        session.loginSuccess = true;
      }
    }
  }
  private checkReady(session: Session): void {
    if (!this.current(session) || session.starting) return;
    this.state.initializationComplete = Boolean(session.stream?.complete);
    if (this.state.attributed && this.state.initializationComplete && session.connectBody && session.postLoginBody && session.loginSuccess) {
      this.state.phase = "ready"; this.state.probeStage = "ready";
    } else if (this.state.phase === "ready") { this.state.phase = "collecting"; this.state.probeStage = "collecting"; }
  }
  private async attributed(session: Session): Promise<boolean> {
    const network = await this.dependencies.networkState();
    if (!this.current(session) || !session.captureScope) return false;
    const apiFlows = network.connections.filter(connection => network.gameProcessIds.includes(connection.owningProcess)
      && [6668, 6669].includes(connection.remotePort));
    this.state.apiFlowCount = Math.min(32, apiFlows.length);
    if (!session.scope || !session.stream) {
      const onAdapter = apiFlows.filter(connection => connection.localAddress === session.captureScope!.localAddress);
      if (apiFlows.length && !onAdapter.length) {
        this.state.selectionStatus = "adapter-changed"; this.finish(session, "incomplete", "scope-changed"); return false;
      }
      const previous = session.captureScope;
      this.state.selectionStatus = !onAdapter.length ? "no-api-flow"
        : onAdapter.some(connection => connection.remoteAddress !== previous.remoteAddress || connection.remotePort !== previous.remotePort)
          ? "endpoint-changed-no-syn" : "api-flow-no-syn";
      this.publish(); return false;
    }
    const scope = session.scope;
    const candidates = network.connections.filter(connection => network.gameProcessIds.includes(connection.owningProcess)
      && connection.localAddress === scope.localAddress && connection.remoteAddress === scope.remoteAddress
      && connection.remotePort === scope.remotePort && connection.localPort === session.stream!.port);
    if (candidates.length > 1) { this.state.selectionStatus = "ambiguous"; this.finish(session, "ambiguous", "ambiguous-flow"); return false; }
    if (session.pid !== null && (candidates.length !== 1 || candidates[0].owningProcess !== session.pid
      || !network.gameProcessIds.includes(session.pid))) { this.finish(session, "incomplete", "scope-changed"); return false; }
    if (session.pid === null && candidates.length === 1 && session.stream.freshSyn) {
      session.pid = candidates[0].owningProcess; this.state.attributed = true; this.state.selectionStatus = "attributed";
      session.stream.attribute(); this.checkReady(session); this.publish();
    } else if (session.pid === null) {
      this.state.selectionStatus = "waiting-owner"; this.publish();
    }
    return session.pid !== null;
  }
  private async poll(session: Session): Promise<void> {
    try { await this.attributed(session); }
    catch (error) { this.collectionFailure(session, error, "capture-failed"); }
    if (this.current(session) && !session.starting) {
      session.poll = setTimeout(() => { session.poll = null; void this.poll(session); }, 1000); session.poll.unref?.();
    }
  }
  private collectionFailure(session: Session, error: unknown, fallback: SatanicZoneDiagnosticReason): void {
    if (!this.current(session)) return;
    const reason = error instanceof DiagnosticFrameError ? error.reason
      : error instanceof Error && STREAM_FAILURES.has(error.message) ? error.message as SatanicZoneDiagnosticReason : fallback;
    if (error instanceof DiagnosticFrameError) this.state.probeStage = error.direction === "outbound" ? "native-outbound-framing" : "native-inbound-framing";
    if (reason === "ambiguous-flow") this.state.selectionStatus = "ambiguous";
    this.finish(session, reason === "ambiguous-flow" ? "ambiguous" : "incomplete", reason);
  }
  private async attempt(session: Session): Promise<void> {
    try {
      if (!await this.attributed(session) || !this.current(session)) return;
      if (!session.stream?.complete || !session.scope || !session.connectBody || !session.postLoginBody || !session.identity || !session.loginSuccess) {
        this.finish(session, "incomplete", "context-unavailable"); return;
      }
      const nativePort = session.stream.port!;
      if (!this.closeCapture(session)) { this.finish(session, "incomplete", "capture-failed"); return; }
      this.state.directOutcome = "pending"; this.nextAllowedAt = this.now() + INITIALIZED_PROBE_ATTEMPT_MS;
      const result = await this.dependencies.attempt({ connectBody: session.connectBody, postLoginBody: session.postLoginBody,
        identity: session.identity, scope: session.scope, nativePort }, session.abort.signal, session.budget, value => {
        if (!this.current(session)) return;
        this.state.probeStage = value.stage; this.state.inboundFrames = value.inboundFrames;
        this.state.outboundFrames = value.outboundFrames; this.state.controlFrames = value.controlFrames;
        this.state.requestDispatched = value.zoneWritten; this.state.connectAcknowledgment = value.connectAcknowledgment; this.publish();
      });
      if (!this.current(session)) return;
      this.state.directOutcome = result === "byte-limit" ? "failed" : result;
      this.finish(session, result === "success" ? "complete" : result === "timeout" ? "timed-out" : "incomplete",
        result === "success" ? "none" : result === "timeout" ? "deadline" : result === "byte-limit" ? "byte-limit" : "direct-failed");
    } catch { if (this.current(session)) this.finish(session, "incomplete", "direct-failed"); }
  }
  private closeCapture(session: Session): boolean {
    if (session.poll) clearTimeout(session.poll); session.poll = null;
    let closed = true;
    try { session.handle?.close(); } catch { closed = false; } session.handle = null;
    session.stream?.dispose(); session.stream = null;
    return closed;
  }
  private finish(session: Session, phase: SatanicZoneDiagnosticState["phase"], reason: SatanicZoneDiagnosticReason): void {
    if (!this.current(session)) return;
    this.session = null; clearTimeout(session.deadline); session.abort.abort(); this.closeCapture(session);
    session.budget.dispose(); session.connectBody = null; session.postLoginBody = null;
    if (session.identity) { session.identity.uniqueAccountId = ""; session.identity.beta = ""; }
    session.identity = null; session.scope = null; session.captureScope = null; session.pid = null;
    this.state.peakOwnedBufferBytes = session.budget.peakBytes;
    if (this.state.directOutcome === "pending") this.state.directOutcome = phase === "cancelled" ? "cancelled" : phase === "timed-out" ? "timeout" : "failed";
    this.state.phase = phase; this.state.reason = reason;
    // Keep the last stage so timeout/failure identifies the decisive boundary.
    this.publish();
  }
  private publish(): void {
    if (this.session) this.state.peakOwnedBufferBytes = this.session.budget.peakBytes;
    this.dependencies.onChange(this.snapshot());
  }
}

export function createSatanicZoneInitializedProbeRuntime(options: Pick<InitializedProbeDependencies, "canArm" | "onChange"> & { syntheticOnly?: boolean }): SatanicZoneInitializedProbeController {
  return new SatanicZoneInitializedProbeController({ ...options, ...createDiagnosticCaptureDependencies(options.syntheticOnly, "fresh-api"),
    attempt: (input, signal, budget, progress) => options.syntheticOnly ? Promise.resolve("failed")
      : runInitializedSatanicZoneProbe(input, signal, budget, progress) });
}
