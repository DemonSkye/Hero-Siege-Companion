import path from "node:path";
import { SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS, type SatanicZoneRelayCommand } from "./satanic-zone-relay-protocol";
import {
  watchSatanicZoneRelayObservations,
  type SatanicZoneRelayObservationRead,
} from "./satanic-zone-relay-observation-watch";
import {
  unavailableRelayReadiness,
  waitForSatanicZoneRelayReadiness,
  type ManagedSatanicZoneRelayReadiness,
  type ManagedSatanicZoneRelaySession,
} from "./satanic-zone-relay-readiness";
import {
  defaultManagedSatanicZoneRelayRuntimeDependencies,
  resolveSatanicZoneRelayRuntime,
  type ManagedRelayChild,
  type ManagedRelayWatch,
  type ManagedSatanicZoneRelayRuntimeDependencies,
  type RelayJsonRead,
  type ResolvedSatanicZoneRelayRuntime,
} from "./satanic-zone-relay-runtime-io";

const DEFAULT_STARTUP_TIMEOUT_MS = 5000;
const MAX_STARTUP_TIMEOUT_MS = 15_000;

export type {
  ManagedRelayChild,
  ManagedRelayWatch,
  ManagedSatanicZoneRelayRuntimeDependencies,
  RelayJsonRead,
} from "./satanic-zone-relay-runtime-io";
export type {
  ManagedSatanicZoneRelayReadiness,
  ManagedSatanicZoneRelaySession,
} from "./satanic-zone-relay-readiness";
export type { SatanicZoneRelayObservationRead } from "./satanic-zone-relay-observation-watch";

export interface ManagedSatanicZoneRelayRuntimeOptions {
  resourcesPath: string;
  stateRoot: string;
  relayScriptPath?: string;
  relayExecutablePath?: string;
  processFilter?: string;
  environment?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  dependencies?: ManagedSatanicZoneRelayRuntimeDependencies;
}

interface OwnedRelaySession extends ManagedSatanicZoneRelaySession {
  child: ManagedRelayChild;
}

/** Owns only the relay child it starts; it never writes raw packets through Npcap. */
export class ManagedSatanicZoneRelayRuntime {
  private readonly dependencies: ManagedSatanicZoneRelayRuntimeDependencies;
  private readonly startupTimeoutMs: number;
  private readonly processFilter: string;
  private readonly environment: NodeJS.ProcessEnv;
  private session: OwnedRelaySession | null = null;
  private starting: Promise<ManagedSatanicZoneRelayReadiness> | null = null;
  private readinessAbort: AbortController | null = null;
  private observationWatch: ManagedRelayWatch | null = null;
  private observationWatchSessionId: string | null = null;
  private readonly observationListeners = new Set<(value: SatanicZoneRelayObservationRead) => void>();
  private lifecycleGeneration = 0;
  private disposed = false;

  constructor(private readonly options: ManagedSatanicZoneRelayRuntimeOptions) {
    this.dependencies = options.dependencies ?? defaultManagedSatanicZoneRelayRuntimeDependencies;
    this.startupTimeoutMs = boundedStartupTimeout(options.startupTimeoutMs);
    this.processFilter = validProcessFilter(options.processFilter) ? options.processFilter : "Hero_Siege.exe";
    this.environment = options.environment ?? process.env;
  }

  async ensureReady(signal?: AbortSignal): Promise<ManagedSatanicZoneRelayReadiness> {
    if (this.disposed || signal?.aborted) return unavailableRelayReadiness("helper_unavailable");
    if (this.starting) return this.starting;

    const abort = new AbortController();
    const onCallerAbort = () => abort.abort();
    signal?.addEventListener("abort", onCallerAbort, { once: true });
    this.readinessAbort = abort;
    const generation = this.lifecycleGeneration;
    const starting = this.startAndWaitForReadiness(abort.signal, generation);
    this.starting = starting;
    try {
      return await starting;
    } finally {
      signal?.removeEventListener("abort", onCallerAbort);
      if (this.starting === starting) this.starting = null;
      if (this.readinessAbort === abort) this.readinessAbort = null;
    }
  }

  async commitCommand(
    session: ManagedSatanicZoneRelaySession,
    command: SatanicZoneRelayCommand,
  ): Promise<"committed" | "pending" | "unavailable"> {
    if (!this.isCurrentSession(session)) return "unavailable";
    try {
      const outcome = await this.dependencies.commitJson(path.join(session.directory, "command.json"), command);
      return outcome === "committed" ? "committed" : "pending";
    } catch {
      return "unavailable";
    }
  }

