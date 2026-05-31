import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import { lookupItemIconFile } from "../../../shared/item-icons";
import { lookupItemTranslation, lookupItemTranslationByName } from "../../../shared/item-lookup";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { itemNameOptionByNormalizedName } from "./item-options";
import { isRecord, normalizeLookupText, stringField } from "./text";

export const ITEM_RESEARCH_CLASSIFICATION_LABELS = {
  "unknown-normal": "Unknown normal item",
  "stack-item": "Stack item",
  "material-collectible": "Material or collectible",
  "generated-placeholder": "Generated placeholder",
  "known-missing-icon": "Known item, app icon missing",
} as const;

export type ItemResearchClassification = keyof typeof ITEM_RESEARCH_CLASSIFICATION_LABELS;
export type ItemResearchExportScope = "all" | "resolved" | "unresolved";

export interface ItemResearchExportOptions {
  scope?: ItemResearchExportScope;
}

export interface ItemResearchEntry {
  signature: string;
  label: string;
  rarity: string;
  type: number;
  id: number;
  dropQuality: number;
  classification: ItemResearchClassification;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  resolvedName: string;
  notes: string;
  ignored: boolean;
}

export const ITEM_RESEARCH_ENTRY_LIMIT = 200;
const GENERIC_UNKNOWN_LABEL_PATTERN =
  /(?:^|\s)(?:type|item|weapon|helmet|chest|boots|gloves|amulet|shield|ring|belt|charm|consumable|vial|collectible|material|socketable|key|sword|dagger|mace|axe|claw|polearm|chainsaw|staff|cane|wand|book|spellblade|bow|gun|flask|throwing|novelty)\s+#\d+/i;
const RESOURCE_LIKE_TYPES = new Set([12, 13, 14, 15]);
const MATERIAL_COLLECTIBLE_TYPES = new Set([13, 14]);
const STACK_ITEM_TYPES = new Set([12, 15]);

interface ItemResearchClassificationInput {
  label: string;
  type: number;
  id: number;
  localizationId?: string;
}

export function isItemResearchCandidate(item: ItemTimelineEntry): boolean {
  const label = item.label.trim();
  const hasGenericLabel = isGenericUnknownLabel(label);
  if (item.localizationId && !hasGenericLabel) return false;
  if (RESOURCE_LIKE_TYPES.has(item.type) && !hasGenericLabel) return false;
  if (!label) return true;
  return hasGenericLabel
    || /\bseed\s+\d+/i.test(label)
    || /^unknown item$/i.test(label);
}

