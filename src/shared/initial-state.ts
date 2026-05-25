import type { CapturePreferences, CompanionState, LogEntry, RunArchivePreferences } from "./app-state";
import { createInitialStats } from "./stats";

export const DEFAULT_RUN_ARCHIVE_PREFERENCES: RunArchivePreferences = {
  skipEmptyRuns: false,
  minDurationMinutes: 0,
};

export const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  createDebugMode: false,
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
    stats: createInitialStats(),
    pastRuns: [],
    runArchivePreferences: DEFAULT_RUN_ARCHIVE_PREFERENCES,
    capturePreferences: DEFAULT_CAPTURE_PREFERENCES,
    logs,
  };
}
