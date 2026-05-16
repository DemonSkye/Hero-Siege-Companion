import type { CompanionStats } from "./stats";

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
}

export interface CompanionState {
  captureRunning: boolean;
  captureStatus: "idle" | "waiting" | "running" | "error";
  captureError: string | null;
  connections: CaptureConnection[];
  health: CaptureHealth;
  stats: CompanionStats;
  logs: LogEntry[];
}
