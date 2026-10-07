import { copySatanicZoneDiagnosticState, createInitialSatanicZoneDiagnosticState, isSatanicZoneDiagnosticActive,
  SZ_DIAGNOSTIC_TIMEOUT_MS, SZ_DIAGNOSTIC_MAX_BYTES, SZ_DIAGNOSTIC_NATIVE_FAILURES,
  type SatanicZoneDiagnosticState, type SatanicZoneDiagnosticReason } from "../shared/satanic-zone-diagnostic";
import type { SatanicZoneDiagnosticDependencies, DiagnosticCaptureHandle } from "./satanic-zone-diagnostic-controller";
import { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import { SatanicZoneDiagnosticStream, DiagnosticFrameError, type DiagnosticFrame, type DiagnosticCaptureScope, type SatanicZoneListenScope } from "./satanic-zone-diagnostic-stream";
import { connectProbeIdentity, coherentProbePostLogin, isProbePostLogin, isProbeConnectAcknowledgment, summarizeProbeConnectAcknowledgment, successfulProbeIdentifier,
  type InitializedProbeIdentity } from "./satanic-zone-initialized-protocol";
import { runInitializedSatanicZoneProbe, INITIALIZED_PROBE_ATTEMPT_MS, type InitializedProbeInput } from "./satanic-zone-initialized-transport";
import { createDiagnosticCaptureDependencies, type SatanicZoneWatchDiagnosticListener } from "./satanic-zone-diagnostic-runtime";
import type { ParsedPayload, CapturedTcpLifecycle } from "./packet-decoder";
import type { SatanicZoneProviderObservation } from "./satanic-zone-refresh-provider";
import type { CapturedSessionPayload } from "./captured-session-context";
import { extractSessionContextMessages } from "./session-context-fields";
import type { CaptureConnection } from "../shared/app-state";
import { satanicZoneSessionScopeStatus, satanicZoneSessionTerminated } from "./satanic-zone-session-scope";
import { extractSatanicZoneObservation } from "./direct-satanic-zone-protocol";

export interface InitializedProbeDependencies extends Pick<SatanicZoneDiagnosticDependencies<SatanicZoneListenScope>, "prepare" | "open" | "networkState" | "canArm" | "onChange"> {
  attempt: typeof runInitializedSatanicZoneProbe;
  now?: () => number;
  /** Product use retains the prefix in RAM for the observed game session. */
  retainContext?: boolean;
  /** Product listener stays open for ordinary reconnects; advanced probes stay bounded. */
  autoWatch?: boolean;
  /** Product owner shares one budget with a suspended context during reacquisition. */
  bufferBudget?: SatanicZoneDiagnosticBufferBudget;
  onObservation?: (observation: SatanicZoneProviderObservation) => void;
  onPassiveObservation?: (observation: SatanicZoneProviderObservation) => void;
  onSessionPayload?: (payload: CapturedSessionPayload) => void;
  onInvalidation?: () => void;
  onWatchDiagnostic?: SatanicZoneWatchDiagnosticListener;
  onPrepared?: (input: InitializedProbeInput, pid: number) => void;
  validateCached?: (scope: import("./satanic-zone-session-scope").SatanicZoneSessionScope) => Promise<boolean>;
}
interface Session {
  budget: SatanicZoneDiagnosticBufferBudget;
  abort: AbortController;
  scope: DiagnosticCaptureScope | null;
  captureScope: SatanicZoneListenScope | null;
  opening: Promise<boolean>;
  stream: SatanicZoneDiagnosticStream | null;
  handle: DiagnosticCaptureHandle | null;
  deadline: ReturnType<typeof setTimeout> | null;
  attemptAbort: AbortController | null;
  poll: ReturnType<typeof setTimeout> | null;
  polling: boolean;
  pid: number | null;
  identity: InitializedProbeIdentity | null;
  connectBody: Buffer | null;
  postLoginBody: Buffer | null;
  readyControl: boolean;
  loginSuccess: boolean;
  starting: boolean;
  nativePort: number | null;
  prepared: boolean;
  suspended: boolean;
  ownedFlows: Array<DiagnosticCaptureScope & { localPort: number }>;
  pendingSyn: ParsedPayload[] | null;
  cached: boolean;
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
  get continuitySuspended(): boolean { return this.session?.suspended ?? false; }
  get cachedContext(): boolean { return this.session?.cached ?? false; }
  get continuityIncomplete(): boolean {
    const session = this.session;
    return Boolean(session?.prepared && !session.cached && !session.suspended && session.stream && !session.stream.outboundComplete);
  }
  get observesContinuity(): boolean {
    const session = this.session;
    // A live attributed observer still covers a gameplay-only gap while a
    // frame is partial. Dispatch remains blocked until outbound evidence completes.
    return Boolean(this.dependencies.autoWatch && session?.prepared && !session.cached && !session.suspended && session.handle
      && session.stream?.observesBothDirections);
  }
  rememberCurrent(): void {
    const session = this.session;
    if (session?.prepared && !session.cached && !session.suspended) this.dependencies.onPrepared?.(this.preparedInput(session), session.pid!);
  }
  /** Experimental restore has fresh identity/flow validation, distinct from native initialization. */
  restoreCached(input: InitializedProbeInput & { pid: number }): boolean {
    const session = this.session;
    if (!session?.handle || session.prepared || session.stream || session.suspended || input.scope.localAddress !== session.captureScope?.localAddress
      || !this.dependencies.autoWatch || !this.dependencies.validateCached) return false;
    try {
      session.connectBody = session.budget.copy(input.connectBody);
      session.postLoginBody = session.budget.copy(input.postLoginBody);
      session.identity = { ...input.identity }; session.scope = { ...input.scope };
      session.pid = input.pid; session.nativePort = input.nativePort;
      session.prepared = true; session.cached = true; session.loginSuccess = true;
      if (session.poll) clearTimeout(session.poll); session.poll = null;
      this.state.phase = "ready"; this.state.probeStage = "ready"; this.state.attributed = true;
      this.publish(); return true;
    } catch { this.finish(session, "incomplete", "byte-limit"); return false; }
  }
  get blocksManualRefresh(): boolean { return this.active || this.now() < this.nextAllowedAt; }
  async waitForListener(): Promise<boolean> { return this.session ? this.session.opening : false; }
  arm(): SatanicZoneDiagnosticState {
    if (this.disposed || this.active) return this.snapshot();
    this.state = createInitialSatanicZoneDiagnosticState();
    if (this.blocksManualRefresh || !this.dependencies.canArm()) {
      this.state.phase = "unavailable"; this.state.reason = "busy"; this.publish(); return this.snapshot();
    }
    const session: Session = { budget: this.dependencies.bufferBudget ?? new SatanicZoneDiagnosticBufferBudget(), abort: new AbortController(),
      scope: null, captureScope: null, stream: null, handle: null, poll: null, polling: false, pid: null, identity: null, connectBody: null, postLoginBody: null,
      readyControl: false, loginSuccess: false, starting: false, nativePort: null, prepared: false, suspended: false,
      attemptAbort: null, opening: Promise.resolve(false), ownedFlows: [], pendingSyn: null, cached: false,
      deadline: this.dependencies.autoWatch ? null : setTimeout(() => this.finish(session, "timed-out", this.state.phase === "ready" ? "deadline" : "missing-initialization"), SZ_DIAGNOSTIC_TIMEOUT_MS) };
    session.deadline?.unref?.(); this.session = session;
    this.state.phase = "arming"; this.state.probeStage = "collecting";
    this.state.selectionStatus = "checking-capture";
    this.state.startedAt = this.now(); this.state.deadlineAt = this.dependencies.autoWatch ? null : this.now() + SZ_DIAGNOSTIC_TIMEOUT_MS;
    // Main's synchronous onChange suspends raw logging BEFORE prepare/open.
    this.publish(); session.opening = this.collect(session); return this.snapshot();
  }
  startAttempt(): SatanicZoneDiagnosticState {
    const session = this.session;
    if (!session || this.state.phase !== "ready" || session.starting || session.suspended) return this.snapshot();
    session.starting = true; this.state.phase = "requesting"; this.state.probeStage = "connecting";
    this.state.outboundFrames = 0; this.state.inboundFrames = 0; this.state.controlFrames = 0;
    this.state.connectAcknowledgment = null;
    this.state.requestDispatched = false; this.state.directOutcome = "not-attempted";
    if (session.deadline) clearTimeout(session.deadline);
    const attemptAbort = new AbortController(); session.attemptAbort = attemptAbort;
    const deadlineAt = this.now() + INITIALIZED_PROBE_ATTEMPT_MS;
    session.deadline = setTimeout(() => session.prepared ? this.restoreReady(session, "timeout")
      : this.finish(session, "timed-out", "deadline"), INITIALIZED_PROBE_ATTEMPT_MS);
    session.deadline.unref?.(); this.state.deadlineAt = deadlineAt;
    this.publish(); void this.attempt(session, attemptAbort); return this.snapshot();
  }
  cancelAttempt(): void {
    if (this.session?.prepared && this.session.starting) this.restoreReady(this.session, "cancelled");
    else if (this.session && !this.session.prepared) this.cancel();
  }
  /** Retain RAM across a blind interval, but never infer continuity from a tuple. */
  suspend(): void {
    const session = this.session;
    if (!session?.prepared) { this.cancelAttempt(); return; }
    if (session.suspended) return;
    session.suspended = true;
    this.closeCapture(session);
    if (session.starting) this.restoreReady(session, "cancelled"); else this.publish();
  }
  cancel(reason: "user-cancelled" | "shutdown" = "user-cancelled"): SatanicZoneDiagnosticState {
    if (this.session) this.finish(this.session, "cancelled", reason);
    return this.snapshot();
  }
  dispose(): void { this.disposed = true; this.cancel("shutdown"); }
  /** Invalidate prepared credentials on observed account/generation changes. */
  invalidate(): void {
    const session = this.session;
    if (!session) return;
    if (this.dependencies.autoWatch && session.prepared && session.handle && !session.suspended) this.resetInitialization(session);
    else { if (!session.cached) this.dependencies.onInvalidation?.(); this.finish(session, "incomplete", "scope-changed"); }
  }
  observeProcessIds(ids: readonly number[]): void {
    if (this.session?.pid !== null && this.session?.pid !== undefined && !ids.includes(this.session.pid)) this.invalidate();
  }
  observeSessionPayload(payload: CapturedSessionPayload): void {
    const session = this.session;
    if (!session?.prepared || !session.identity || payload.direction !== "outbound") return;
    for (const { fields } of extractSessionContextMessages(payload.text)) {
      if ((fields.unique_account_id !== undefined && fields.unique_account_id !== session.identity.uniqueAccountId)
        || (fields.beta !== undefined && fields.beta !== session.identity.beta)) { this.invalidate(); return; }
    }
  }
  /** Reuses normal capture's game-owned topology updates; no ready-state polling. */
  observeConnections(connections: readonly CaptureConnection[]): void {
    const session = this.session;
    if (!session?.prepared || !session.scope) return;
    if (satanicZoneSessionScopeStatus({ ...session.scope, pid: session.pid!, localPort: session.nativePort! }, connections) === "changed") this.invalidate();
  }
  observeTcpLifecycle(packet: CapturedTcpLifecycle): void {
    const session = this.session;
    if (session?.prepared && session.scope && satanicZoneSessionTerminated(
      { ...session.scope, pid: session.pid!, localPort: session.nativePort! }, packet)) this.invalidate();
  }
  private current(session: Session): boolean { return this.session === session && !session.abort.signal.aborted; }
  private async collect(session: Session): Promise<boolean> {
    try {
      const scope = await this.dependencies.prepare(); if (!this.current(session)) return false;
      session.captureScope = scope;
      const handle = await this.dependencies.open(scope, (packet, truncated) => this.packet(session, packet, truncated),
        () => this.finish(session, "incomplete", "capture-failed"), session.budget);
      if (!this.current(session)) { handle.close(); return false; }
      session.handle = handle;
      this.dependencies.onWatchDiagnostic?.({ stage: "listener_ready", freshSyn: this.state.freshSyn, attributed: this.state.attributed });
      this.state.phase = session.stream?.freshSyn ? "collecting" : "waiting-initialization";
      this.state.selectionStatus = session.stream ? "waiting-owner" : "waiting-syn";
      this.publish(); void this.poll(session); return true;
    } catch { if (this.current(session)) this.finish(session, "unavailable", session.captureScope ? "adapter-unavailable" : "game-not-ready"); return false; }
  }
  private packet(session: Session, packet: ParsedPayload, truncated: boolean): void {
    if (!this.current(session) || !session.captureScope || session.suspended) return;
    this.state.capturePackets++;
    const local = session.captureScope.localAddress;
    const outbound = packet.src === local;
    if (!outbound && packet.dst !== local) return;
    const remoteAddress = outbound ? packet.dst : packet.src;
    const remotePort = outbound ? packet.dstPort : packet.srcPort;
    if (![6668, 6669].includes(remotePort) || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(remoteAddress)) return;
    if (truncated) { this.finish(session, "incomplete", "capture-truncated"); return; }
    const freshSyn = outbound && (packet.flags & 2) !== 0 && (packet.flags & 16) === 0;
    if (freshSyn && session.ownedFlows.some(flow => flow.localAddress === packet.src && flow.localPort === packet.srcPort
      && flow.remoteAddress === packet.dst && flow.remotePort === packet.dstPort)) return;
    if (session.pendingSyn && samePacketFlow(session.pendingSyn[0], packet)) {
      this.queueSynPacket(session, packet); return;
    }
    if (session.prepared) {
      const terminated = session.scope && satanicZoneSessionTerminated(
        { ...session.scope, pid: session.pid!, localPort: session.nativePort! }, packet);
      // Our explicit owned connection is a separate tuple. It must not replace
      // game readiness; game scope changes are still checked before/after sending.
      if (!this.dependencies.autoWatch) return;
      if (!terminated && !freshSyn) {
        if (session.stream?.matches(packet) && (outbound ? packet.srcPort : packet.dstPort) === session.nativePort) {
          const incomplete = this.continuityIncomplete;
          try {
            session.stream.push(packet);
            if (this.current(session) && session.prepared && incomplete !== this.continuityIncomplete) this.publish();
          }
          catch (error) { this.collectionFailure(session, error, "invalid-frame"); }
        }
        return;
      }
      if (freshSyn && session.starting) return;
      if (freshSyn) { this.verifyReconnectSyn(session, packet); return; }
      this.resetInitialization(session);
      if (!freshSyn) return;
    }
    if (!session.stream) {
      if (!freshSyn) { this.publish(); return; }
      session.scope = { localAddress: local, remoteAddress, remotePort };
      session.stream = new SatanicZoneDiagnosticStream(session.scope, frame => this.frame(session, frame), session.budget);
      if (this.dependencies.autoWatch) {
        session.deadline = setTimeout(() => this.finish(session, "timed-out", "missing-initialization"), SZ_DIAGNOSTIC_TIMEOUT_MS);
        session.deadline.unref?.(); this.state.deadlineAt = this.now() + SZ_DIAGNOSTIC_TIMEOUT_MS;
        if (!session.poll) void this.poll(session);
      }
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
      const selectedSyn = !this.state.freshSyn;
      session.stream.push(packet); this.state.freshSyn = session.stream.freshSyn;
      if (selectedSyn && this.state.freshSyn) this.dependencies.onWatchDiagnostic?.({ stage: "syn_selected", freshSyn: true, attributed: this.state.attributed });
      if (this.state.freshSyn && this.state.phase === "waiting-initialization") this.state.phase = "collecting";
      this.checkReady(session); this.publish();
    } catch (error) { this.collectionFailure(session, error, "invalid-frame"); }
  }
  /** Preserve Ready until a new SYN is attributed to the game, including pre-connect owned failures. */
  private verifyReconnectSyn(session: Session, packet: ParsedPayload): void {
    if (session.pendingSyn) return;
    session.pendingSyn = [];
    if (!this.queueSynPacket(session, packet)) return;
    const queued = session.pendingSyn;
    void this.dependencies.networkState().then(network => {
      if (!this.current(session) || session.pendingSyn !== queued || !session.prepared) return;
      const owned = network.connections.filter(flow => network.gameProcessIds.includes(flow.owningProcess)
        && flow.localAddress === packet.src && flow.localPort === packet.srcPort
        && flow.remoteAddress === packet.dst && flow.remotePort === packet.dstPort);
      if (owned.length !== 1) return;
      session.pendingSyn = null;
      this.resetInitialization(session);
      for (const captured of queued) this.packet(session, captured, false);
    }).catch(() => undefined).finally(() => {
      if (session.pendingSyn === queued) session.pendingSyn = null;
      for (const captured of queued) session.budget.release(captured.payload);
    });
  }
  private queueSynPacket(session: Session, packet: ParsedPayload): boolean {
    const queue = session.pendingSyn;
    if (!queue) return false;
    try {
      if (queue.length >= 128) throw new Error();
      queue.push({ ...packet, payload: session.budget.copy(packet.payload), text: "" }); return true;
    } catch {
      session.pendingSyn = null; for (const captured of queue) session.budget.release(captured.payload); return false;
    }
  }
  private frame(session: Session, frame: DiagnosticFrame): void {
    if (!this.current(session)) return;
    if (frame.outbound && session.prepared && this.dependencies.autoWatch && session.scope) {
      const payload: CapturedSessionPayload = { text: frame.body.toString("utf8"), direction: "outbound", observedAt: this.now(),
        ...session.scope, localPort: session.nativePort! };
      this.dependencies.onSessionPayload?.(payload);
      if (!this.current(session) || !session.prepared) return;
      this.observeSessionPayload(payload);
      // Invalidation may synchronously dispose this stream and zero its body.
      if (!this.current(session) || !session.prepared) return;
    }
    // Only the attributed game stream reaches this callback. Passive native SZ
    // updates are separate from the owned socket's manual completion channel.
    if (!frame.outbound && this.dependencies.autoWatch) {
      const zone = extractSatanicZoneObservation(frame.body, this.now());
      if (zone) this.dependencies.onPassiveObservation?.({ zone, observedAt: zone.updatedAt });
    }
    if (!this.current(session) || session.prepared) return;
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
    if (!this.current(session) || session.starting || session.prepared) return;
    this.state.initializationComplete = Boolean(session.stream?.complete);
    if (this.state.attributed && this.state.initializationComplete && session.connectBody && session.postLoginBody && session.loginSuccess) {
      this.state.phase = "ready"; this.state.probeStage = "ready";
      if (this.dependencies.retainContext) {
        session.nativePort = session.stream!.port; session.prepared = true;
        if (session.deadline) clearTimeout(session.deadline); session.deadline = null; this.state.deadlineAt = null;
        if (this.dependencies.autoWatch) {
          if (session.poll) clearTimeout(session.poll); session.poll = null;
          session.stream?.continueBothDirections();
        } else if (!this.closeCapture(session)) this.finish(session, "incomplete", "capture-failed");
        if (this.current(session)) this.dependencies.onPrepared?.(this.preparedInput(session), session.pid!);
      }
    } else if (this.state.phase === "ready") { this.state.phase = "collecting"; this.state.probeStage = "collecting"; }
  }
  private async attributed(session: Session, attemptAbort?: AbortController): Promise<boolean> {
    const network = await this.dependencies.networkState();
    if (!this.current(session) || !session.captureScope || (attemptAbort && !this.currentAttempt(session, attemptAbort))) return false;
    const apiFlows = network.connections.filter(connection => network.gameProcessIds.includes(connection.owningProcess)
      && [6668, 6669].includes(connection.remotePort));
    this.state.apiFlowCount = Math.min(32, apiFlows.length);
    if (!session.scope || (!session.stream && session.nativePort === null)) {
      const onAdapter = apiFlows.filter(connection => connection.localAddress === session.captureScope!.localAddress);
      if (apiFlows.length && !onAdapter.length) {
        this.state.selectionStatus = "adapter-changed"; this.finish(session, "incomplete", "scope-changed"); return false;
      }
      const previous = session.captureScope;
      this.state.selectionStatus = !onAdapter.length ? "no-api-flow"
        : previous.remoteAddress && onAdapter.some(connection => connection.remoteAddress !== previous.remoteAddress || connection.remotePort !== previous.remotePort)
          ? "endpoint-changed-no-syn" : "api-flow-no-syn";
      this.publish(); return false;
    }
    const scope = session.scope;
    if (session.prepared) {
      if (session.suspended) { this.restoreReady(session, "failed"); return false; }
      // A missing/partial outbound identity update cannot establish current
      // continuity. Pending inbound responses cannot change outbound account/mode.
      if (!session.cached && session.stream && !session.stream.outboundComplete) { this.restoreReady(session, "failed"); return false; }
      if (session.cached && !await this.dependencies.validateCached?.({ ...scope, pid: session.pid!, localPort: session.nativePort! })) {
        if (this.current(session)) this.finish(session, "incomplete", "scope-changed"); return false;
      }
      if (!this.current(session) || (attemptAbort && !this.currentAttempt(session, attemptAbort))) return false;
      const status = network.gameProcessIds.includes(session.pid!)
        ? satanicZoneSessionScopeStatus({ ...scope, pid: session.pid!, localPort: session.nativePort! }, network.connections) : "changed";
      if (status === "changed") this.finish(session, "incomplete", "scope-changed");
      else if (status === "unknown") this.restoreReady(session, "failed");
      return status === "current";
    }
    const candidates = network.connections.filter(connection => network.gameProcessIds.includes(connection.owningProcess)
      && connection.localAddress === scope.localAddress && connection.remoteAddress === scope.remoteAddress
      && connection.remotePort === scope.remotePort && connection.localPort === (session.stream?.port ?? session.nativePort)
      && ["established", "5"].includes(String(connection.state).toLowerCase()));
    if (candidates.length > 1) { this.state.selectionStatus = "ambiguous"; this.finish(session, "ambiguous", "ambiguous-flow"); return false; }
    if (session.pid !== null && (candidates.length !== 1 || candidates[0].owningProcess !== session.pid
      || !network.gameProcessIds.includes(session.pid))) { this.finish(session, "incomplete", "scope-changed"); return false; }
    if (session.pid === null && candidates.length === 1 && session.stream?.freshSyn) {
      session.pid = candidates[0].owningProcess; this.state.attributed = true; this.state.selectionStatus = "attributed";
      this.dependencies.onWatchDiagnostic?.({ stage: "owner_selected", freshSyn: this.state.freshSyn, attributed: true });
      session.stream.attribute(); this.checkReady(session); this.publish();
    } else if (session.pid === null) {
      this.state.selectionStatus = "waiting-owner"; this.publish();
    }
    return session.pid !== null;
  }
  private preparedInput(session: Session): InitializedProbeInput {
    return { connectBody: session.connectBody!, postLoginBody: session.postLoginBody!, identity: session.identity!,
      scope: session.scope!, nativePort: session.nativePort! };
  }
  private async poll(session: Session): Promise<void> {
    if (session.polling || !this.current(session)) return;
    session.polling = true;
    try { await this.attributed(session); }
    catch (error) { this.collectionFailure(session, error, "capture-failed"); }
    finally { session.polling = false; }
    if (this.current(session) && !session.starting && !session.prepared) {
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
  private currentAttempt(session: Session, attemptAbort: AbortController): boolean {
    return this.current(session) && session.attemptAbort === attemptAbort && !attemptAbort.signal.aborted;
  }
  private async attempt(session: Session, attemptAbort: AbortController): Promise<void> {
    try {
      if (!await this.attributed(session, attemptAbort) || !this.currentAttempt(session, attemptAbort)) return;
      if (!(session.prepared || session.stream?.complete) || !session.scope || !session.connectBody || !session.postLoginBody || !session.identity || !session.loginSuccess) {
        this.finish(session, "incomplete", "context-unavailable"); return;
      }
      const nativePort = session.nativePort ?? session.stream!.port!;
      if (!this.dependencies.autoWatch && !this.closeCapture(session)) { this.finish(session, "incomplete", "capture-failed"); return; }
      this.state.directOutcome = "pending";
      if (!this.dependencies.retainContext) this.nextAllowedAt = this.now() + INITIALIZED_PROBE_ATTEMPT_MS;
      let observation: SatanicZoneProviderObservation | undefined;
      const result = await this.dependencies.attempt({ connectBody: session.connectBody, postLoginBody: session.postLoginBody,
        identity: session.identity, scope: session.scope, nativePort }, attemptAbort.signal, session.budget, value => {
        if (!this.currentAttempt(session, attemptAbort)) return;
        if (value.ownedFlow && !session.ownedFlows.some(flow => flow.localPort === value.ownedFlow!.localPort
          && flow.remoteAddress === value.ownedFlow!.remoteAddress && flow.remotePort === value.ownedFlow!.remotePort)) {
          session.ownedFlows.push({ ...value.ownedFlow });
          if (session.ownedFlows.length > 4) session.ownedFlows.shift();
        }
        this.state.probeStage = value.stage; this.state.inboundFrames = value.inboundFrames;
        this.state.outboundFrames = value.outboundFrames; this.state.controlFrames = value.controlFrames;
        this.state.requestDispatched = value.zoneWritten; this.state.connectAcknowledgment = value.connectAcknowledgment; this.publish();
        if (value.observation) observation = value.observation;
      });
      if (!this.currentAttempt(session, attemptAbort)) return;
      // Product results require the original game session to remain current,
      // including when a topology update has not yet reached normal capture.
      if (this.dependencies.retainContext && result === "success") {
        if (!observation) { this.restoreReady(session, "failed"); return; }
        if (!await this.attributed(session, attemptAbort) || !this.currentAttempt(session, attemptAbort)) return;
        this.dependencies.onObservation?.(observation);
      }
      this.state.directOutcome = result === "byte-limit" ? "failed" : result;
      if (session.prepared) { this.restoreReady(session, result === "byte-limit" ? "failed" : result); return; }
      this.finish(session, result === "success" ? "complete" : result === "timeout" ? "timed-out" : "incomplete",
        result === "success" ? "none" : result === "timeout" ? "deadline" : result === "byte-limit" ? "byte-limit" : "direct-failed");
    } catch { if (this.currentAttempt(session, attemptAbort)) {
      if (session.prepared) this.restoreReady(session, "failed"); else this.finish(session, "incomplete", "direct-failed");
    } }
  }
  private restoreReady(session: Session, outcome: "success" | "timeout" | "failed" | "cancelled"): void {
    if (!this.current(session) || !session.prepared) return;
    if (session.deadline) clearTimeout(session.deadline); session.deadline = null;
    const attemptAbort = session.attemptAbort; session.attemptAbort = null;
    session.starting = false; this.state.phase = "ready"; this.state.probeStage = "ready";
    this.state.deadlineAt = null; this.state.directOutcome = outcome;
    this.state.reason = outcome === "success" ? "none" : outcome === "timeout" ? "deadline"
      : outcome === "cancelled" ? "user-cancelled" : "direct-failed";
    attemptAbort?.abort(); this.publish();
  }
  /** Reuse the already-open listener so a reconnect SYN cannot race an async reopen. */
  private resetInitialization(session: Session): void {
    if (!this.current(session)) return;
    this.dependencies.onWatchDiagnostic?.({ stage: "initialization_reset", freshSyn: this.state.freshSyn, attributed: this.state.attributed });
    if (!session.cached) this.dependencies.onInvalidation?.();
    session.attemptAbort?.abort(); session.attemptAbort = null;
    if (session.deadline) clearTimeout(session.deadline); session.deadline = null;
    session.stream?.dispose(); session.stream = null;
    if (session.connectBody) session.budget.release(session.connectBody);
    if (session.postLoginBody) session.budget.release(session.postLoginBody);
    if (session.identity) { session.identity.uniqueAccountId = ""; session.identity.beta = ""; }
    session.connectBody = null; session.postLoginBody = null; session.identity = null;
    session.scope = null; session.pid = null; session.nativePort = null;
    session.prepared = false; session.starting = false; session.readyControl = false; session.loginSuccess = false;
    session.ownedFlows = [];
    if (session.pendingSyn) for (const packet of session.pendingSyn) session.budget.release(packet.payload);
    session.pendingSyn = null;
    session.cached = false;
    this.state = createInitialSatanicZoneDiagnosticState();
    this.state.phase = "waiting-initialization"; this.state.directOutcome = "cancelled";
    this.state.startedAt = this.now(); this.publish();
    if (!session.poll) void this.poll(session);
  }
  private closeCapture(session: Session): boolean {
    if (session.poll) clearTimeout(session.poll); session.poll = null;
    let closed = true;
    if (session.handle) this.dependencies.onWatchDiagnostic?.({ stage: "listener_closed", freshSyn: this.state.freshSyn, attributed: this.state.attributed });
    try { session.handle?.close(); } catch { closed = false; } session.handle = null;
    session.stream?.dispose(); session.stream = null;
    return closed;
  }
  private finish(session: Session, phase: SatanicZoneDiagnosticState["phase"], reason: SatanicZoneDiagnosticReason): void {
    if (!this.current(session)) return;
    this.session = null; if (session.deadline) clearTimeout(session.deadline);
    session.attemptAbort?.abort(); session.attemptAbort = null; session.abort.abort(); this.closeCapture(session);
    if (session.connectBody) session.budget.release(session.connectBody);
    if (session.postLoginBody) session.budget.release(session.postLoginBody);
    if (!this.dependencies.bufferBudget) session.budget.dispose();
    session.connectBody = null; session.postLoginBody = null;
    if (session.identity) { session.identity.uniqueAccountId = ""; session.identity.beta = ""; }
    session.identity = null; session.scope = null; session.captureScope = null; session.pid = null;
    session.ownedFlows = [];
    if (session.pendingSyn) for (const packet of session.pendingSyn) session.budget.release(packet.payload);
    session.pendingSyn = null;
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

function samePacketFlow(first: ParsedPayload, packet: ParsedPayload): boolean {
  return (first.src === packet.src && first.srcPort === packet.srcPort && first.dst === packet.dst && first.dstPort === packet.dstPort)
    || (first.src === packet.dst && first.srcPort === packet.dstPort && first.dst === packet.src && first.dstPort === packet.srcPort);
}

export function createSatanicZoneInitializedProbeRuntime(options: Pick<InitializedProbeDependencies, "canArm" | "onChange"> & { syntheticOnly?: boolean }): SatanicZoneInitializedProbeController {
  return new SatanicZoneInitializedProbeController({ ...options, ...createDiagnosticCaptureDependencies(options.syntheticOnly, "fresh-api"),
    attempt: (input, signal, budget, progress) => options.syntheticOnly ? Promise.resolve("failed")
      : runInitializedSatanicZoneProbe(input, signal, budget, progress) });
}
