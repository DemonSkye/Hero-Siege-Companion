import type { SatanicZonePreparation } from "../shared/satanic-zone-preparation";
import type { SatanicZoneDiagnosticState } from "../shared/satanic-zone-diagnostic";
import { SatanicZoneInitializedProbeController, type InitializedProbeDependencies } from "./satanic-zone-initialized-controller";
import { createDiagnosticCaptureDependencies } from "./satanic-zone-diagnostic-runtime";
import { runInitializedSatanicZoneProbe } from "./satanic-zone-initialized-transport";
import type { CapturedSessionPayload } from "./captured-session-context";
import type { CaptureConnection } from "../shared/app-state";
import type { CapturedTcpLifecycle } from "./packet-decoder";
import { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import type { SatanicZoneLoginCache } from "./satanic-zone-login-cache";
import type { SatanicZoneLoginCacheState } from "../shared/satanic-zone-login-cache";
import type { SatanicZoneRefreshAvailability, SatanicZoneRefreshDispatchResult, SatanicZoneRefreshProvider,
  SatanicZoneRefreshRequestOptions, SatanicZoneProviderWaitOutcome, SatanicZoneObservationWaitOptions,
  SatanicZoneProviderObservation } from "./satanic-zone-refresh-provider";

const CACHE_REASONS: Partial<Record<SatanicZoneLoginCacheState["status"], NonNullable<SatanicZonePreparation["reason"]>>> = {
  unverified: "cache_identity_required", identity_mismatch: "cache_identity_mismatch",
  build_unavailable: "cache_build_unavailable", build_mismatch: "cache_build_mismatch",
};
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
  loginCache?: SatanicZoneLoginCache;
  /** Offline tests inject every native/network/socket boundary. */
  dependencies?: Pick<InitializedProbeDependencies, "prepare" | "open" | "networkState" | "attempt" | "now">;
}

