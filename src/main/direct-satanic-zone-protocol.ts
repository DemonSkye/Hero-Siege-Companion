import { createHash } from "node:crypto";
import { createSatanicZoneInfo, type SatanicZoneInfo } from "../shared/parser";
import type { SatanicZoneRequestContext } from "./captured-session-context";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";

const MAX_RESPONSE_BYTES = 1_048_576;
const API_CONTROL_RESPONSE_BYTES = 10;

function buildDirectApiFrame(body: Buffer, counter: number, budget?: SatanicZoneDiagnosticBufferBudget): Buffer {
  if (!Number.isInteger(counter) || counter < 0 || counter > 255) throw new Error("invalid API counter");
  const counterByte = budget?.allocate(1) ?? Buffer.alloc(1);
  counterByte[0] = counter;
  try {
    const token = createHash("md5").update(body).update(counterByte).digest("hex").slice(0, 12);
    const frame = budget?.allocate(16 + body.length) ?? Buffer.alloc(16 + body.length);
    frame.write(token, 0, 12, "ascii"); frame.writeUInt32LE(body.length, 12); body.copy(frame, 16);
    return frame;
  } finally { budget ? budget.release(counterByte) : counterByte.fill(0); }
}

export function buildDirectApiPingFrame(counter = 0, budget?: SatanicZoneDiagnosticBufferBudget): Buffer {
  const body = budget?.allocate(2) ?? Buffer.alloc(2); body[0] = 1;
  try { return buildDirectApiFrame(body, counter, budget); }
  finally { budget ? budget.release(body) : body.fill(0); }
}

export function buildDirectSatanicZoneFrame(context: SatanicZoneRequestContext, counter = 1, budget?: SatanicZoneDiagnosticBufferBudget): Buffer {
  const query = new URLSearchParams({
    unique_account_id: context.uniqueAccountId,
    crossregion_identifier: context.crossregionIdentifier,
    beta: context.beta,
  }).toString();
  const body = budget?.allocate(24 + Buffer.byteLength(query)) ?? Buffer.alloc(24 + Buffer.byteLength(query));
  body.writeUInt16LE(3, 0); body.writeUInt16LE(1, 2);
  body.write("satanic_zone_get\0R\0", 4, "utf8"); body.write(query, 23, "utf8");
  try { return buildDirectApiFrame(body, counter, budget); }
  finally { budget ? budget.release(body) : body.fill(0); }
}

export class DirectApiPingResponseDecoder {
  private buffered: Buffer = Buffer.alloc(0);
  constructor(private readonly budget?: SatanicZoneDiagnosticBufferBudget) {}

  dispose(): void { this.budget ? this.budget.release(this.buffered) : this.buffered.fill(0); this.buffered = Buffer.alloc(0); }

  push(chunk: Buffer): Buffer | null {
    if (chunk.length === 0) return null;
    if (this.buffered.length + chunk.length > MAX_RESPONSE_BYTES) throw new Error("ping response too large");
    const previous = this.buffered;
    this.buffered = this.budget?.concat([previous, chunk]) ?? Buffer.concat([previous, chunk]);
    this.budget ? this.budget.release(previous) : previous.fill(0);
    if (this.buffered.length < 8) return null;
    if (this.buffered.readUInt32LE(4) !== 2) throw new Error("invalid ping response");
    if (this.buffered.length < API_CONTROL_RESPONSE_BYTES) return null;
    if (this.buffered.readUInt16LE(8) !== 1) throw new Error("invalid ping response");
    return this.buffered.subarray(API_CONTROL_RESPONSE_BYTES);
  }
}

export class DirectSatanicZoneResponseDecoder {
  private buffered: Buffer = Buffer.alloc(0);
  constructor(private readonly budget?: SatanicZoneDiagnosticBufferBudget) {}

  dispose(): void { this.budget ? this.budget.release(this.buffered) : this.buffered.fill(0); this.buffered = Buffer.alloc(0); }

  push(chunk: Buffer, observedAt: number): SatanicZoneInfo | null {
    if (chunk.length === 0) return null;
    if (this.buffered.length + chunk.length > MAX_RESPONSE_BYTES) throw new Error("response too large");
    const previous = this.buffered;
    this.buffered = this.budget?.concat([previous, chunk]) ?? Buffer.concat([previous, chunk]);
    this.budget ? this.budget.release(previous) : previous.fill(0);
    // The independent socket can receive connection/status bytes before the
    // requested response, and capture evidence does not establish one envelope
    // for every server message. Keep the stream bounded and accept only a fully
    // parsed, strictly validated zone object wherever it appears.
    return extractSatanicZoneObservation(this.buffered, observedAt);
  }
}

export function extractSatanicZoneObservation(payload: Buffer, observedAt: number): SatanicZoneInfo | null {
  const text = payload.toString("utf8");
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    const parsed = parseJsonPrefix(text.slice(start));
    if (!parsed) continue;
    const zone = findZoneRecord(parsed);
    if (!zone) continue;
    const rawZone = zoneValue(zone, "satanicZoneName", "satanic_zone_name");
    const buffs = effectIds(zoneValue(zone, "buffs", "zone_buffs"));
    const debuffs = effectIds(zoneValue(zone, "debuffs", "zone_debuffs"));
    if (typeof rawZone !== "string" || !/^[A-Za-z0-9_ -]{1,128}$/.test(rawZone) || !buffs || !debuffs) continue;
    return createSatanicZoneInfo(rawZone.trim(), buffs, debuffs, observedAt);
  }
  return null;
}

function parseJsonPrefix(text: string): unknown {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(0, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function findZoneRecord(root: unknown): Record<string, unknown> | null {
  const pending: unknown[] = [root];
  let inspected = 0;
  while (pending.length && inspected < 256) {
    const current = pending.pop();
    inspected += 1;
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const record = current as Record<string, unknown>;
      if ("satanicZoneName" in record || "satanic_zone_name" in record) return record;
      pending.push(...Object.values(record));
    } else if (Array.isArray(current)) pending.push(...current);
  }
  return null;
}

function zoneValue(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (key in record) return record[key];
  return undefined;
}

function effectIds(value: unknown): number[] | null {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string" ? value.replace(/,/g, "|").split("|").filter(Boolean) : null;
  if (!entries) return null;
  const result: number[] = [];
  for (const entry of entries) {
    if (typeof entry === "boolean" || !/^\d{1,4}$/.test(String(entry))) return null;
    const id = Number(entry);
    if (!Number.isInteger(id) || id <= 0 || id > 4096) return null;
    result.push(id);
  }
  return result.slice(0, 64);
}