  readResult(
    session: ManagedSatanicZoneRelaySession,
    commandId: string,
  ): Promise<RelayJsonRead> {
    if (!this.isCurrentSession(session)) return Promise.resolve({ kind: "missing" });
    return this.dependencies.readJson(resultPath(session, commandId));
  }

  watchResult(
    session: ManagedSatanicZoneRelaySession,
    commandId: string,
    onChange: () => void,
    onError: () => void,
  ): ManagedRelayWatch {
    if (!this.isCurrentSession(session)) throw new Error("Relay session is unavailable.");
    return this.dependencies.watchDirectory(
      session.directory,
      path.basename(resultPath(session, commandId)),
      onChange,
      onError,
    );
  }

  subscribeToObservations(
    listener: (value: SatanicZoneRelayObservationRead) => void,
  ): () => void {
    if (this.disposed) return () => undefined;
    this.observationListeners.add(listener);
    const session = this.currentSession();
    if (session) this.ensureObservationWatch(session);
    return () => {
      this.observationListeners.delete(listener);
      if (this.observationListeners.size === 0) this.closeObservationWatch();
    };
  }

  scheduleTimeout(callback: () => void, timeoutMs: number): ReturnType<typeof setTimeout> {
    return this.dependencies.scheduleTimeout(callback, timeoutMs);
  }

  cancelTimeout(timeout: ReturnType<typeof setTimeout>): void {
    this.dependencies.cancelTimeout(timeout);
  }

  createCommandId(): string {
    return this.dependencies.createId();
  }

  captureProcessIds(): readonly number[] {
    const session = this.currentSession();
    return session ? [session.pid] : [];
  }

  now(): number {
    return this.dependencies.now();
  }

  stop(): void {
    this.lifecycleGeneration += 1;
    this.readinessAbort?.abort();
    this.closeObservationWatch();
    const session = this.session;
    this.session = null;
    if (session?.child.isRunning()) session.child.terminate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  private async startAndWaitForReadiness(
    signal: AbortSignal,
    generation: number,
  ): Promise<ManagedSatanicZoneRelayReadiness> {
    let session = this.currentSession();
    if (!session) {
      if (!path.isAbsolute(this.options.stateRoot)) {
        return unavailableRelayReadiness("refresh_not_configured");
      }
      const runtime = await resolveSatanicZoneRelayRuntime(
        {
          resourcesPath: this.options.resourcesPath,
          relayScriptPath: this.options.relayScriptPath,
          relayExecutablePath: this.options.relayExecutablePath,
          environment: this.environment,
        },
        this.dependencies.isFile,
      );
      if (!runtime) return unavailableRelayReadiness("refresh_not_configured");
      if (signal.aborted || this.disposed || generation !== this.lifecycleGeneration) {
        return unavailableRelayReadiness("helper_unavailable");
      }
      session = await this.startRelay(runtime, generation);
      if (!session) return unavailableRelayReadiness("helper_unavailable");
    }
    this.ensureObservationWatch(session);
    return waitForSatanicZoneRelayReadiness({
      session: publicSession(session),
      dependencies: this.dependencies,
      startupTimeoutMs: this.startupTimeoutMs,
      isCurrentSession: () => this.isCurrentSession(session as OwnedRelaySession),
      signal,
    });
  }

  private currentSession(): OwnedRelaySession | null {
    const session = this.session;
    if (!session?.child.isRunning()) {
      if (this.session === session) {
        this.closeObservationWatch();
        this.session = null;
      }
      return null;
    }
    return session;
  }

  private async startRelay(
    runtime: ResolvedSatanicZoneRelayRuntime,
    generation: number,
  ): Promise<OwnedRelaySession | null> {
    const sessionId = normalizeIdentifier(this.dependencies.createId());
    const createdAt = this.dependencies.now();
    const parentPid = validatedProcessId(process.pid);
    if (!sessionId || !Number.isFinite(createdAt) || parentPid === null) return null;

    const sessionDirectory = path.join(this.options.stateRoot, `session-${sessionId}`);
    try {
      await this.dependencies.makeDirectory(sessionDirectory);
      if (this.disposed || generation !== this.lifecycleGeneration) return null;
      const child = this.dependencies.spawnRelay(
        runtime.executablePath,
        [
          "--mode",
          `local:${this.processFilter}`,
          "--flow-detail",
          "0",
          "--quiet",
          "-s",
          runtime.scriptPath,
        ],
        {
          cwd: path.dirname(runtime.scriptPath),
          environment: relayChildEnvironment(
            this.environment,
            sessionDirectory,
            sessionId,
            parentPid,
          ),
        },
      );
      if (this.disposed || generation !== this.lifecycleGeneration) {
        if (child.isRunning()) child.terminate();
        return null;
      }
      const pid = child.pid;
      if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0 || !child.isRunning()) {
        if (child.isRunning()) child.terminate();
        return null;
      }
      const session: OwnedRelaySession = {
        sessionId,
        directory: sessionDirectory,
        pid: pid as number,
        createdAt,
        child,
      };
      this.session = session;
      this.ensureObservationWatch(session);
      const forgetSession = () => {
        if (this.session === session) {
          this.closeObservationWatch();
          this.session = null;
        }
      };
      child.onExit(forgetSession);
      child.onError(forgetSession);
      return session;
    } catch {
      return null;
    }
  }

