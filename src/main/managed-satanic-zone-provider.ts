import type {
  SatanicZoneObservationWaitOptions,
  SatanicZonePassiveObservationListener,
  SatanicZoneProviderObservation,
  SatanicZoneProviderWaitOutcome,
  SatanicZoneRefreshAvailability,
  SatanicZoneRefreshDispatchResult,
  SatanicZoneRefreshProvider,
  SatanicZoneRefreshRequestOptions,
} from "./satanic-zone-refresh-provider";
import {
  createManagedSatanicZoneRelayRuntime,
  type ManagedRelayWatch,
  type ManagedSatanicZoneRelayReadiness,
  type ManagedSatanicZoneRelayRuntimeOptions,
  type ManagedSatanicZoneRelaySession,
  type RelayJsonRead,
  type SatanicZoneRelayObservationRead,
} from "./satanic-zone-relay-runtime";
import {
  SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS,
  createSatanicZoneRelayCommand,
  isRelayIdentifier,
  parseSatanicZoneRelayPassiveObservation,
  parseSatanicZoneRelayResult,
  type SatanicZoneRelayCommand,
} from "./satanic-zone-relay-protocol";

const DEFAULT_OBSERVATION_TIMEOUT_MS = 25_000;
const MAX_OBSERVATION_TIMEOUT_MS = 30_000;
const MAX_SEEN_PASSIVE_OBSERVATIONS = 128;

export interface ManagedSatanicZoneProviderRuntime {
  ensureReady(signal?: AbortSignal): Promise<ManagedSatanicZoneRelayReadiness>;
  commitCommand(
    session: ManagedSatanicZoneRelaySession,
    command: SatanicZoneRelayCommand,
  ): Promise<"committed" | "pending" | "unavailable">;
  readResult(session: ManagedSatanicZoneRelaySession, commandId: string): Promise<RelayJsonRead>;
  watchResult(
    session: ManagedSatanicZoneRelaySession,
    commandId: string,
    onChange: () => void,
    onError: () => void,
  ): ManagedRelayWatch;
  subscribeToObservations(
    listener: (value: SatanicZoneRelayObservationRead) => void,
  ): () => void;
  scheduleTimeout(callback: () => void, timeoutMs: number): ReturnType<typeof setTimeout>;
  cancelTimeout(timeout: ReturnType<typeof setTimeout>): void;
  createCommandId(): string;
  captureProcessIds(): readonly number[];
  now(): number;
  stop(): void;
  dispose(): void;
}

export interface ManagedSatanicZoneRefreshProviderOptions {
  runtime: ManagedSatanicZoneProviderRuntime;
}

/** Product provider for the owned repeatable relay; its feature gate lives above this boundary. */
export class ManagedSatanicZoneRefreshProvider implements SatanicZoneRefreshProvider {
  readonly experimental = false;
  private readonly pendingSessions = new Map<string, ManagedSatanicZoneRelaySession>();
  private readonly activeWaitCancels = new Set<() => void>();
  private readonly passiveObservationListeners = new Set<SatanicZonePassiveObservationListener>();
  private readonly unsubscribeRuntimeObservations: () => void;
  private passiveObservationSessionId: string | null = null;
  private readonly seenPassiveObservationIds = new Set<string>();
  private latestPassiveObservationCompletedAt = Number.NEGATIVE_INFINITY;
  private dispatchInProgress = false;
  private nextAllowedDispatchAt = 0;
  private disposed = false;

  constructor(private readonly options: ManagedSatanicZoneRefreshProviderOptions) {
    this.unsubscribeRuntimeObservations = options.runtime.subscribeToObservations((value) => {
      this.handlePassiveObservationRead(value);
    });
  }

  async getAvailability(): Promise<SatanicZoneRefreshAvailability> {
    if (this.disposed) return unavailable("helper_unavailable");
    const readiness = await this.readReadiness();
    return readiness.ready
      ? { available: true, experimental: false, errorCode: null }
      : unavailable(readiness.errorCode);
  }

