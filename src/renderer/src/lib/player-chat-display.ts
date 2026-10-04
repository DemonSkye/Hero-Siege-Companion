import type { LogEntry } from "../../../shared/app-state";

export const PLAYER_CHAT_DISPLAY_LIMIT = 100;

export interface PlayerChatDisplayEntry {
  id: string;
  createdAt: number;
  playerName: string;
  message: string;
  actionable: boolean;
}

export function projectDiagnosticLogs(logs: readonly LogEntry[], limit: number): LogEntry[] {
  const boundedLimit = normalizeDisplayLimit(limit);
  if (boundedLimit === 0) return [];
  const projected: LogEntry[] = [];

  for (const log of logs) {
    if (log.playerChat) continue;
    projected.push(log);
    if (projected.length >= boundedLimit) break;
  }

  return projected;
}

export function projectPlayerChatEntries(
  logs: readonly LogEntry[],
  limit = PLAYER_CHAT_DISPLAY_LIMIT,
): PlayerChatDisplayEntry[] {
  const boundedLimit = normalizeDisplayLimit(limit);
  if (boundedLimit === 0) return [];
  const projected: PlayerChatDisplayEntry[] = [];

  for (const log of logs) {
    if (!log.playerChat) continue;
    projected.push({
      id: log.id,
      createdAt: log.createdAt,
      playerName: log.playerChat.playerName,
      message: log.playerChat.message,
      actionable: log.playerChat.actionable,
    });
    if (projected.length >= boundedLimit) break;
  }

  return projected;
}

function normalizeDisplayLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
}
