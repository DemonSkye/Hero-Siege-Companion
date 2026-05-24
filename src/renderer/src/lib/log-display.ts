import type { LogEntry } from "../../../shared/app-state";
import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { itemIconUrl } from "./item-assets";
import { extractJsonNumber, extractJsonString, isRecord, stringField } from "./text";

export function logClass(log: LogEntry): string {
  return `log log-${log.level}`;
}

export function logEventLabel(log: LogEntry): string {
  const payload = parsedLogPayload(log);
  const item = firstLogItem(payload);
  if (item?.rarityName) return String(item.rarityName);
  if (item?.rarity) return String(item.rarity);
  const rawRarity = parsedLogText(log);
  const extractedRarity = extractJsonString(rawRarity, "rarityName") || extractJsonString(rawRarity, "rarity");
  if (extractedRarity) return extractedRarity;
  const parsed = log.message.match(/^Parsed\s+([^:]+):/i);
  if (parsed) return parsed[1];
  if (/gold-like payload did not parse/i.test(log.message)) return "goldParse";
  if (/payload did not parse/i.test(log.message)) return "parse";
  return log.level;
}

export function logEventTone(log: LogEntry): string {
  return `log-event-${logEventLabel(log).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function logSummary(log: LogEntry): string {
  const payload = parsedLogPayload(log);
  const item = firstLogItem(payload);
  if (item) {
    const label = stringField(item, "label") || stringField(item, "localizationId") || "Unknown item";
    const details = [mfDropDetail(item), itemTypeName(item), item.fingerprint ? String(item.fingerprint) : ""].filter(Boolean);
    return details.length ? `${label} - ${details.join(" - ")}` : label;
  }

  const rawPayload = parsedLogText(log);
  const extractedLabel = extractJsonString(rawPayload, "label") || extractJsonString(rawPayload, "localizationId");
  if (extractedLabel) {
    const extractedType = extractJsonNumber(rawPayload, "type");
    const extractedMfDrop = extractJsonNumber(rawPayload, "mfDrop");
    const extractedFingerprint = extractJsonString(rawPayload, "fingerprint");
    const details = [
      extractedMfDrop !== null ? `mfDrop=${extractedMfDrop}` : "",
      extractedType !== null ? (ITEM_TYPE_NAMES[extractedType] ?? "") : "",
      extractedFingerprint,
    ].filter(Boolean);
    return details.length ? `${extractedLabel} - ${details.join(" - ")}` : extractedLabel;
  }

  if (isRecord(payload)) {
    const zone = stringField(payload, "zone");
    if (zone) return zone;
    const account = stringField(payload, "name");
    if (account) return account;
    const gold = stringField(payload, "GSS") || stringField(payload, "GSH") || stringField(payload, "GNS") || stringField(payload, "GNH") || stringField(payload, "GBP");
    if (gold) return `Gold ${Number(gold).toLocaleString()}`;
  }

  return log.message.replace(/^Parsed\s+[^:]+:\s*/i, "").trim();
}

export function logItemIconUrl(log: LogEntry): string {
  const payload = parsedLogPayload(log);
  const item = firstLogItem(payload);
  if (item) return itemIconUrl(stringField(item, "label") || stringField(item, "localizationId"));

  const rawPayload = parsedLogText(log);
  return itemIconUrl(extractJsonString(rawPayload, "label") || extractJsonString(rawPayload, "localizationId"));
}

function parsedLogPayload(log: LogEntry): unknown {
  const text = parsedLogText(log);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parsedLogText(log: LogEntry): string {
  const parsed = log.message.match(/^Parsed\s+[^:]+:\s*(.*)$/i);
  return parsed?.[1]?.trim() ?? "";
}

function firstLogItem(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) return payload.find(isRecord) ?? null;
  return isRecord(payload) && ("label" in payload || "localizationId" in payload || "fingerprint" in payload) ? payload : null;
}

function itemTypeName(item: Record<string, unknown>): string {
  const type = Number(item.type);
  const weaponType = Number(item.weaponType);
  if (type === 3 && Number.isFinite(weaponType) && weaponType > 0) return "Weapon";
  return Number.isFinite(type) ? (ITEM_TYPE_NAMES[type] ?? "") : "";
}

function mfDropDetail(item: Record<string, unknown>): string {
  const value = Number(item.mfDrop);
  return Number.isFinite(value) ? `mfDrop=${value}` : "";
}
