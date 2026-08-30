import { ITEM_TYPE_NAMES } from "../../../shared/constants";
import {
  activeItemCatalog,
  requiresItemIdentification,
  type ItemCatalogResolution,
  type ItemCatalogResolver,
} from "../../../shared/item-catalog";
import { lookupItemIconFile } from "../../../shared/item-icons";
import { lookupItemTranslation, lookupItemTranslationByName, type ItemRepository } from "../../../shared/item-lookup";
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
  localizationId?: string;
  rarity: string;
  repository: ItemRepository | "unknown";
  type: number;
  id: number;
  weaponType: number;
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
  /(?:^|\s)(?:(?:type|weapon type)\s+\d+|item|weapon|helmet|chest|boots|gloves|amulet|shield|ring|belt|charm|consumable|vial|collectible|material|socketable|key|relic|sword|dagger|mace|axe|claw|polearm|chainsaw|staff|cane|wand|book|spellblade|bow|gun|flask|throwing|novelty)\s+#\d+/i;
const RESOURCE_LIKE_TYPES = new Set([12, 13, 14, 15]);
const MATERIAL_COLLECTIBLE_TYPES = new Set([13, 14]);
const STACK_ITEM_TYPES = new Set([12, 15]);

interface ItemResearchClassificationInput {
  label: string;
  type: number;
  id: number;
  repository?: ItemRepository | "unknown";
  weaponType?: number;
  localizationId?: string;
}

interface ItemResearchIdentityInput {
  repository?: ItemRepository | "unknown";
  type: number;
  id: number;
  weaponType?: number;
  classification?: ItemResearchClassification;
}

