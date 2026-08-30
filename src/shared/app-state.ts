import type { CompanionStats, PastRunSummary } from "./stats";
import type { SatanicZoneState } from "./satanic-zone";

export interface LogEntry {
  id: string;
  level: "info" | "success" | "warning" | "error" | "debug";
  message: string;
  createdAt: number;
}

export interface CaptureConnection {
  owningProcess: number;
  state: string | number;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
}

export interface CaptureHealth {
  npcapService: string;
  winPcapCompatible: boolean;
  adminOnly: boolean;
  device: string | null;
  filter: string;
  packetsSeen: number;
  payloadsAssembled: number;
  messagesDecoded: number;
  parsedEvents: number;
  parserErrors: number;
  parserRestarts: number;
  lastParserError: string | null;
}

export interface RunArchivePreferences {
  skipEmptyRuns: boolean;
  minDurationMinutes: number;
}

export interface CapturePreferences {
  captureDebugLogging: boolean;
  capturePayloadLogging: boolean;
  captureWideLogging: boolean;
  satanicZoneDebugLogging: boolean;
}

export type CaptureDiagnosticsLevel = "enhanced" | "deep";
export type CaptureDiagnosticsMode = "off" | "manual" | "timed";

export interface CaptureDiagnosticsModeState {
  mode: CaptureDiagnosticsMode;
  timedUntil: number | null;
}

export interface CaptureDiagnosticsState {
  enhanced: CaptureDiagnosticsModeState;
  deep: CaptureDiagnosticsModeState;
}

export interface ReleaseUpdateInfo {
  version: string;
  currentVersion: string;
  name: string;
  url: string;
  publishedAt: string;
}

export type RunStatus = "recording" | "paused";
export type RunPausedReason = "manual" | "captureStopped" | null;

export interface CompanionState {
  captureRunning: boolean;
  captureStatus: "idle" | "waiting" | "running" | "error";
  captureError: string | null;
  runStatus: RunStatus;
  runPausedReason: RunPausedReason;
  runPausedAt: number | null;
  runPausedDurationMs: number;
  connections: CaptureConnection[];
  health: CaptureHealth;
  satanicZone: SatanicZoneState;
  stats: CompanionStats;
  pastRuns: PastRunSummary[];
  runArchivePreferences: RunArchivePreferences;
  capturePreferences: CapturePreferences;
  captureDiagnostics: CaptureDiagnosticsState;
  logs: LogEntry[];
}
