import type { SatanicZonePreparation } from "../shared/satanic-zone-preparation";
import type { SatanicZoneDiagnosticState } from "../shared/satanic-zone-diagnostic";
import { SatanicZoneInitializedProbeController, type InitializedProbeDependencies } from "./satanic-zone-initialized-controller";
import { createDiagnosticCaptureDependencies } from "./satanic-zone-diagnostic-runtime";
import { runInitializedSatanicZoneProbe } from "./satanic-zone-initialized-transport";
import type { CapturedSessionPayload } from "./captured-session-context";
import type { CaptureConnection } from "../shared/app-state";
import type { SatanicZoneRefreshAvailability, SatanicZoneRefreshDispatchResult, SatanicZoneRefreshProvider,
  SatanicZoneRefreshRequestOptions, SatanicZoneProviderWaitOutcome, SatanicZoneObservationWaitOptions,
  SatanicZoneProviderObservation } from "./satanic-zone-refresh-provider";

interface Pending {
  id: string;
  dispatched: Promise<SatanicZoneRefreshDispatchResult>;
  dispatch: (result: SatanicZoneRefreshDispatchResult) => void;
  outcome: Promise<SatanicZoneProviderWaitOutcome>;
  settle: (result: SatanicZoneProviderWaitOutcome) => void;
  accepted: boolean;
  completed: boolean;
  cleanup: () => void;
}
export interface InitializedSatanicZoneProviderOptions {
  canPrepare: () => boolean;
  onPreparation: (state: SatanicZonePreparation) => void;
  syntheticOnly?: boolean;
  /** Offline tests inject every native/network/socket boundary. */
  dependencies?: Pick<InitializedProbeDependencies, "prepare" | "open" | "networkState" | "attempt" | "now">;
}

