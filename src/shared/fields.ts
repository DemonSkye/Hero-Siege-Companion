export type MessageValue = null | boolean | number | string | MessageObject | MessageValue[];
export interface MessageObject {
  [key: string]: MessageValue;
}

const MISSING = Symbol("missing");

function normalizeMessageKey(key: string): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function coerceMessageValue(value: MessageValue | undefined): MessageValue | undefined {
  if (typeof value !== "string") return value;

  const stripped = value.trim();
  if (!stripped || (stripped[0] !== "{" && stripped[0] !== "[")) return value;

  try {
    return JSON.parse(stripped) as MessageValue;
  } catch {
    return value;
  }
}

export function getMessageField<T = MessageValue>(
  msg: MessageObject | null | undefined,
  names: string[],
  defaultValue?: T,
): T {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return defaultValue as T;

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(msg, name)) {
      try {
        return coerceMessageValue(msg[name]) as T;
      } catch {
        return defaultValue as T;
      }
    }
  }

  const normalizedNames = new Set(names.map(normalizeMessageKey));
  for (const [key, value] of messageEntries(msg)) {
    if (normalizedNames.has(normalizeMessageKey(key))) {
      try {
        return coerceMessageValue(value) as T;
      } catch {
        return defaultValue as T;
      }
    }
  }

  return defaultValue as T;
}

export function hasMessageField(msg: MessageObject | null | undefined, names: string[]): boolean {
  return getMessageField(msg, names, MISSING as unknown as MessageValue) !== (MISSING as unknown as MessageValue);
}

export function intMessageField(msg: MessageObject | null | undefined, names: string[], defaultValue = 0): number {
  const value = getMessageField(msg, names, defaultValue);
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function asMessageObject(value: MessageValue | undefined): MessageObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as MessageObject) : undefined;
}

export function messageEntries(value: MessageObject | null | undefined): Array<[string, MessageValue]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  try {
    return Object.entries(value) as Array<[string, MessageValue]>;
  } catch {
    return [];
  }
}
