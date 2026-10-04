import { createHash } from "node:crypto";
import { createSatanicZoneInfo, type SatanicZoneInfo } from "../shared/parser";
import type { SatanicZoneRequestContext } from "./captured-session-context";

const MAX_RESPONSE_BYTES = 1_048_576;
const API_CONTROL_RESPONSE_BYTES = 10;

function buildDirectApiFrame(body: Buffer, counter: number): Buffer {
  if (!Number.isInteger(counter) || counter < 0 || counter > 255) throw new Error("invalid API counter");
  const token = createHash("md5").update(body).update(Buffer.from([counter])).digest("hex").slice(0, 12);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from(token, "ascii"), length, body]);
}

export function buildDirectApiPingFrame(counter = 0): Buffer {
  return buildDirectApiFrame(Buffer.from([1, 0]), counter);
}

export function buildDirectSatanicZoneFrame(context: SatanicZoneRequestContext, counter = 1): Buffer {
  const query = new URLSearchParams({
    unique_account_id: context.uniqueAccountId,
    crossregion_identifier: context.crossregionIdentifier,
    beta: context.beta,
  }).toString();
  const body = Buffer.concat([
    Buffer.from([3, 0, 1, 0]),
    Buffer.from("satanic_zone_get\0R\0", "utf8"),
    Buffer.from(query, "utf8"),
    Buffer.from([0]),
  ]);
  return buildDirectApiFrame(body, counter);
}

export class DirectApiPingResponseDecoder {
  private buffered = Buffer.alloc(0);

  push(chunk: Buffer): Buffer | null {
    if (chunk.length === 0) return null;
    if (this.buffered.length + chunk.length > MAX_RESPONSE_BYTES) throw new Error("ping response too large");
    this.buffered = Buffer.concat([this.buffered, chunk]);
    if (this.buffered.length < 8) return null;
    if (this.buffered.readUInt32LE(4) !== 2) throw new Error("invalid ping response");
    if (this.buffered.length < API_CONTROL_RESPONSE_BYTES) return null;
    if (this.buffered.readUInt16LE(8) !== 1) throw new Error("invalid ping response");
    return this.buffered.subarray(API_CONTROL_RESPONSE_BYTES);
  }
}

export class DirectSatanicZoneResponseDecoder {
  private buffered = Buffer.alloc(0);

  push(chunk: Buffer, observedAt: number): SatanicZoneInfo | null {
    if (chunk.length === 0) return null;
    if (this.buffered.length + chunk.length > MAX_RESPONSE_BYTES) throw new Error("response too large");
    this.buffered = Buffer.concat([this.buffered, chunk]);
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
