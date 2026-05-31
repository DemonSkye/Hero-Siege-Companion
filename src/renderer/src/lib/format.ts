export const MAGIC_FIND_FLAG_METRIC_LABEL = "Magic-find flagged";
export const MAGIC_FIND_FLAG_SHORT_LABEL = "MF flagged";
export const MAGIC_FIND_FLAG_HELP = "Server-provided magic-find flags. This is not local proof that magic find caused a drop.";

export function formatNumber(value: number): string {
  return Math.trunc(value || 0).toLocaleString();
}

export function formatMagicFindFlagCount(value: number, options: { short?: boolean } = {}): string {
  return `${formatNumber(value)} ${options.short ? MAGIC_FIND_FLAG_SHORT_LABEL : MAGIC_FIND_FLAG_METRIC_LABEL.toLowerCase()}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTime(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