  async requestRefresh(
    options: SatanicZoneRefreshRequestOptions = {},
  ): Promise<SatanicZoneRefreshDispatchResult> {
    if (this.disposed || options.signal?.aborted) return dispatchRejected("helper_unavailable");
    if (this.dispatchInProgress) return dispatchRejected("refresh_pending");

    const now = this.options.runtime.now();
    if (Number.isFinite(now) && now < this.nextAllowedDispatchAt) {
      return dispatchRejected("refresh_cooldown");
    }

    this.dispatchInProgress = true;
    try {
      const readiness = await this.readReadiness(options.signal);
      if (!readiness.ready) return dispatchRejected(readiness.errorCode);
      if (options.signal?.aborted) return dispatchRejected("helper_unavailable");

      const commandId = this.options.runtime.createCommandId();
      const requestedAt = this.options.runtime.now();
      const command = createSatanicZoneRelayCommand(
        commandId,
        readiness.session.sessionId,
        requestedAt,
      );
      if (!command) return dispatchRejected("helper_failed");

      const outcome = await this.options.runtime.commitCommand(readiness.session, command);
      if (outcome === "pending") return dispatchRejected("refresh_pending");
      if (outcome !== "committed") return dispatchRejected("helper_unavailable");

      // A committed command cannot be retracted. Record it even if cancellation
      // races immediately after the atomic handoff.
      this.nextAllowedDispatchAt = requestedAt + SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS;
      this.pendingSessions.set(commandId, readiness.session);
      return { accepted: true, errorCode: null, correlationId: commandId };
    } catch {
      return dispatchRejected("helper_failed");
    } finally {
      this.dispatchInProgress = false;
    }
  }

  waitForObservation(
    correlationId: string,
    options: SatanicZoneObservationWaitOptions,
  ): Promise<SatanicZoneProviderWaitOutcome | null> {
    if (this.disposed || !isRelayIdentifier(correlationId) || options.signal?.aborted) {
      return Promise.resolve(null);
    }
    const session = this.pendingSessions.get(correlationId);
    if (!session) return Promise.resolve(null);

    const timeoutMs = boundedObservationTimeout(options.timeoutMs);
    return new Promise((resolve, reject) => {
      let settled = false;
      let reading = false;
      let readAgain = false;
      let watcher: ManagedRelayWatch | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const closeResources = () => {
        if (timeout !== null) this.options.runtime.cancelTimeout(timeout);
        timeout = null;
        try {
          watcher?.close();
        } catch {
          // A concurrent abort or helper exit may already have closed it.
        }
        watcher = null;
        options.signal?.removeEventListener("abort", onAbort);
        this.pendingSessions.delete(correlationId);
        this.activeWaitCancels.delete(cancelWait);
      };
      const finish = (outcome: SatanicZoneProviderWaitOutcome | null) => {
        if (settled) return;
        settled = true;
        closeResources();
        resolve(outcome);
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        closeResources();
        reject(new Error("Satanic Zone relay result watch failed."));
      };
      const inspectLatest = () => {
        if (settled) return;
        if (reading) {
          readAgain = true;
          return;
        }
        reading = true;
        void (async () => {
          do {
            readAgain = false;
            const read = await this.options.runtime.readResult(session, correlationId);
            const outcome = parseRelayRead(
              read,
              correlationId,
              session.sessionId,
              this.options.runtime.now(),
            );
            if (outcome !== undefined) {
              finish(outcome);
              return;
            }
          } while (readAgain && !settled);
          reading = false;
        })().catch(fail);
      };
      const onAbort = () => finish(null);
      const cancelWait = () => finish(null);

      this.activeWaitCancels.add(cancelWait);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      timeout = this.options.runtime.scheduleTimeout(() => finish(null), timeoutMs);
      try {
        watcher = this.options.runtime.watchResult(session, correlationId, inspectLatest, fail);
      } catch {
        fail();
        return;
      }
      // Watch first, then read once to close the atomic-result publication race.
      inspectLatest();
    });
  }

