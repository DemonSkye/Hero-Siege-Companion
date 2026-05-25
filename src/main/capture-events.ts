import { EVENT_NAMES } from "../shared/constants";
import type { MessageValue } from "../shared/fields";
import type { ParsedEvent } from "../shared/parser";

export function summarizeEvent(event: ParsedEvent): string {
  const json = JSON.stringify(event.value);
  return `Parsed ${event.name}: ${json}`;
}

export function eventFingerprint(event: ParsedEvent): string {
  try {
    return `${event.name}:${JSON.stringify(event.value)}`;
  } catch {
    return `${event.name}:${String(event.value)}`;
  }
}

export function shouldDebugPayload(payloadText: string, messages: MessageValue[], events: ParsedEvent[]): boolean {
  if (
    events.some(
      (event) =>
        event.name === EVENT_NAMES.item ||
        event.name === EVENT_NAMES.itemDrop ||
        event.name === EVENT_NAMES.gold ||
        event.name === EVENT_NAMES.mail ||
        event.name === EVENT_NAMES.satanicZone,
    )
  ) {
    return true;
  }

  return (
    /\b(?:addeditem|rarity|gold|currency|gss|gsh|gns|gnh|gbp|mail)\b/i.test(payloadText) ||
    messages.some((message) => messageHasRoute(message, /^(?:mailbox|satanic_zone)\//i))
  );
}

export function isOnlyItemEvents(events: ParsedEvent[]): boolean {
  return events.length > 0 && events.every((event) => event.name === EVENT_NAMES.item || event.name === EVENT_NAMES.itemDrop);
}

export function messageKeySummary(value: MessageValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.keys(value)
    .filter((key) => /^[\w-]{1,48}$/.test(key))
    .slice(0, 16)
    .join(",");
}

export function messageHasRoute(value: MessageValue, routePattern: RegExp): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = String((value as Record<string, unknown>).route ?? (value as Record<string, unknown>).__route ?? "");
  return routePattern.test(route);
}

export function objectMessages(values: MessageValue[]): Array<Record<string, MessageValue>> {
  return values.filter((value): value is Record<string, MessageValue> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
}

export function isGeneratedItemDataResponse(value: Record<string, MessageValue>): boolean {
  const itemData = value.itemData ?? value.item_data;
  if (!itemData || typeof itemData !== "object" || Array.isArray(itemData)) return false;
  return String(value.message ?? "").toLowerCase() === "ok" && Boolean(value.itemGenHash ?? value.item_gen_hash);
}

export function endpointKey(address: string, port: number): string {
  return `${address}:${port}`;
}

export function shouldLogEvent(event: ParsedEvent): boolean {
  if (event.name === EVENT_NAMES.accountMode) return false;
  return true;
}
