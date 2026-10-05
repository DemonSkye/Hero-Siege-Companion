import { isUtf8 } from "node:buffer";
import type { DiagnosticFrameKind } from "../shared/satanic-zone-diagnostic";

const ZONE_PREFIX = "\x03\0\x01\0satanic_zone_get\0R\0";
const MAX_COMMAND_BYTES = 64;
const MAX_ARGUMENT_BYTES = 16_384;
const MAX_CONNECT_JSON_BYTES = 4_096;
const CONNECT_KEYS = new Set(["account", "account_uid", "checksum", "beta", "log_verbose"]);

function stringEnd(body: Buffer, start: number, limit: number): number {
  if (start >= body.length) return -1;
  const offset = body.subarray(start, start + limit + 1).indexOf(0);
  return offset < 0 ? -1 : start + offset;
}

function requestShape(body: Buffer, start: number): boolean {
  const commandEnd = stringEnd(body, start, MAX_COMMAND_BYTES);
  if (commandEnd <= start || !isUtf8(body.subarray(start, commandEnd))) return false;
  const argumentsStart = commandEnd + 3; // NUL followed by a complete u16 mode.
  const argumentsEnd = stringEnd(body, argumentsStart, MAX_ARGUMENT_BYTES);
  return argumentsEnd === body.length - 1 && argumentsEnd >= argumentsStart
    && isUtf8(body.subarray(argumentsStart, argumentsEnd));
}

function uniqueFlatKeys(text: string): boolean {
  // JSON.parse has already validated syntax and the schema excludes nested values.
  // Walk quoted tokens so escaped/duplicate keys cannot hide a different record.
  const seen = new Set<string>();
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '"') continue;
    const start = index++;
    while (index < text.length && text[index] !== '"') {
      if (text[index] === "\\") index++;
      index++;
    }
    let next = index + 1;
    while (/\s/.test(text[next] ?? "") && next < text.length) next++;
    if (text[next] !== ":") continue;
    const key: unknown = JSON.parse(text.slice(start, index + 1));
    if (typeof key !== "string" || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function connectShape(body: Buffer): boolean {
  if (body[2] !== 1) return false;
  const jsonEnd = stringEnd(body, 3, MAX_CONNECT_JSON_BYTES);
  if (jsonEnd <= 3 || body.length !== jsonEnd + 34 || body[body.length - 1] !== 0) return false;
  // Recognize digest syntax only; no secret-dependent checksum is reconstructed.
  for (let index = jsonEnd + 1; index < body.length - 1; index++) {
    const byte = body[index];
    if (!(byte >= 48 && byte <= 57) && !(byte >= 97 && byte <= 102) && !(byte >= 65 && byte <= 70)) return false;
  }
  const jsonBytes = body.subarray(3, jsonEnd);
  if (!isUtf8(jsonBytes)) return false;
  try {
    const text = jsonBytes.toString("utf8");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length < 3 || keys.length > 5 || keys.some((key) => !CONNECT_KEYS.has(key))) return false;
    if (!["account", "account_uid", "checksum"].every((key) => Object.hasOwn(record, key))) return false;
    for (const key of keys) {
      const field = record[key];
      if (key === "beta" || key === "log_verbose") { if (field !== true) return false; }
      else if (field !== null && typeof field !== "string" && typeof field !== "boolean"
        && !(typeof field === "number" && Number.isFinite(field))) return false;
    }
    return uniqueFlatKeys(text);
  } catch { return false; }
}

/** Called only after complete API framing/token/counter validation. Returns no data. */
export function classifySatanicZoneDiagnosticApiBody(body: Buffer, outbound: boolean): DiagnosticFrameKind {
  // Keep existing ping/SZ recognition and therefore diagnostic dispatch gates intact.
  if (body.length === 2 && body.readUInt16LE(0) === 1) return "ping";
  if (body.length >= ZONE_PREFIX.length
    && [...ZONE_PREFIX].every((char, index) => body[index] === char.charCodeAt(0))) return "zone-request";
  if (!outbound || body.length < 3) return "other-api";
  const opcode = body.readUInt16LE(0);
  if (opcode === 0 && connectShape(body)) return "connect-shaped";
  if (opcode === 2 && requestShape(body, 2)) return "api-request";
  if (opcode === 3 && body.length >= 4 && requestShape(body, 4)) return "region-api-request";
  return "other-api";
}