  subscribeToPassiveObservations(listener: SatanicZonePassiveObservationListener): () => void {
    if (this.disposed) return () => undefined;
    this.passiveObservationListeners.add(listener);
    return () => this.passiveObservationListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cancel of [...this.activeWaitCancels]) cancel();
    this.pendingSessions.clear();
    this.passiveObservationListeners.clear();
    this.unsubscribeRuntimeObservations();
    this.clearPassiveObservationHistory();
    this.options.runtime.dispose();
  }

  captureProcessIds(): readonly number[] {
    return this.disposed ? [] : this.options.runtime.captureProcessIds();
  }

  stop(): void {
    if (this.disposed) return;
    for (const cancel of [...this.activeWaitCancels]) cancel();
    this.pendingSessions.clear();
    this.clearPassiveObservationHistory();
    this.options.runtime.stop();
  }

  private async readReadiness(signal?: AbortSignal): Promise<ManagedSatanicZoneRelayReadiness> {
    try {
      return await this.options.runtime.ensureReady(signal);
    } catch {
      return { ready: false, errorCode: "helper_unavailable" };
    }
  }

  private handlePassiveObservationRead(value: SatanicZoneRelayObservationRead): void {
    if (this.disposed || value.read.kind !== "record") return;
    const parsed = parseSatanicZoneRelayPassiveObservation(
      value.read.value,
      value.session.sessionId,
      value.session.createdAt,
      this.options.runtime.now(),
    );
    if (!parsed) return;

    if (this.passiveObservationSessionId !== value.session.sessionId) {
      this.clearPassiveObservationHistory();
      this.passiveObservationSessionId = value.session.sessionId;
    }
    if (
      this.seenPassiveObservationIds.has(parsed.observationId)
      || parsed.completedAt < this.latestPassiveObservationCompletedAt
    ) return;

    this.seenPassiveObservationIds.add(parsed.observationId);
    this.latestPassiveObservationCompletedAt = parsed.completedAt;
    while (this.seenPassiveObservationIds.size > MAX_SEEN_PASSIVE_OBSERVATIONS) {
      const oldestId = this.seenPassiveObservationIds.values().next().value;
      if (typeof oldestId !== "string") break;
      this.seenPassiveObservationIds.delete(oldestId);
    }

    const observation = cloneProviderObservation(parsed.observation);
    for (const listener of [...this.passiveObservationListeners]) {
      try {
        listener(cloneProviderObservation(observation));
      } catch {
        // A consumer failure must not stop later passive observations.
      }
    }
  }

  private clearPassiveObservationHistory(): void {
    this.passiveObservationSessionId = null;
    this.seenPassiveObservationIds.clear();
    this.latestPassiveObservationCompletedAt = Number.NEGATIVE_INFINITY;
  }
}

export function createManagedSatanicZoneRefreshProvider(
  runtimeOptions: ManagedSatanicZoneRelayRuntimeOptions,
): ManagedSatanicZoneRefreshProvider {
  return new ManagedSatanicZoneRefreshProvider({
    runtime: createManagedSatanicZoneRelayRuntime(runtimeOptions),
  });
}

function parseRelayRead(
  read: RelayJsonRead,
  commandId: string,
  sessionId: string,
  now: number,
): SatanicZoneProviderWaitOutcome | null | undefined {
  if (read.kind === "missing") return undefined;
  if (read.kind === "invalid") return terminalFailure();
  return parseSatanicZoneRelayResult(read.value, commandId, sessionId, now) ?? terminalFailure();
}

function terminalFailure(): SatanicZoneProviderWaitOutcome {
  return { kind: "terminal", errorCode: "helper_failed", availabilityConsumed: false };
}

function unavailable(
  errorCode: "refresh_not_configured" | "helper_unavailable" | "helper_not_ready",
): SatanicZoneRefreshAvailability {
  return { available: false, experimental: false, errorCode };
}

function dispatchRejected(
  errorCode: NonNullable<SatanicZoneRefreshDispatchResult["errorCode"]>,
): SatanicZoneRefreshDispatchResult {
  return { accepted: false, errorCode, correlationId: null };
}

function boundedObservationTimeout(value: number): number {
  return Number.isFinite(value) && value > 0
    ? Math.min(MAX_OBSERVATION_TIMEOUT_MS, Math.floor(value))
    : DEFAULT_OBSERVATION_TIMEOUT_MS;
}

function cloneProviderObservation(
  observation: SatanicZoneProviderObservation,
): SatanicZoneProviderObservation {
  return {
    observedAt: observation.observedAt,
    zone: {
      ...observation.zone,
      pros: observation.zone.pros.map((effect) => ({ ...effect })),
      cons: observation.zone.cons.map((effect) => ({ ...effect })),
      buffs: observation.zone.buffs.map((effect) => ({ ...effect })),
    },
  };
}