/** Automatic passive readiness; only explicit Refresh can replay login or request SZ. */
export class InitializedSatanicZoneRefreshProvider implements SatanicZoneRefreshProvider {
  readonly experimental = true;
  private context: SatanicZoneInitializedProbeController;
  private retainedContext: SatanicZoneInitializedProbeController | null = null;
  private budget = new SatanicZoneDiagnosticBufferBudget();
  private pending: Pending | null = null;
  private nextId = 1;
  private nextAllowedAt = 0;
  private disposed = false;
  private watching = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  constructor(private readonly options: InitializedSatanicZoneProviderOptions) {
    this.now = options.dependencies?.now ?? Date.now;
    options.loginCache?.attachBudget(this.budget);
    this.context = this.createContext();
  }
  private createContext(): SatanicZoneInitializedProbeController {
    let context!: SatanicZoneInitializedProbeController;
    context = new SatanicZoneInitializedProbeController({
      ...createDiagnosticCaptureDependencies(this.options.syntheticOnly ?? false, "startup-api"),
      attempt: (input, signal, budget, progress) => this.options.syntheticOnly ? Promise.resolve("failed")
        : runInitializedSatanicZoneProbe(input, signal, budget, progress),
      ...this.options.dependencies, retainContext: true, autoWatch: true, bufferBudget: this.budget,
      canArm: () => !this.disposed && !this.pending && this.options.canPrepare(),
      onChange: state => this.changed(context, state),
      onObservation: observation => { if (this.context === context && !context.continuitySuspended) this.observed(observation); },
      onPrepared: (input, pid) => { void this.options.loginCache?.remember(input, pid); },
      validateCached: scope => this.options.loginCache?.preflight(scope) ?? Promise.resolve(false),
    });
    return context;
  }
  get preparation(): SatanicZonePreparation {
    const state = projectPreparation(this.context.snapshot(), this.context.continuitySuspended, this.context.cachedContext);
    const cache = this.options.loginCache?.snapshot();
    if (cache?.enabled && !["ready", "requesting"].includes(state.phase)) {
      const reason = CACHE_REASONS[cache.status];
      if (reason) state.reason = reason;
    }
    return state;
  }
  rememberCurrent(): void { this.context.rememberCurrent(); }
  get suppressRawLogging(): boolean { return this.watching || this.context.active || Boolean(this.retainedContext?.active) || Boolean(this.options.loginCache?.holdsSecrets); }
  cacheChanged(): void {
    const cache = this.options.loginCache;
    if (this.context?.cachedContext && cache?.snapshot().status !== "validated") this.context.invalidate();
    const input = cache?.restoreInput();
    if (input && this.options.canPrepare()) this.context?.restoreCached(input);
    this.options.onPreparation(this.preparation);
  }
  prepare(): void {
    if (this.disposed) return;
    if (this.pending?.completed) { this.pending.cleanup(); this.pending = null; }
    if (this.context.continuitySuspended && !this.retainedContext) {
      this.retainedContext = this.context; this.context = this.createContext();
    }
    this.context.arm();
  }
  /** Resolves after listener open, so launch can wait before the game's first SYN. */
  async preparePassively(): Promise<boolean> {
    if (this.disposed || !this.options.canPrepare()) return false;
    this.watching = true; this.clearRetry();
    if (["idle", "expired", "unavailable", "suspended"].includes(this.preparation.phase)) this.prepare();
    const opened = await this.context.waitForListener(); this.cacheChanged(); return opened;
  }
  cancelPreparation(): void { this.watching = false; this.clearRetry(); this.context.cancelAttempt(); }
  cancelAttempt(): void { this.context.cancelAttempt(); }
  suspend(): void { this.options.loginCache?.suspend(); this.watching = false; this.clearRetry(); this.retainedContext?.suspend(); this.context.suspend(); }
  invalidate(): void { this.retainedContext?.invalidate(); this.context.invalidate(); }
  observeProcessIds(ids: readonly number[]): void { this.options.loginCache?.observeProcesses(ids); this.retainedContext?.observeProcessIds(ids); this.context.observeProcessIds(ids); }
  observeSessionPayload(payload: CapturedSessionPayload): void { void this.options.loginCache?.observe(payload); this.retainedContext?.observeSessionPayload(payload); this.context.observeSessionPayload(payload); }
  observeConnections(connections: readonly CaptureConnection[]): void { this.options.loginCache?.observeConnections(connections); this.retainedContext?.observeConnections(connections); this.context.observeConnections(connections); }
  observeTcpLifecycle(packet: CapturedTcpLifecycle): void { this.options.loginCache?.observeLifecycle(packet); this.retainedContext?.observeTcpLifecycle(packet); this.context.observeTcpLifecycle(packet); }
  async getAvailability(): Promise<SatanicZoneRefreshAvailability> {
    const available = !this.disposed && this.preparation.phase === "ready";
    return { available, experimental: true, errorCode: available ? null : "helper_not_ready" };
  }
  async requestRefresh(options: SatanicZoneRefreshRequestOptions = {}): Promise<SatanicZoneRefreshDispatchResult> {
    if (this.disposed || options.signal?.aborted) return rejected("helper_unavailable");
    if (this.pending?.completed) { this.pending.cleanup(); this.pending = null; }
    if (this.pending) return rejected("refresh_in_progress");
    if (this.now() < this.nextAllowedAt) return rejected("refresh_cooldown");
    if (this.preparation.phase !== "ready") return rejected("helper_not_ready");
    let dispatch!: Pending["dispatch"], settle!: Pending["settle"];
    const dispatched = new Promise<SatanicZoneRefreshDispatchResult>(resolve => { dispatch = resolve; });
    const outcome = new Promise<SatanicZoneProviderWaitOutcome>(resolve => { settle = resolve; });
    const cancelled = () => this.context.cancelAttempt();
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
    const cancelled = () => this.context.cancelAttempt();
    options.signal?.addEventListener("abort", cancelled, { once: true });
    if (options.signal?.aborted) cancelled();
    // The transport/context already own an absolute <=30s deadline.
    try { return await pending.outcome; }
    finally {
      options.signal?.removeEventListener("abort", cancelled);
      if (this.pending === pending) this.pending = null;
    }
  }
  stop(): void {
    this.options.loginCache?.configure(false);
    this.watching = false; this.clearRetry();
    const retained = this.retainedContext; this.retainedContext = null; retained?.dispose();
    this.context.cancel(); this.pending?.cleanup(); this.pending = null;
    this.budget.dispose(); this.budget = new SatanicZoneDiagnosticBufferBudget(); this.options.loginCache?.attachBudget(this.budget); this.context = this.createContext();
    this.options.onPreparation(this.preparation);
  }
  dispose(): void {
    this.disposed = true; this.options.loginCache?.dispose();
    this.watching = false; this.clearRetry(); this.retainedContext?.dispose(); this.retainedContext = null;
    this.context.dispose(); this.pending?.cleanup(); this.pending = null; this.budget.dispose();
  }
  private observed(observation: SatanicZoneProviderObservation): void {
    const pending = this.pending;
    if (!pending?.accepted || pending.completed) return;
    pending.completed = true;
    pending.settle({ kind: "observation", observation, availabilityConsumed: false, refreshAvailable: true });
  }
  private changed(context: SatanicZoneInitializedProbeController, state: SatanicZoneDiagnosticState): void {
    if (context !== this.context) {
      if (context === this.retainedContext && !context.active) this.retainedContext = null;
      return;
    }
    if (this.retainedContext && state.phase === "ready" && !context.continuitySuspended) {
      const retained = this.retainedContext; this.retainedContext = null; retained.dispose();
    } else if (this.retainedContext && !context.active) {
      this.context = this.retainedContext; this.retainedContext = null; context.dispose();
      context = this.context; state = context.snapshot();
    }
    const pending = this.pending;
    if (pending && !pending.accepted && state.requestDispatched && state.phase === "requesting") {
      pending.accepted = true; pending.cleanup(); this.nextAllowedAt = this.now() + 30_000;
      pending.dispatch({ accepted: true, errorCode: null, correlationId: pending.id });
    }
    const retainedFailure = state.phase === "ready" && ["failed", "timeout", "cancelled"].includes(state.directOutcome);
    const reinitializing = state.phase === "waiting-initialization" && state.directOutcome === "cancelled";
    if (pending && !pending.completed && (retainedFailure || reinitializing || !["arming", "waiting-initialization", "collecting", "ready", "requesting"].includes(state.phase))) {
      pending.completed = true; pending.cleanup();
      const errorCode = state.phase === "timed-out" || state.directOutcome === "timeout" ? "response_timeout" : "helper_failed";
      pending.dispatch(rejected(errorCode));
      pending.settle({ kind: "terminal", errorCode, availabilityConsumed: false, refreshAvailable: retainedFailure && !context.continuitySuspended });
    }
    this.options.onPreparation(this.preparation);
    if (this.watching && !this.disposed && (!context.active || context.continuitySuspended) && !this.retry) {
      this.retry = setTimeout(() => {
        this.retry = null;
        if (this.watching && this.options.canPrepare()) void this.preparePassively();
      }, 5_000);
      this.retry.unref?.();
    }
  }
  private clearRetry(): void { if (this.retry) clearTimeout(this.retry); this.retry = null; }
}

function projectPreparation(state: SatanicZoneDiagnosticState, suspended: boolean, cached = false): SatanicZonePreparation {
  const phase: SatanicZonePreparation["phase"] = suspended ? "suspended" : state.phase === "arming" ? "opening"
    : state.phase === "waiting-initialization" ? "waiting_connection" : state.phase === "collecting" ? "collecting"
    : state.phase === "ready" ? "ready" : state.phase === "requesting" ? "requesting"
    : state.phase === "idle" || state.phase === "cancelled" ? "idle" : state.phase === "timed-out" ? "expired" : "unavailable";
  const missedLogin = phase === "waiting_connection" && ["api-flow-no-syn", "endpoint-changed-no-syn"].includes(state.selectionStatus);
  return { phase, expiresAt: phase === "requesting" ? state.deadlineAt : null,
    ...(missedLogin ? { reason: "login_missed" as const } : {}), ...(cached ? { origin: "cached" as const } : {}) };
}
function rejected(errorCode: SatanicZoneRefreshDispatchResult["errorCode"]): SatanicZoneRefreshDispatchResult {
  return { accepted: false, errorCode, correlationId: null };
}
