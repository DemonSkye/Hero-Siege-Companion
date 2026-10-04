import { MARKET_CONTEXT_FIELDS } from "../shared/market-readiness";

export const SESSION_CONTEXT_FIELDS = MARKET_CONTEXT_FIELDS;

export type SessionContextField = typeof SESSION_CONTEXT_FIELDS[number];
export type SessionContextFields = Partial<Record<SessionContextField, string>>;

export interface SessionContextMessage {
  fields: SessionContextFields;
  source: "mailbox" | "market" | "game-api" | "json" | "character-save" | "region-directory";
}

// Identity is top-level. Only the selected-character save may supply mode from
// slot_data; arbitrary nested inventories/players are never sources.
export function extractSessionContextMessages(text: string): SessionContextMessage[] {
  if (text.length > 1_048_576) return [];
  const normalized = text.replace(/\0/g, "");
  const jsonStart = normalized.indexOf("{");
  const formStart = normalized.indexOf("=");
  if (jsonStart >= 0 && (formStart < 0 || jsonStart < formStart)) {
    try {
      return [{ fields: pickFields(JSON.parse(normalized.slice(jsonStart))), source: "json" }];
    } catch {
      return [];
    }
  }
  return splitForms(normalized).flatMap((fragment): SessionContextMessage[] => {
    const identityStart = fragment.search(/unique_account_id=|crossregion_identifier=|(?<![a-z_])account_id=/i);
    if (identityStart < 0) return [];
    const firstKey = fragment.match(/(?:^|[?&\s])([a-z][a-z0-9_]*=)/i);
    const knownFirstKey = firstKey && [...SESSION_CONTEXT_FIELDS, "api_script", "slot", "identifier"]
      .includes(firstKey[1].slice(0, -1));
    const firstKeyStart = firstKey && knownFirstKey ? firstKey.index! + firstKey[0].length - firstKey[1].length : identityStart;
    const start = Math.min(identityStart, firstKeyStart);
    const params = new URLSearchParams(fragment.slice(start).trim());
    const fields = pickFields(Object.fromEntries(params));
    if (SESSION_CONTEXT_FIELDS.some((field) => params.getAll(field).length > 1)) return [];
    const prefix = fragment.slice(0, start);
    if (/(?:^|\s)save(?:\s+\S)?\s*$/.test(prefix) && fields.account_id
      && params.getAll("slot").length === 1 && /^\d{1,3}$/.test(params.get("slot") ?? "")
      && params.getAll("slot_data").length === 1) {
      const mode = characterSaveMode(params.get("slot_data")!);
      if (mode) return [{ fields: { ...fields, ...mode }, source: "character-save" }];
    }
    const source = prefix.includes("mailbox/") ? "mailbox" : prefix.includes("market/") ? "market" : "game-api";
    return [{ fields, source }];
  });
}

function characterSaveMode(text: string): Pick<SessionContextFields, "season" | "hardcore"> | null {
  try {
    const saved = pickFields(JSON.parse(text));
    if (saved.season === undefined || saved.hardcore === undefined) return null;
    return { season: saved.season, hardcore: saved.hardcore };
  } catch {
    return null;
  }
}

function splitForms(text: string): string[] {
  const fragments: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"' && depth > 0) quoted = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth = Math.max(0, depth - 1);
    else if (char === "\\" && depth === 0) {
      fragments.push(text.slice(start, index));
      start = index + 1;
    }
  }
  fragments.push(text.slice(start));
  return fragments;
}

function pickFields(value: unknown): SessionContextFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields: SessionContextFields = {};
  for (const field of SESSION_CONTEXT_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    const candidate = typeof raw === "number" ? String(raw) : raw;
    if (validSessionContextField(field, candidate)) fields[field] = candidate;
  }
  return fields;
}

export function validSessionContextField(field: SessionContextField, value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  if (field === "hardcore" || field === "beta") return /^(0|1)$/.test(value);
  if (field === "season") return /^\d{1,4}$/.test(value);
  if (field === "account_id") return /^(?:[a-z0-9]+-)?\d{1,20}$/i.test(value);
  return /^[a-z0-9_.:+/-]+$/i.test(value);
}

export function isRegionQualifiedAccount(value: string | undefined): boolean {
  return value !== undefined && validSessionContextField("account_id", value) && value.includes("-");
}

export function rawAccountId(value: string): string {
  return value.slice(value.lastIndexOf("-") + 1);
}
