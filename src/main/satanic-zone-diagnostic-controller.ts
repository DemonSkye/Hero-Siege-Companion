import {
  copySatanicZoneDiagnosticState, createInitialSatanicZoneDiagnosticState,
  isSatanicZoneDiagnosticActive, SZ_DIAGNOSTIC_MAX_BYTES, SZ_DIAGNOSTIC_TIMEOUT_MS,
  type SatanicZoneDiagnosticReason, type SatanicZoneDiagnosticState,
} from "../shared/satanic-zone-diagnostic";
import { CapturedSessionContextStore, type SatanicZoneRequestContext } from "./captured-session-context";
import { extractSatanicZoneObservation } from "./direct-satanic-zone-protocol";
import {
  DirectSatanicZoneRefreshProvider, type DirectSatanicZoneTransportTrace, type TransportRequest,
} from "./direct-satanic-zone-provider";
import type { HeroSiegeNetworkState } from "./capture-network";
import type { ParsedPayload } from "./packet-decoder";
import { SatanicZoneDiagnosticStream, type DiagnosticCaptureScope, type DiagnosticFrame } from "./satanic-zone-diagnostic-stream";
import { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";

export interface DiagnosticCaptureHandle { close(): void }
export interface SatanicZoneDiagnosticDependencies {
  prepare(): Promise<DiagnosticCaptureScope>;
  open(scope: DiagnosticCaptureScope, packet: (packet: ParsedPayload, truncated: boolean) => void,
    failed: () => void, budget: SatanicZoneDiagnosticBufferBudget): Promise<DiagnosticCaptureHandle>;
  networkState(): Promise<HeroSiegeNetworkState>;
  transport(context: SatanicZoneRequestContext, signal: AbortSignal | undefined,
    trace: (event: DirectSatanicZoneTransportTrace) => void, budget: SatanicZoneDiagnosticBufferBudget): TransportRequest;
  canArm(): boolean;
  onChange(state: SatanicZoneDiagnosticState): void;
  now?: () => number;
}

interface DiagnosticSession {
  budget: SatanicZoneDiagnosticBufferBudget;
  abort: AbortController;
  context: CapturedSessionContextStore;
  provider: DirectSatanicZoneRefreshProvider;
  scope: DiagnosticCaptureScope | null;
  stream: SatanicZoneDiagnosticStream | null;
  handle: DiagnosticCaptureHandle | null;
  deadline: ReturnType<typeof setTimeout>;
  poll: ReturnType<typeof setTimeout> | null;
  directTimer: ReturnType<typeof setTimeout> | null;
  pollInFlight: boolean;
  pid: number | null;
  zoneRequests: number;
  nativeZoneBody: Buffer | null;
  nativeControlBody: Buffer | null;
  directPrefix: Buffer;
  directAttributed: boolean;
  incomingBytes: number;
  dispatchStarted: boolean;
}

const STREAM_REASONS = new Set<SatanicZoneDiagnosticReason>(["stream-gap", "invalid-frame", "ambiguous-flow", "byte-limit"]);

/** Explicit, one-shot diagnostic. Private buffers and identities never leave this owner. */
export class SatanicZoneDiagnosticController {
  private state = createInitialSatanicZoneDiagnosticState();
  private session: DiagnosticSession | null = null;
  private disposed = false;
  private nextAllowedDispatchAt = 0;
  private readonly now: () => number;

  constructor(private readonly dependencies: SatanicZoneDiagnosticDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  snapshot(): SatanicZoneDiagnosticState { return copySatanicZoneDiagnosticState(this.state); }
  get active(): boolean { return isSatanicZoneDiagnosticActive(this.state); }
  get blocksManualRefresh(): boolean { return this.active || this.now() < this.nextAllowedDispatchAt; }

  arm(): SatanicZoneDiagnosticState {
    if (this.disposed || this.active) return this.snapshot();
    this.state = createInitialSatanicZoneDiagnosticState();
    let canArm = false;
    try { canArm = this.dependencies.canArm(); } catch { /* Fixed unavailable state only. */ }
    if (this.now() < this.nextAllowedDispatchAt || !canArm) {
      this.state.phase = "unavailable"; this.state.reason = "busy"; this.publish();
      return this.snapshot();
    }
    const context = new CapturedSessionContextStore(() => undefined, this.now);
    const session = {} as DiagnosticSession;
    Object.assign(session, {
      abort: new AbortController(), context, budget: new SatanicZoneDiagnosticBufferBudget(), scope: null, stream: null, handle: null,
      poll: null, directTimer: null, pollInFlight: false, pid: null, zoneRequests: 0,
      nativeZoneBody: null, nativeControlBody: null, directPrefix: Buffer.alloc(0), directAttributed: false,
      incomingBytes: 0, dispatchStarted: false,
    });
    session.provider = new DirectSatanicZoneRefreshProvider(context,
      (value, signal) => this.dependencies.transport(value, signal, (event) => {
        try { this.transportEvent(session, event); }
        catch { this.finish(session, "incomplete", "byte-limit"); }
      }, session.budget), this.now);
    session.deadline = setTimeout(() => this.deadline(session), SZ_DIAGNOSTIC_TIMEOUT_MS);
    session.deadline.unref?.();
    this.session = session;
    this.state.phase = "arming";
    this.state.startedAt = this.now();
    this.state.deadlineAt = this.now() + SZ_DIAGNOSTIC_TIMEOUT_MS;
    this.publish();
    void this.start(session);
    return this.snapshot();
  }

  cancel(reason: "user-cancelled" | "shutdown" = "user-cancelled"): SatanicZoneDiagnosticState {
    if (this.session) this.finish(this.session, "cancelled", reason);
    return this.snapshot();
  }

  dispose(): void { this.disposed = true; this.cancel("shutdown"); }

  private current(session: DiagnosticSession): boolean { return this.session === session && !session.abort.signal.aborted; }

  private async start(session: DiagnosticSession): Promise<void> {
    try {
      const scope = await this.dependencies.prepare();
      if (!this.current(session)) return;
      session.scope = scope;
      session.stream = new SatanicZoneDiagnosticStream(scope, (frame) => this.gameFrame(session, frame), session.budget);
      const handle = await this.dependencies.open(scope,
        (packet, truncated) => this.packet(session, packet, truncated),
        () => this.finish(session, "incomplete", "capture-failed"), session.budget);
      if (!this.current(session)) { try { handle.close(); } catch { /* No error text is public. */ } return; }
      session.handle = handle;
      this.state.phase = "waiting-initialization";
      this.publish();
      void this.poll(session);
    } catch {
      if (this.current(session)) this.finish(session, "unavailable", session.scope ? "adapter-unavailable" : "game-not-ready");
    }
  }

  private consume(session: DiagnosticSession, bytes: number): boolean {
    if (!this.current(session)) return false;
    if (bytes > SZ_DIAGNOSTIC_MAX_BYTES - this.state.bytesObserved) {
      this.finish(session, "incomplete", "byte-limit"); return false;
    }
    this.state.bytesObserved += bytes;
    return true;
  }

  private packet(session: DiagnosticSession, packet: ParsedPayload, truncated: boolean): void {
    if (!this.current(session) || !session.stream?.matches(packet) || session.dispatchStarted) return;
    if (truncated) { this.finish(session, "incomplete", "capture-truncated"); return; }
    if (!this.consume(session, packet.payload.length)) return;
    try {
      session.stream.push(packet);
      this.state.freshSyn = session.stream.freshSyn;
      if (this.state.freshSyn && this.state.phase === "waiting-initialization") this.state.phase = "collecting";
      this.checkReady(session);
      this.publish();
    } catch (error) {
      const reason = error instanceof Error && STREAM_REASONS.has(error.message as SatanicZoneDiagnosticReason)
        ? error.message as SatanicZoneDiagnosticReason : "invalid-frame";
      this.finish(session, reason === "ambiguous-flow" ? "ambiguous" : "incomplete", reason);
    }
  }

  private async poll(session: DiagnosticSession): Promise<void> {
    if (!this.current(session) || session.pollInFlight) return;
    session.pollInFlight = true;
    try {
      const network = await this.dependencies.networkState();
      if (!this.current(session) || !session.scope || !session.stream) return;
      const scope = session.scope;
      const candidates = network.connections.filter((connection) =>
        network.gameProcessIds.includes(connection.owningProcess)
        && connection.localAddress === scope.localAddress && connection.remoteAddress === scope.remoteAddress
        && connection.remotePort === scope.remotePort && connection.localPort === session.stream!.port);
      if (candidates.length > 1) { this.finish(session, "ambiguous", "ambiguous-flow"); return; }
      if (session.pid !== null && (!network.gameProcessIds.includes(session.pid)
        || candidates.length !== 1 || candidates[0].owningProcess !== session.pid)) {
        this.finish(session, "incomplete", "scope-changed"); return;
      }
      if (session.pid === null && candidates.length === 1 && session.stream.freshSyn) {
        session.pid = candidates[0].owningProcess;
        session.context.observeGameProcessIds([session.pid]);
        this.state.attributed = true;
        session.stream.attribute();
        this.checkReady(session);
        this.publish();
      }
    } catch {
      if (this.current(session)) this.finish(session, "incomplete", "capture-failed");
    } finally {
      session.pollInFlight = false;
      if (this.current(session)) {
        session.poll = setTimeout(() => { session.poll = null; void this.poll(session); }, 1000);
        session.poll.unref?.();
      }
    }
  }

  private gameFrame(session: DiagnosticSession, frame: DiagnosticFrame): void {
    if (!this.current(session) || !session.scope) return;
    const control = frame.body.length === 2 ? (frame.body.readUInt16LE(0) === 1 ? "same-as-pong" : "other-control") : "not-control";
    if (this.state.frames.length < 32) this.state.frames.push({ direction: frame.outbound ? "outbound" : "inbound",
      kind: frame.kind, bodyBytes: frame.body.length, counter: frame.counter, control });
    else this.state.frameSummaryLimited = true;
    if (frame.outbound) {
      session.context.observe({ text: frame.body.toString("utf8"), direction: "outbound",
        remoteAddress: session.scope.remoteAddress, remotePort: session.scope.remotePort, observedAt: this.now() });
      if (frame.kind === "zone-request") {
        session.zoneRequests++;
        if (session.zoneRequests !== 1) { this.finish(session, "ambiguous", "ambiguous-flow"); return; }
        session.nativeZoneBody = session.budget.copy(frame.body);
      }
    } else {
      if (this.state.nativeBootstrapControl === "not-observed") {
        this.state.nativeBootstrapControl = control;
        if (frame.body.length === 2) session.nativeControlBody = session.budget.copy(frame.body);
      }
      if (session.zoneRequests === 1 && extractSatanicZoneObservation(frame.body, this.now())) this.state.naturalBaseline = true;
    }
  }

  private checkReady(session: DiagnosticSession): void {
    if (!this.current(session) || session.dispatchStarted || !this.state.naturalBaseline || !session.stream?.complete) return;
    if (!session.context.satanicZoneContext()) { this.finish(session, "incomplete", "context-unavailable"); return; }
    this.state.initializationComplete = true;
    session.dispatchStarted = true;
    this.state.phase = "requesting";
    this.state.directOutcome = "pending";
    if (session.handle) { try { session.handle.close(); } catch { this.finish(session, "incomplete", "capture-failed"); return; } session.handle = null; }
    // The raw game prefix is no longer needed after its structure is summarized.
    session.stream.dispose();
    this.publish();
    void this.dispatch(session);
  }

  private async dispatch(session: DiagnosticSession): Promise<void> {
    session.directTimer = setTimeout(() => {
      if (this.current(session)) { this.state.directOutcome = "timeout"; this.finish(session, "timed-out", "direct-failed"); }
    }, 20_000);
    session.directTimer.unref?.();
    try {
      const dispatch = await session.provider.requestRefresh({ signal: session.abort.signal });
      if (!this.current(session)) return;
      if (!dispatch.accepted || !dispatch.correlationId) { this.state.directOutcome = "failed"; this.finish(session, "incomplete", session.budget.exceeded ? "byte-limit" : "direct-failed"); return; }
      this.state.requestDispatched = true;
      this.nextAllowedDispatchAt = this.now() + 30_000;
      this.publish();
      const outcome = await session.provider.waitForObservation(dispatch.correlationId, { signal: session.abort.signal, timeoutMs: 20_000 });
      if (!this.current(session)) return;
      if (outcome?.kind === "observation" && session.directAttributed && this.state.bootstrapPong && session.incomingBytes > 10) {
        this.directEvent({ kind: "zone-observation", direction: "inbound", bytes: 0, control: "not-control" });
        this.state.directOutcome = "success"; this.finish(session, "complete", "none");
      } else {
        this.state.directOutcome = outcome?.kind === "terminal" && outcome.errorCode === "response_timeout" ? "timeout" : "failed";
        this.finish(session, this.state.directOutcome === "timeout" ? "timed-out" : "incomplete", session.budget.exceeded ? "byte-limit" : "direct-failed");
      }
    } catch {
      if (this.current(session)) { this.state.directOutcome = "failed"; this.finish(session, "incomplete", "direct-failed"); }
    }
  }

  private transportEvent(session: DiagnosticSession, event: DirectSatanicZoneTransportTrace): void {
    if (!this.current(session) || !session.dispatchStarted || !session.scope) return;
    if (event.kind === "connected") {
      this.directEvent({ kind: "connected", direction: "local", bytes: 0, control: "not-control" });
      session.directAttributed = event.localAddress === session.scope.localAddress
        && event.remoteAddress === session.scope.remoteAddress && event.remotePort === session.scope.remotePort
        && Number.isSafeInteger(event.localPort) && event.localPort > 0 && event.localPort !== session.stream?.port;
      if (!session.directAttributed) this.finish(session, "ambiguous", "ambiguous-flow");
    } else if (event.kind === "bootstrapped") {
      this.state.bootstrapPong = true;
      this.directEvent({ kind: "bootstrap-pong", direction: "inbound", bytes: 10, control: "same-as-pong" });
    }
    else {
      if (!session.directAttributed) { this.finish(session, "ambiguous", "ambiguous-flow"); return; }
      if (!this.consume(session, event.bytes.length)) return;
      this.directEvent({ kind: event.kind === "incoming" ? "response-chunk" : event.phase === "bootstrap" ? "bootstrap-write" : "zone-write",
        direction: event.kind === "incoming" ? "inbound" : "outbound", bytes: event.bytes.length, control: "not-control" });
      if (event.kind === "outgoing" && event.phase === "zone") {
        this.state.requestBodyMatchesNative = Boolean(session.nativeZoneBody?.equals(event.bytes.subarray(16)));
      } else if (event.kind === "incoming") {
        session.incomingBytes += event.bytes.length;
        const remaining = 20 - session.directPrefix.length;
        if (remaining > 0) {
          const previous = session.directPrefix;
          session.directPrefix = session.budget.concat([previous, event.bytes.subarray(0, remaining)]);
          session.budget.release(previous);
        }
        if (session.directPrefix.length >= 18 && session.directPrefix.readUInt32LE(14) !== 2) this.state.secondControl = "not-control";
        else if (session.directPrefix.length === 20 && this.state.secondControl === "not-observed") {
          this.state.secondControl = session.directPrefix.readUInt16LE(18) === 1 ? "same-as-pong" : "other-control";
          this.state.secondControlMatchesNative = session.nativeControlBody ? session.nativeControlBody.equals(session.directPrefix.subarray(18, 20)) : null;
          this.directEvent({ kind: "second-control", direction: "inbound", bytes: 10, control: this.state.secondControl });
        }
      }
    }
    this.publish();
  }

  private deadline(session: DiagnosticSession): void {
    if (!this.current(session)) return;
    const reason = !this.state.freshSyn ? "missing-initialization" : !this.state.attributed ? "ambiguous-flow"
      : !this.state.naturalBaseline ? "missing-baseline" : !this.state.initializationComplete ? "stream-gap" : "deadline";
    this.finish(session, "timed-out", reason);
  }

  private finish(session: DiagnosticSession, phase: SatanicZoneDiagnosticState["phase"], reason: SatanicZoneDiagnosticReason): void {
    if (!this.current(session)) return;
    this.session = null;
    this.state.phase = phase; this.state.reason = reason;
    if (this.state.directOutcome === "pending") this.state.directOutcome = phase === "cancelled" ? "cancelled" : "failed";
    clearTimeout(session.deadline);
    if (session.poll) clearTimeout(session.poll);
    if (session.directTimer) clearTimeout(session.directTimer);
    session.abort.abort(); session.provider.dispose(); session.context.dispose();
    try { session.handle?.close(); } catch { /* Never publish dependency errors. */ }
    session.handle = null; session.stream?.dispose(); session.stream = null; session.pid = null;
    session.budget.dispose();
    session.nativeZoneBody = null; session.nativeControlBody = null; session.directPrefix = Buffer.alloc(0); session.scope = null;
    this.state.peakOwnedBufferBytes = session.budget.peakBytes;
    this.publish();
  }

  private directEvent(event: SatanicZoneDiagnosticState["directEvents"][number]): void {
    if (this.state.directEvents.length < 32) this.state.directEvents.push(event);
    else this.state.frameSummaryLimited = true;
  }

  private publish(): void {
    if (this.session) this.state.peakOwnedBufferBytes = this.session.budget.peakBytes;
    try { this.dependencies.onChange(this.snapshot()); } catch { /* No exception escape. */ }
  }
}