export function upsertItemResearchEntry(entries: ItemResearchEntry[], item: ItemTimelineEntry): ItemResearchEntry[] {
  const signature = itemResearchSignature(item);
  const existing = entries.find((entry) => entry.signature === signature);
  const now = item.createdAt || Date.now();
  const classification = classifyItemResearchFields(item);
  if (existing) {
    return normalizeItemResearchEntries([
      {
        ...existing,
        label: item.label || existing.label,
        rarity: item.rarity || existing.rarity,
        classification,
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
      classification,
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
            resolvedName: patch.resolvedName === undefined ? entry.resolvedName : normalizeResearchItemName(patch.resolvedName),
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
    const label = cleanText(stringField(item, "label") || fallbackLabel(type, id), 120);
    entries.push({
      signature,
      label,
      rarity: cleanText(stringField(item, "rarity") || "Unknown", 40),
      type,
      id,
      dropQuality,
      classification:
        normalizeItemResearchClassification(stringField(item, "classification")) ??
        classifyItemResearchFields({ label, type, id }),
      count: Math.max(1, numberField(item, "count") || 1),
      firstSeenAt,
      lastSeenAt,
      resolvedName: normalizeResearchItemName(stringField(item, "resolvedName")),
      notes: cleanText(stringField(item, "notes"), 500),
      ignored: Boolean(item.ignored),
    });
  }
  return entries
    .sort((a, b) => Number(Boolean(a.ignored)) - Number(Boolean(b.ignored)) || b.lastSeenAt - a.lastSeenAt)
    .slice(0, ITEM_RESEARCH_ENTRY_LIMIT);
}

export function activeItemResearchEntries(entries: ItemResearchEntry[]): ItemResearchEntry[] {
  return entries.filter((entry) => !entry.ignored && !entry.resolvedName.trim() && !isKnownMissingIconResearchEntry(entry));
}

export function isKnownMissingIconResearchEntry(entry: Pick<ItemResearchEntry, "classification">): boolean {
  return entry.classification === "known-missing-icon";
}

export function createItemResearchExportPayload(entries: ItemResearchEntry[], options: ItemResearchExportOptions = {}) {
  const scope = options.scope ?? "all";
  const exportedEntries = normalizeItemResearchEntries(entries)
    .filter((entry) => !entry.ignored)
    .filter((entry) => itemResearchEntryMatchesExportScope(entry, scope))
    .map((entry) => ({
      signature: entry.signature,
      label: entry.label,
      resolvedName: entry.resolvedName,
      resolvedNameKey: entry.resolvedName ? normalizeItemResearchNameKey(entry.resolvedName) : "",
      rarity: entry.rarity,
      type: entry.type,
      id: entry.id,
      dropQuality: entry.dropQuality,
      classification: entry.classification,
      count: entry.count,
      firstSeenAt: new Date(entry.firstSeenAt).toISOString(),
      lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
      notes: entry.notes,
    }));
  const classifications = Object.fromEntries(
    Object.keys(ITEM_RESEARCH_CLASSIFICATION_LABELS).map((classification) => [
      classification,
      exportedEntries.filter((entry) => entry.classification === classification).length,
    ]),
  ) as Record<ItemResearchClassification, number>;

  return {
    app: "hero-siege-companion",
    kind: "item-research",
    version: 1,
    exportedAt: new Date().toISOString(),
    scope,
    shareHint: "Share this JSON as a gist and contact sarevok9 on Reddit or Snyne on the Hero Siege Discord so item lookups can improve.",
    summary: {
      total: exportedEntries.length,
      resolved: exportedEntries.filter((entry) => entry.resolvedName.trim()).length,
      unresolved: exportedEntries.filter((entry) => !entry.resolvedName.trim()).length,
      classifications,
    },
    entries: exportedEntries,
  };
}

export function normalizeResearchItemName(value: string): string {
  const cleaned = cleanText(value, 120);
  if (!cleaned) return "";
  const known = itemNameOptionByNormalizedName.get(normalizeLookupText(cleaned));
  if (known) return known.name;
  return titleCaseItemName(cleaned);
}

export function isKnownItemResearchName(value: string): boolean {
  const cleaned = cleanText(value, 120);
  return Boolean(cleaned && itemNameOptionByNormalizedName.has(normalizeLookupText(cleaned)));
}

export function itemResearchSignature(item: ItemTimelineEntry): string {
  return `${item.type}:${item.id}:${item.dropQuality}:${genericLabelKey(item.label)}`;
}

export function itemResearchClassificationLabel(classification: ItemResearchClassification): string {
  return ITEM_RESEARCH_CLASSIFICATION_LABELS[classification];
}

export function normalizeItemResearchClassification(value: unknown): ItemResearchClassification | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  return Object.prototype.hasOwnProperty.call(ITEM_RESEARCH_CLASSIFICATION_LABELS, normalized)
    ? normalized as ItemResearchClassification
    : null;
}

export function classifyItemResearchFields(input: ItemResearchClassificationInput): ItemResearchClassification {
  const label = input.label.trim();
  if (isGeneratedPlaceholderLabel(label)) return "generated-placeholder";
  if (isKnownNormalItemWithMissingIcon(input)) return "known-missing-icon";
  if (MATERIAL_COLLECTIBLE_TYPES.has(input.type)) return "material-collectible";
  if (STACK_ITEM_TYPES.has(input.type)) return "stack-item";
  return "unknown-normal";
}

function isGenericUnknownLabel(label: string): boolean {
  return GENERIC_UNKNOWN_LABEL_PATTERN.test(label);
}

function itemResearchEntryMatchesExportScope(entry: ItemResearchEntry, scope: ItemResearchExportScope): boolean {
  if (scope === "resolved") return Boolean(entry.resolvedName.trim());
  if (scope === "unresolved") return !entry.resolvedName.trim();
  return true;
}

function isKnownNormalItemWithMissingIcon(input: ItemResearchClassificationInput): boolean {
  if (RESOURCE_LIKE_TYPES.has(input.type)) return false;
  const knownName = knownNormalItemName(input);
  return Boolean(knownName && !lookupItemIconFile(knownName));
}

function knownNormalItemName(input: ItemResearchClassificationInput): string {
  const byName = lookupItemTranslationByName(input.label);
  if (byName) return byName.name;
  const byId = lookupItemTranslation(input.type, input.id);
  if (byId) return byId.name;
  return "";
}

function isGeneratedPlaceholderLabel(label: string): boolean {
  return !label || /^unknown item$/i.test(label) || /\bseed\s+\d+/i.test(label);
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

function normalizeItemResearchNameKey(value: string): string {
  return normalizeLookupText(value.replace(/['’]/g, ""));
}

function titleCaseItemName(value: string): string {
  const smallWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the", "to", "with"]);
  const words = value.split(" ");
  return words
    .map((word, index) => {
      const segments = word.split(/([-'])/);
      return segments
        .map((segment, segmentIndex) => {
          if (segment === "-" || segment === "'") return segment;
          if (!segment) return segment;
          const lower = segment.toLowerCase();
          if (segments[segmentIndex - 1] === "'" && lower.length <= 2) return lower;
          const isSmall = smallWords.has(lower) && index > 0 && index < words.length - 1 && segmentIndex === 0;
          if (isSmall) return lower;
          if (/^[ivxlcdm]+$/i.test(segment) && segment.length <= 6) return segment.toUpperCase();
          return lower.replace(/^\p{L}/u, (char) => char.toUpperCase());
        })
        .join("");
    })
    .join(" ");
}
