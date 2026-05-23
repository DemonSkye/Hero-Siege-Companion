import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { isRecord, stringField } from "./text";

export interface ItemResearchEntry {
  signature: string;
  label: string;
  rarity: string;
  type: number;
  id: number;
  dropQuality: number;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  resolvedName: string;
  notes: string;
  ignored: boolean;
}

export const ITEM_RESEARCH_ENTRY_LIMIT = 200;

export function isItemResearchCandidate(item: ItemTimelineEntry): boolean {
  if (item.localizationId) return false;
  if ([12, 13, 14, 15].includes(item.type)) return false;
  const label = item.label.trim();
  if (!label) return true;
  return /(?:^|\s)(?:type|item|weapon|helmet|chest|boots|gloves|amulet|shield|ring|belt|charm|consumable|vial)\s+#\d+/i.test(label)
    || /\bseed\s+\d+/i.test(label)
    || /^unknown item$/i.test(label);
}

export function upsertItemResearchEntry(entries: ItemResearchEntry[], item: ItemTimelineEntry): ItemResearchEntry[] {
  const signature = itemResearchSignature(item);
  const existing = entries.find((entry) => entry.signature === signature);
  const now = item.createdAt || Date.now();
  if (existing) {
    return normalizeItemResearchEntries([
      {
        ...existing,
        label: item.label || existing.label,
        rarity: item.rarity || existing.rarity,
        count: existing.count + Math.max(item.amount || 1, 1),
        lastSeenAt: Math.max(existing.lastSeenAt, now),
      },
      ...entries.filter((entry) => entry.signature !== signature),
    ]);
  }

  return normalizeItemResearchEntries([
    {
      signature,
      label: item.label || "Unknown item",
      rarity: item.rarity || "Unknown",
      type: item.type,
      id: item.id,
      dropQuality: item.dropQuality,
      count: Math.max(item.amount || 1, 1),
      firstSeenAt: now,
      lastSeenAt: now,
      resolvedName: "",
      notes: "",
      ignored: false,
    },
    ...entries,
  ]);
}

export function updateItemResearchEntry(
  entries: ItemResearchEntry[],
  signature: string,
  patch: Partial<Pick<ItemResearchEntry, "resolvedName" | "notes" | "ignored">>,
): ItemResearchEntry[] {
  return normalizeItemResearchEntries(
    entries.map((entry) =>
      entry.signature === signature
        ? {
            ...entry,
            resolvedName: patch.resolvedName === undefined ? entry.resolvedName : cleanText(patch.resolvedName, 120),
            notes: patch.notes === undefined ? entry.notes : cleanText(patch.notes, 500),
            ignored: patch.ignored === undefined ? entry.ignored : Boolean(patch.ignored),
          }
        : entry,
    ),
  );
}

export function normalizeItemResearchEntries(value: unknown): ItemResearchEntry[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const entries: ItemResearchEntry[] = [];
  for (const item of values) {
    if (!isRecord(item)) continue;
    const signature = stringField(item, "signature").trim();
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    const type = numberField(item, "type");
    const id = numberField(item, "id");
    const dropQuality = numberField(item, "dropQuality");
    const firstSeenAt = positiveNumberField(item, "firstSeenAt") || Date.now();
    const lastSeenAt = positiveNumberField(item, "lastSeenAt") || firstSeenAt;
    entries.push({
      signature,
      label: cleanText(stringField(item, "label") || fallbackLabel(type, id), 120),
      rarity: cleanText(stringField(item, "rarity") || "Unknown", 40),
      type,
      id,
      dropQuality,
      count: Math.max(1, numberField(item, "count") || 1),
      firstSeenAt,
      lastSeenAt,
      resolvedName: cleanText(stringField(item, "resolvedName"), 120),
      notes: cleanText(stringField(item, "notes"), 500),
      ignored: Boolean(item.ignored),
    });
  }
  return entries
    .sort((a, b) => Number(Boolean(a.ignored)) - Number(Boolean(b.ignored)) || b.lastSeenAt - a.lastSeenAt)
    .slice(0, ITEM_RESEARCH_ENTRY_LIMIT);
}

export function activeItemResearchEntries(entries: ItemResearchEntry[]): ItemResearchEntry[] {
  return entries.filter((entry) => !entry.ignored && !entry.resolvedName.trim());
}

export function itemResearchSignature(item: ItemTimelineEntry): string {
  return `${item.type}:${item.id}:${item.dropQuality}:${genericLabelKey(item.label)}`;
}

function genericLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function fallbackLabel(type: number, id: number): string {
  return `${ITEM_TYPE_NAMES[type] ?? `Type ${type}`} #${id}`;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = Number(record[field]);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function positiveNumberField(record: Record<string, unknown>, field: string): number {
  const value = Number(record[field]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function cleanText(value: string, limit: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, limit);
}