  private isCurrentSession(session: ManagedSatanicZoneRelaySession): boolean {
    const current = this.currentSession();
    return current !== null
      && current.sessionId === session.sessionId
      && current.directory === session.directory
      && current.pid === session.pid;
  }

  private ensureObservationWatch(session: OwnedRelaySession): void {
    if (
      this.observationListeners.size === 0
      || this.observationWatchSessionId === session.sessionId
    ) return;
    this.closeObservationWatch();
    try {
      this.observationWatchSessionId = session.sessionId;
      this.observationWatch = watchSatanicZoneRelayObservations({
        session: publicSession(session),
        dependencies: this.dependencies,
        isCurrentSession: () => this.isCurrentSession(session),
        onRead: (value) => {
          for (const listener of [...this.observationListeners]) {
            try {
              listener(value);
            } catch {
              // One main-process consumer must not tear down the owned watch.
            }
          }
        },
        onError: () => this.closeObservationWatch(),
      });
    } catch {
      this.closeObservationWatch();
    }
  }

  private closeObservationWatch(): void {
    const watcher = this.observationWatch;
    this.observationWatch = null;
    this.observationWatchSessionId = null;
    try {
      watcher?.close();
    } catch {
      // A concurrent helper exit or watcher error may already have closed it.
    }
  }
}

export function createManagedSatanicZoneRelayRuntime(
  options: ManagedSatanicZoneRelayRuntimeOptions,
): ManagedSatanicZoneRelayRuntime {
  return new ManagedSatanicZoneRelayRuntime(options);
}

function publicSession(session: OwnedRelaySession): ManagedSatanicZoneRelaySession {
  return {
    sessionId: session.sessionId,
    directory: session.directory,
    pid: session.pid,
    createdAt: session.createdAt,
  };
}

function resultPath(session: ManagedSatanicZoneRelaySession, commandId: string): string {
  return path.join(session.directory, `result-${commandId}.json`);
}

function validProcessFilter(value: string | undefined): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9 _.-]{1,64}\.exe$/u.test(value)
    && !value.includes("..");
}

function normalizeIdentifier(value: string): string | null {
  const normalized = value.replaceAll("-", "").toLowerCase();
  return /^[a-f0-9]{32}$/u.test(normalized) ? normalized : null;
}

function validatedProcessId(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 && value <= 0xFFFF_FFFF
    ? value
    : null;
}

function relayChildEnvironment(
  inherited: NodeJS.ProcessEnv,
  stateDirectory: string,
  sessionId: string,
  parentPid: number,
): NodeJS.ProcessEnv {
  const inheritedEntries = Object.entries(inherited).filter(([key]) => {
    const normalized = key.toUpperCase();
    return !normalized.startsWith("HSC_SZ_POC_")
      && !normalized.startsWith("HSC_SZ_RELAY_")
      && normalized !== "PYTHONUNBUFFERED";
  });
  return {
    ...Object.fromEntries(inheritedEntries),
    HSC_SZ_RELAY_STATE_DIR: stateDirectory,
    HSC_SZ_RELAY_SESSION_ID: sessionId,
    HSC_SZ_RELAY_COMMAND_COOLDOWN_MS: String(SATANIC_ZONE_RELAY_COMMAND_COOLDOWN_MS),
    HSC_SZ_RELAY_PARENT_PID: String(parentPid),
    PYTHONUNBUFFERED: "1",
  };
}

function boundedStartupTimeout(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(MAX_STARTUP_TIMEOUT_MS, Math.floor(value as number))
    : DEFAULT_STARTUP_TIMEOUT_MS;
}