/** Explicit preparation and clicks; no automatic login replay or SZ request. */
export class InitializedSatanicZoneRefreshProvider implements SatanicZoneRefreshProvider {
  readonly experimental = true;
  private readonly context: SatanicZoneInitializedProbeController;
  private pending: Pending | null = null;
  private nextId = 1;
  private nextAllowedAt = 0;
  private disposed = false;
  private readonly now: () => number;
  constructor(private readonly options: InitializedSatanicZoneProviderOptions) {
    this.now = options.dependencies?.now ?? Date.now;
    this.context = new SatanicZoneInitializedProbeController({
      ...createDiagnosticCaptureDependencies(options.syntheticOnly, "fresh-api"),
      attempt: (input, signal, budget, progress) => options.syntheticOnly ? Promise.resolve("failed")
        : runInitializedSatanicZoneProbe(input, signal, budget, progress),
      ...options.dependencies, retainContext: true,
      canArm: () => !this.disposed && !this.pending && this.now() >= this.nextAllowedAt && options.canPrepare(),
      onChange: state => this.changed(state), onObservation: observation => this.observed(observation),
    });
  }
  get preparation(): SatanicZonePreparation { return projectPreparation(this.context.snapshot()); }
  get suppressRawLogging(): boolean { return this.context.active; }
  prepare(): void { if (!this.disposed) this.context.arm(); }
  cancelPreparation(): void { this.stop(); }
  invalidate(): void { this.context.invalidate(); }
  observeProcessIds(ids: readonly number[]): void { this.context.observeProcessIds(ids); }
  observeSessionPayload(payload: CapturedSessionPayload): void { this.context.observeSessionPayload(payload); }
  observeConnections(connections: readonly CaptureConnection[]): void { this.context.observeConnections(connections); }
  async getAvailability(): Promise<SatanicZoneRefreshAvailability> {
    if (this.preparation.phase === "ready" && this.now() >= (this.preparation.expiresAt ?? 0)) this.context.invalidate();
    const available = !this.disposed && this.preparation.phase === "ready";
    return { available, experimental: true, errorCode: available ? null : "helper_not_ready" };
  }
  async requestRefresh(options: SatanicZoneRefreshRequestOptions = {}): Promise<SatanicZoneRefreshDispatchResult> {
    if (this.disposed || options.signal?.aborted) return rejected("helper_unavailable");
    if (this.pending) return rejected("refresh_in_progress");
    if (this.now() < this.nextAllowedAt) return rejected("refresh_cooldown");
    if (this.preparation.phase !== "ready" || this.now() >= (this.preparation.expiresAt ?? 0)) return rejected("helper_not_ready");
    let dispatch!: Pending["dispatch"], settle!: Pending["settle"];
    const dispatched = new Promise<SatanicZoneRefreshDispatchResult>(resolve => { dispatch = resolve; });
    const outcome = new Promise<SatanicZoneProviderWaitOutcome>(resolve => { settle = resolve; });
    const cancelled = () => this.context.cancel();
    const pending: Pending = { id: `initialized-sz-${this.nextId++}`, dispatched, dispatch, outcome, settle,
      accepted: false, completed: false, cleanup: () => options.signal?.removeEventListener("abort", cancelled) };
    this.pending = pending; options.signal?.addEventListener("abort", cancelled, { once: true });
    this.context.startAttempt();
    const result = await dispatched;
    pending.cleanup();
    if (!result.accepted && this.pending === pending) this.pending = null;
    return result;
  }
  async waitForObservation(id: string, options: SatanicZoneObservationWaitOptions): Promise<SatanicZoneProviderWaitOutcome | null> {
    const pending = this.pending;
    if (!pending || pending.id !== id) return null;
    const cancelled = () => this.context.cancel();
    options.signal?.addEventListener("abort", cancelled, { once: true });
    if (options.signal?.aborted) cancelled();
    // The transport/context already own an absolute <=30s deadline.
    try { return await pending.outcome; }
    finally {
      options.signal?.removeEventListener("abort", cancelled);
      if (this.pending === pending) this.pending = null;
    }
  }
  stop(): void { this.context.cancel(); this.pending?.cleanup(); this.pending = null; }
  dispose(): void { this.disposed = true; this.context.dispose(); this.pending?.cleanup(); this.pending = null; }
  private observed(observation: SatanicZoneProviderObservation): void {
    const pending = this.pending;
    if (!pending?.accepted || pending.completed) return;
    pending.completed = true;
    pending.settle({ kind: "observation", observation, availabilityConsumed: false, refreshAvailable: true });
  }
  private changed(state: SatanicZoneDiagnosticState): void {
    const pending = this.pending;
    if (pending && !pending.accepted && state.requestDispatched && state.phase === "requesting") {
      pending.accepted = true; pending.cleanup(); this.nextAllowedAt = this.now() + 30_000;
      pending.dispatch({ accepted: true, errorCode: null, correlationId: pending.id });
    }
    if (pending && !pending.completed && !["arming", "waiting-initialization", "collecting", "ready", "requesting"].includes(state.phase)) {
      pending.completed = true; pending.cleanup();
      const errorCode = state.phase === "timed-out" ? "response_timeout" : "helper_failed";
      pending.dispatch(rejected(errorCode));
      pending.settle({ kind: "terminal", errorCode, availabilityConsumed: false, refreshAvailable: false });
    }
    this.options.onPreparation(projectPreparation(state));
  }
}

function projectPreparation(state: SatanicZoneDiagnosticState): SatanicZonePreparation {
  const phase: SatanicZonePreparation["phase"] = state.phase === "arming" ? "opening"
    : state.phase === "waiting-initialization" ? "waiting_connection" : state.phase === "collecting" ? "collecting"
    : state.phase === "ready" ? "ready" : state.phase === "requesting" ? "requesting"
    : state.phase === "idle" || state.phase === "cancelled" ? "idle" : state.phase === "timed-out" ? "expired" : "unavailable";
  return { phase, expiresAt: ["opening", "waiting_connection", "collecting", "ready", "requesting"].includes(phase) ? state.deadlineAt : null };
}
function rejected(errorCode: SatanicZoneRefreshDispatchResult["errorCode"]): SatanicZoneRefreshDispatchResult {
  return { accepted: false, errorCode, correlationId: null };
}
