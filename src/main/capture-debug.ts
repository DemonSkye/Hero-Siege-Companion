import fs from "node:fs";

export function appendJsonLog(logPath: string | undefined, maxBytes: number, type: string, data: Record<string, unknown>): void {
  if (!logPath) return;

  try {
    rotateLogIfLarge(logPath, maxBytes);
    fs.appendFileSync(logPath, `${JSON.stringify({ type, at: new Date().toISOString(), ...data })}\n`, "utf8");
  } catch {
    // Diagnostics must never interfere with packet capture.
  }
}

export function sanitizeDebugSnippet(text: string, maxLength = 1200): string {
  const normalized = text
    .replace(/\0/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ");

  return redactSensitiveDebugText(normalized).slice(0, maxLength);
}

function redactSensitiveDebugText(text: string): string {
  return text
    .replace(
      /\b(account_id|unique_account_id|crossregion_identifier|identifier|checksum|previous_ig_hash|previous_hash|game_state_hash)=([^&\s]+)/gi,
      "$1=<redacted>",
    )
    .replace(
      /"((?:account_id|unique_account_id|crossregion_identifier))"\s*:\s*\d+/gi,
      '"$1":"<redacted>"',
    )
    .replace(
      /"((?:identifier|checksum|previous_ig_hash|previous_hash|game_state_hash|newIdentifierHash|timestampPrevHash))"\s*:\s*"[^"]*"/gi,
      '"$1":"<redacted>"',
    );
}

function rotateLogIfLarge(logPath: string, maxBytes: number): void {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size <= maxBytes) return;

  const rotatedPath = `${logPath}.old`;
  if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
  fs.renameSync(logPath, rotatedPath);
}
