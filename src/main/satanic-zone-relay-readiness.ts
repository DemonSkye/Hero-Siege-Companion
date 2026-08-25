import path from "node:path";
import type { SatanicZoneRefreshErrorCode } from "./satanic-zone-refresh-provider";
import { parseSatanicZoneRelayReadyState } from "./satanic-zone-relay-protocol";
import type {
  ManagedRelayWatch,
  ManagedSatanicZoneRelayRuntimeDependencies,
} from "./satanic-zone-relay-runtime-io";

const START_CLOCK_SKEW_MS = 5000;

export interface ManagedSatanicZoneRelaySession {
  sessionId: string;
  directory: string;
  pid: number;
  createdAt: number;
}

export type ManagedSatanicZoneRelayReadiness =
  | { ready: true; session: ManagedSatanicZoneRelaySession }
  | {
      ready: false;
      errorCode: Extract<
        SatanicZoneRefreshErrorCode,
        "refresh_not_configured" | "helper_unavailable" | "helper_not_ready"
      >;
    };

export function waitForSatanicZoneRelayReadiness(options: {
  session: ManagedSatanicZoneRelaySession;
  dependencies: ManagedSatanicZoneRelayRuntimeDependencies;
  startupTimeoutMs: number;
  isCurrentSession: () => boolean;
  signal?: AbortSignal;
}): Promise<ManagedSatanicZoneRelayReadiness> {
  const { dependencies, session, signal } = options;
  const readyPath = path.join(session.directory, "ready.json");
  return new Promise((resolve) => {
    let settled = false;
    let reading = false;
    let readAgain = false;
    let watcher: ManagedRelayWatch | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const closeResources = () => {
      if (timeout !== null) dependencies.cancelTimeout(timeout);
      timeout = null;
      try {
        watcher?.close();
      } catch {
        // The watcher may already be closed by an exit race.
      }
      watcher = null;
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (result: ManagedSatanicZoneRelayReadiness) => {
      if (settled) return;
      settled = true;
      closeResources();
      resolve(result);
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
          if (!options.isCurrentSession()) {
            finish(unavailable("helper_unavailable"));
            return;
          }
          const read = await dependencies.readJson(readyPath);
          if (!options.isCurrentSession()) {
            finish(unavailable("helper_unavailable"));
            return;
          }
          if (read.kind === "invalid") {
            finish(unavailable("helper_unavailable"));
            return;
          }
          if (read.kind === "record") {
            const ready = parseSatanicZoneRelayReadyState(read.value, session.sessionId, session.pid);
            const now = dependencies.now();
            if (
              !ready
              || ready.startedAt < session.createdAt - START_CLOCK_SKEW_MS
              || ready.startedAt > now + START_CLOCK_SKEW_MS
            ) {
              finish(unavailable("helper_unavailable"));
              return;
            }
            finish({ ready: true, session: { ...session } });
            return;
          }
        } while (readAgain && !settled);
        reading = false;
      })().catch(() => finish(unavailable("helper_unavailable")));
    };
    const onAbort = () => finish(unavailable("helper_unavailable"));

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timeout = dependencies.scheduleTimeout(
      () => finish(unavailable(options.isCurrentSession() ? "helper_not_ready" : "helper_unavailable")),
      options.startupTimeoutMs,
    );
    try {
      watcher = dependencies.watchDirectory(
        session.directory,
        path.basename(readyPath),
        inspectLatest,
        () => finish(unavailable("helper_unavailable")),
      );
    } catch {
      finish(unavailable("helper_unavailable"));
      return;
    }
    // Watch first, then read to close the atomic-publication race.
    inspectLatest();
  });
}

export function unavailableRelayReadiness(
  errorCode: "refresh_not_configured" | "helper_unavailable" | "helper_not_ready",
): ManagedSatanicZoneRelayReadiness {
  return unavailable(errorCode);
}

function unavailable(
  errorCode: "refresh_not_configured" | "helper_unavailable" | "helper_not_ready",
): ManagedSatanicZoneRelayReadiness {
  return { ready: false, errorCode };
}