export function isItemResearchCandidate(
  item: ItemTimelineEntry,
  catalog: ItemCatalogResolver = activeItemCatalog,
): boolean {
  const label = item.label.trim();
  const hasGenericLabel = isGenericUnknownLabel(label);
  if (!requiresItemIdentification(resolveItemResearchCatalogIdentity(item, catalog))) return false;
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
        localizationId: item.localizationId ?? existing.localizationId,
        rarity: item.rarity || existing.rarity,
        repository: normalizeItemResearchRepository(item.repository),
        weaponType: Math.max(0, Math.trunc(item.weaponType || existing.weaponType || 0)),
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
      localizationId: item.localizationId,
      rarity: item.rarity || "Unknown",
      repository: normalizeItemResearchRepository(item.repository),
      type: item.type,
      id: item.id,
      weaponType: Math.max(0, Math.trunc(item.weaponType || 0)),
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
    if (!stringField(item, "signature").trim()) continue;
    const type = numberField(item, "type");
    const id = numberField(item, "id");
    const repository = normalizeItemResearchRepository(stringField(item, "repository"));
    const weaponType = Math.max(0, numberField(item, "weaponType"));
    const dropQuality = numberField(item, "dropQuality");
    const firstSeenAt = positiveNumberField(item, "firstSeenAt") || Date.now();
    const lastSeenAt = positiveNumberField(item, "lastSeenAt") || firstSeenAt;
    const label = cleanText(stringField(item, "label") || fallbackLabel(type, id), 120);
    const signature = researchSignatureFields({ type, id, repository, weaponType, dropQuality, label });
    if (seen.has(signature)) continue;
    seen.add(signature);
    const localizationId = cleanText(stringField(item, "localizationId"), 160);
    entries.push({
      signature,
      label,
      localizationId: localizationId || undefined,
      rarity: cleanText(stringField(item, "rarity") || "Unknown", 40),
      repository,
      type,
      id,
      weaponType,
      dropQuality,
      classification:
        normalizeItemResearchClassification(stringField(item, "classification")) ??
        classifyItemResearchFields({ label, type, id, repository, weaponType, localizationId: localizationId || undefined }),
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

export function activeItemResearchEntries(
  entries: ItemResearchEntry[],
  catalog: ItemCatalogResolver = activeItemCatalog,
): ItemResearchEntry[] {
  return entries.filter((entry) =>
    !entry.ignored
    && !entry.resolvedName.trim()
    && isPlayerActionableItemResearchEntry(entry, catalog),
  );
}

export function isKnownMissingIconResearchEntry(entry: Pick<ItemResearchEntry, "classification">): boolean {
  return entry.classification === "known-missing-icon";
}

export function isGeneratedNormalItemResearchEntry(
  entry: ItemResearchIdentityInput,
  catalog: ItemCatalogResolver = activeItemCatalog,
): boolean {
  const resolution = resolveItemResearchCatalogIdentity(entry, catalog);
  if (resolution.status === "resolved") return resolution.definition.identityMode === "seeded";
  if (resolution.status === "unclassified") return false;
  return resolution.expectedIdentityMode === "seeded";
}

export function isPlayerActionableItemResearchEntry(
  entry: Pick<ItemResearchEntry, "classification" | "repository" | "type" | "id" | "weaponType">,
  catalog: ItemCatalogResolver = activeItemCatalog,
): boolean {
  return !isKnownMissingIconResearchEntry(entry)
    && requiresItemIdentification(resolveItemResearchCatalogIdentity(entry, catalog));
}

export function resolveItemResearchCatalogIdentity(
  entry: ItemResearchIdentityInput,
  catalog: ItemCatalogResolver = activeItemCatalog,
): ItemCatalogResolution {
  const normalizedRepository = normalizeItemResearchRepository(entry.repository);
  // Version-1 research did not retain repository. Its explicit unknown-normal
  // classification is the only safe migration signal for trying the normal
  // catalog; new unscoped identities remain fail-closed and researchable.
  const repository = normalizedRepository === "unknown" && entry.classification === "unknown-normal"
    ? "normal"
    : normalizedRepository;
  if (repository === "unknown") return { status: "unclassified", key: null, reason: "no-domain" };
  return catalog.resolve({
    repository,
    type: entry.type,
    gameId: entry.id,
    weaponType: entry.type === 3 ? Math.max(0, Math.trunc(entry.weaponType || 0)) : 0,
  });
}

export function createItemResearchExportPayload(entries: ItemResearchEntry[], options: ItemResearchExportOptions = {}) {
  const scope = options.scope ?? "all";
  const exportedEntries = normalizeItemResearchEntries(entries)
    .filter((entry) => !entry.ignored)
    .filter((entry) => itemResearchEntryMatchesExportScope(entry, scope))
    .map((entry) => ({
      signature: entry.signature,
      label: entry.label,
      localizationId: entry.localizationId,
      resolvedName: entry.resolvedName,
      resolvedNameKey: entry.resolvedName ? normalizeItemResearchNameKey(entry.resolvedName) : "",
      rarity: entry.rarity,
      repository: entry.repository,
      type: entry.type,
      id: entry.id,
      weaponType: entry.weaponType,
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
    version: 2,
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
  return researchSignatureFields({
    type: item.type,
    id: item.id,
    repository: normalizeItemResearchRepository(item.repository),
    weaponType: Math.max(0, Math.trunc(item.weaponType || 0)),
    dropQuality: item.dropQuality,
    label: item.label,
  });
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
  const repository = normalizeItemResearchRepository(input.repository);
  const byName = lookupItemTranslationByName(input.label, repository === "unknown" ? undefined : repository);
  if (byName) return byName.name;
  if (repository === "unknown") return "";
  const byId = lookupItemTranslation(input.type, input.id, Math.max(0, Math.trunc(input.weaponType || 0)), repository);
  if (byId) return byId.name;
  return "";
}

function isGeneratedPlaceholderLabel(label: string): boolean {
  return !label || /^unknown item$/i.test(label) || /\bseed\s+\d+/i.test(label);
}

function genericLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function researchSignatureFields(item: {
  type: number;
  id: number;
  repository: ItemRepository | "unknown";
  weaponType: number;
  dropQuality: number;
  label: string;
}): string {
  return `${item.repository}:${item.type}:${item.id}:${item.weaponType}:${item.dropQuality}:${genericLabelKey(item.label)}`;
}

function normalizeItemResearchRepository(value: unknown): ItemRepository | "unknown" {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "normal" || normalized === "unique" || normalized === "runeword" ? normalized : "unknown";
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
