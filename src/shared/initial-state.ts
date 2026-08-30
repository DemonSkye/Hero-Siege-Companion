import type {
  CaptureDiagnosticsState,
  CapturePreferences,
  CompanionState,
  LogEntry,
  RunArchivePreferences,
} from "./app-state";
import { createInitialSatanicZoneState } from "./satanic-zone";
import { createInitialStats } from "./stats";

export const DEFAULT_RUN_ARCHIVE_PREFERENCES: RunArchivePreferences = {
  skipEmptyRuns: true,
  minDurationMinutes: 0,
};

export const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  captureDebugLogging: true,
  capturePayloadLogging: false,
  captureWideLogging: false,
  satanicZoneDebugLogging: true,
};

export const DEFAULT_CAPTURE_DIAGNOSTICS_STATE: CaptureDiagnosticsState = {
  enhanced: { mode: "off", timedUntil: null },
  deep: { mode: "off", timedUntil: null },
};

export function createInitialCompanionState(logs: LogEntry[] = []): CompanionState {
  return {
    captureRunning: false,
    captureStatus: "idle",
    captureError: null,
    runStatus: "recording",
    runPausedReason: null,
    runPausedAt: null,
    runPausedDurationMs: 0,
    connections: [],
    health: {
      npcapService: "Unknown",
      winPcapCompatible: false,
      adminOnly: false,
      device: null,
      filter: "",
      packetsSeen: 0,
      payloadsAssembled: 0,
      messagesDecoded: 0,
      parsedEvents: 0,
      parserErrors: 0,
      parserRestarts: 0,
      lastParserError: null,
    },
    satanicZone: createInitialSatanicZoneState(),
    stats: createInitialStats(),
    pastRuns: [],
    runArchivePreferences: DEFAULT_RUN_ARCHIVE_PREFERENCES,
    capturePreferences: DEFAULT_CAPTURE_PREFERENCES,
    captureDiagnostics: {
      enhanced: { ...DEFAULT_CAPTURE_DIAGNOSTICS_STATE.enhanced },
      deep: { ...DEFAULT_CAPTURE_DIAGNOSTICS_STATE.deep },
    },
    logs,
  };
}
