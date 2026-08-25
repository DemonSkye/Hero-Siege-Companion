import { createHash } from "node:crypto";
import fs from "node:fs";

const ITEM_FINGERPRINT_PATTERN = /\b\d+-\d+-[a-f0-9]{12,}-\d+\b/gi;

export function appendJsonLog(logPath: string | undefined, maxBytes: number, type: string, data: Record<string, unknown>): void {
  if (!logPath) return;

  try {
    rotateLogIfLarge(logPath, maxBytes);
    fs.appendFileSync(logPath, `${JSON.stringify({ ...sanitizeDebugData(data), type, at: new Date().toISOString() })}\n`, "utf8");
  } catch {
    // Diagnostics must never interfere with packet capture.
  }
}

export function sanitizeDebugData(data: Record<string, unknown>): Record<string, unknown> {
  return sanitizeDebugValue(data, "", 0, new WeakSet()) as Record<string, unknown>;
}

export function sanitizeDebugSnippet(text: string, maxLength = 1200): string {
  const normalized = text
    .replace(/\0/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ");

  return redactSensitiveDebugText(normalized).slice(0, maxLength);
}

export function redactSensitiveDebugText(text: string): string {
  return text
    .replace(
      /\b([a-z0-9_]*(?:account_?id|fingerprint|hash|identifier)|checksum)=([^&\s]+)/gi,
      "$1=<redacted>",
    )
    .replace(
      /"([a-z0-9_]*(?:account_?id|fingerprint|hash|identifier)|checksum)"\s*:\s*(?:"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|true|false|null)/gi,
      '"$1":"<redacted>"',
    )
    .replace(ITEM_FINGERPRINT_PATTERN, (fingerprint) => pseudonymizeItemFingerprint(fingerprint));
}

function pseudonymizeItemFingerprint(fingerprint: string): string {
  const type = fingerprint.slice(fingerprint.lastIndexOf("-") + 1);
  const digest = createHash("sha256").update(fingerprint.toLowerCase()).digest("hex").slice(0, 12);
  return `<item-fingerprint:${digest}:type=${type}>`;
}

function sanitizeDebugValue(value: unknown, key: string, depth: number, seen: WeakSet<object>): unknown {
  if (isSensitiveDebugKey(key)) return "<redacted>";
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactSensitiveDebugText(value).slice(0, 4000);
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  if (typeof value !== "object") return String(value);
  if (depth >= 8 || seen.has(value)) return "<truncated>";

  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeDebugValue(entry, "", depth + 1, seen));

  const sanitized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 100)) {
    const sanitizedKey = redactSensitiveDebugText(entryKey).slice(0, 200);
    sanitized[sanitizedKey] = sanitizeDebugValue(entryValue, entryKey, depth + 1, seen);
  }
  return sanitized;
}

function isSensitiveDebugKey(key: string): boolean {
  return /^(?:[a-z0-9_]*(?:account_?id|fingerprint|hash|identifier)|checksum)$/i.test(key);
}

function rotateLogIfLarge(logPath: string, maxBytes: number): void {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size <= maxBytes) return;

  const rotatedPath = `${logPath}.old`;
  if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
  fs.renameSync(logPath, rotatedPath);
}
