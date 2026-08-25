import path from "node:path";
import type { ManagedSatanicZoneRelaySession } from "./satanic-zone-relay-readiness";
import type {
  ManagedRelayWatch,
  ManagedSatanicZoneRelayRuntimeDependencies,
  RelayJsonRead,
} from "./satanic-zone-relay-runtime-io";

export const SATANIC_ZONE_RELAY_OBSERVATION_FILENAME = "observation.json";

export interface SatanicZoneRelayObservationRead {
  session: ManagedSatanicZoneRelaySession;
  read: RelayJsonRead;
}

/**
 * Watches before its initial read so an atomic producer overwrite cannot be
 * lost between relay startup and the first readiness result.
 */
export function watchSatanicZoneRelayObservations(options: {
  session: ManagedSatanicZoneRelaySession;
  dependencies: ManagedSatanicZoneRelayRuntimeDependencies;
  isCurrentSession: () => boolean;
  onRead: (observation: SatanicZoneRelayObservationRead) => void;
  onError?: () => void;
}): ManagedRelayWatch {
  const observationPath = path.join(
    options.session.directory,
    SATANIC_ZONE_RELAY_OBSERVATION_FILENAME,
  );
  let closed = false;
  let reading = false;
  let readAgain = false;
  let watcher: ManagedRelayWatch | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      watcher?.close();
    } catch {
      // A helper exit or filesystem error may already have closed it.
    }
    watcher = null;
  };
  const fail = () => {
    if (closed) return;
    close();
    options.onError?.();
  };
  const inspectLatest = () => {
    if (closed || !options.isCurrentSession()) return;
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    void (async () => {
      do {
        readAgain = false;
        if (closed || !options.isCurrentSession()) return;
        const read = await options.dependencies.readJson(observationPath);
        if (closed || !options.isCurrentSession()) return;
        if (read.kind !== "missing") {
          options.onRead({ session: { ...options.session }, read });
        }
      } while (readAgain && !closed);
      reading = false;
    })().catch(fail);
  };

  const createdWatcher = options.dependencies.watchDirectory(
    options.session.directory,
    path.basename(observationPath),
    inspectLatest,
    fail,
  );
  if (closed) createdWatcher.close();
  else watcher = createdWatcher;
  inspectLatest();
  return { close };
}
