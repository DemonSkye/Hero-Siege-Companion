import { isUtf8 } from "node:buffer";
import { classifySatanicZoneDiagnosticApiBody } from "./satanic-zone-diagnostic-frame-kind";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import type { DiagnosticConnectAcknowledgment } from "../shared/satanic-zone-diagnostic";

/** Main-only, represented-input subset. These strings must never cross IPC. */
export interface InitializedProbeIdentity { uniqueAccountId: string; beta: string }
const ID = /^\d{1,20}$/;
export function probeIdentifier(value: unknown): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;
  return (typeof value === "string" || typeof value === "number") && ID.test(String(value)) ? String(value) : null;
}

export function connectProbeIdentity(body: Buffer): InitializedProbeIdentity | null {
  if (classifySatanicZoneDiagnosticApiBody(body, true) !== "connect-shaped") return null;
  const record = JSON.parse(body.subarray(3, body.indexOf(0, 3)).toString("utf8")) as Record<string, unknown>;
  const uid = probeIdentifier(record.account_uid);
  // Account/checksum are opaque represented values. The classifier validates
  // their presence/scalar shape; native success validates this captured pair.
  // Replaying exact bytes does not require choosing a serializer/coercion policy.
  if (!uid) return null;
  return { uniqueAccountId: uid, beta: record.beta === true ? "1" : "0" };
}

export function isProbePostLogin(body: Buffer): boolean {
  const command = Buffer.from("post_login_crossregion\0");
  return body.length >= 4 && body.readUInt16LE(0) === 3 && body.readUInt16LE(2) === 1
    && body.subarray(4, 4 + command.length).equals(command);
}

export function coherentProbePostLogin(body: Buffer, identity: InitializedProbeIdentity): boolean {
  if (!isProbePostLogin(body) || classifySatanicZoneDiagnosticApiBody(body, true) !== "region-api-request") return false;
  const end = body.indexOf(0, 4);
  if (body.readUInt16LE(end + 1) !== 83) return false;
  const query = new URLSearchParams(body.subarray(end + 3, body.length - 1).toString("utf8"));
  const keys = ["account_id", "unique_account_id", "platform", "checksum", "guild_id", "pact_ids", "beta"];
  if ([...query.keys()].length !== keys.length || keys.some(key => query.getAll(key).length !== 1)) return false;
  return query.get("unique_account_id") === identity.uniqueAccountId && query.get("beta") === identity.beta
    && query.get("platform") === "0" && Boolean(query.get("account_id")) && /^[a-f0-9]{64}$/i.test(query.get("checksum") ?? "");
}

/** Structural evidence only: never decode or retain the acknowledgment value. */
export function summarizeProbeConnectAcknowledgment(body: Buffer): DiagnosticConnectAcknowledgment {
  const opcode = body.length >= 2 ? body.readUInt16LE(0) : null;
  const terminator = body.indexOf(0, 2);
  return { bodyBytes: body.length, opcode: opcode === 0x1000 ? "0x1000" : opcode === 1 ? "0x0001" : opcode === null ? "missing" : "other",
    trailingNul: body.length > 2 && body[body.length - 1] === 0,
    embeddedNul: terminator >= 2 && terminator !== body.length - 1 };
}

/** Exact connect-ack opcode, optionally followed by a bounded type-11 string.
 * A client-side string read does not establish that the wire always has a value.
 * Framing and the caller's Connect/order/login gates remain required.
 */
export function isProbeConnectAcknowledgment(body: Buffer): boolean {
  return body.length >= 2 && body.length <= 16_384 && body.readUInt16LE(0) === 0x1000
    && (body.length === 2 || (body.indexOf(0, 2) === body.length - 1 && isUtf8(body.subarray(2, body.length - 1))));
}

/** 0x53 carries a buffer_string JSON object. Reject duplicate top-level fields. */
export function successfulProbeIdentifier(body: Buffer): string | null {
  if (body.length < 4 || body.length > 16_384 || body.readUInt16LE(0) !== 0x53) return null;
  const bytes = body.subarray(2, body[body.length - 1] === 0 ? body.length - 1 : body.length);
  if (!isUtf8(bytes)) return null;
  try {
    const text = bytes.toString("utf8");
    const record: unknown = JSON.parse(text);
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const keys = new Set<string>();
    let depth = 0;
    // Syntax is already validated. Inspect only root keys; repeated names in
    // nested records or quoted values cannot make root status/identity ambiguous.
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === "{" || char === "[") { depth++; continue; }
      if (char === "}" || char === "]") { depth--; continue; }
      if (char !== '"') continue;
      const start = index++;
      while (index < text.length && text[index] !== '"') { if (text[index] === "\\") index++; index++; }
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (depth !== 1 || text[next] !== ":") continue;
      const key: string = JSON.parse(text.slice(start, index + 1));
      if (keys.has(key)) return null;
      keys.add(key);
    }
    const value = record as Record<string, unknown>;
    return value.status === 1 ? probeIdentifier(value.globalIdentifier) : null;
  } catch { return null; }
}

/** Reuses the capture stream's generic/API framing; no reply-counter ordering. */
export class InitializedProbeResponseFrames {
  private bytes: Buffer = Buffer.alloc(0);
  constructor(private readonly budget: SatanicZoneDiagnosticBufferBudget) {}
  push(chunk: Buffer, frame: (body: Buffer) => void): void {
    const previous = this.bytes;
    this.bytes = this.budget.concat([previous, chunk]); this.budget.release(previous);
    while (this.bytes.length >= 8) {
      const token = this.bytes.subarray(0, Math.min(12, this.bytes.length)).toString("ascii");
      if (this.bytes.length < 16 && /^[a-f0-9]+$/i.test(token)) return;
      const headerBytes = /^[a-f0-9]{12}$/i.test(token) ? 16 : 8;
      if (this.bytes.length < headerBytes) return;
      const length = this.bytes.readUInt32LE(headerBytes - 4);
      if (length < 2 || length > 16_384) throw new Error("invalid-frame");
      if (this.bytes.length < length + headerBytes) return;
      const current = this.bytes;
      this.bytes = this.budget.copy(current.subarray(length + headerBytes));
      try { frame(current.subarray(headerBytes, length + headerBytes)); } finally { this.budget.release(current); }
    }
  }
  get empty(): boolean { return this.bytes.length === 0; }
  dispose(): void { this.budget.release(this.bytes); this.bytes = Buffer.alloc(0); }
}
