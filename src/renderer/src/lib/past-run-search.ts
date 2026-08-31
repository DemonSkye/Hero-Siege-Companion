import {
  MAX_PAST_RUN_TAGS,
  canonicalPastRunTrackerName,
  normalizePastRunTags,
  pastRunItemNameKey,
  pastRunOreTrackerName,
  type PastRunSummary,
} from "../../../shared/stats";
import { formatDateTime, formatDuration, formatNumber, formatTime } from "./format";
import { exactTrackedItemRowId } from "./past-runs";

export type PastRunSearchMatchKind = "character" | "date" | "duration" | "stat" | "tag" | "drop" | "key" | "ore" | "material";

export interface PastRunSearchMatch {
  id: string;
  kind: PastRunSearchMatchKind;
  label: string;
  detail: string;
  matchedTerms: string[];
  reportItemId?: string;
  rarity?: string;
  itemName?: string;
  resourceKind?: "key" | "ore" | "material";
  resourceName?: string;
}

interface PastRunSearchCandidate extends Omit<PastRunSearchMatch, "matchedTerms"> {
  searchText: string;
}

interface RepresentedPastRunItem {
  total: number;
  mf: number;
  candidateIds: string[];
}

export function pastRunTitle(run: PastRunSummary): string {
  return run.accountName || "Hero Siege Run";
}

export function runTags(run: PastRunSummary): string[] {
  return normalizePastRunTags(run.tags);
}

export function searchTerms(query: string): string[] {
  return normalizeSearchValue(query).split(" ").filter(Boolean);
}

export function filterPastRunsBySearch(runs: PastRunSummary[], terms: string[]): PastRunSummary[] {
  if (!terms.length) return runs;
  const normalizedTerms = normalizeSearchTerms(terms);
  return runs.filter((run) => runMatchesSearchTerms(runSearchCandidates(run), normalizedTerms));
}

export function pastRunSearchMatches(run: PastRunSummary, terms: string[]): PastRunSearchMatch[] {
  const normalizedTerms = normalizeSearchTerms(terms);
  if (!normalizedTerms.length) return [];

  const candidates = runSearchCandidates(run);
  if (!runMatchesSearchTerms(candidates, normalizedTerms)) return [];

  return candidates
    .map(({ searchText, ...candidate }) => ({
      ...candidate,
      matchedTerms: normalizedTerms.filter((term) => normalizeSearchValue(searchText).includes(term)),
    }))
    .filter((match) => match.matchedTerms.length > 0)
    .sort((left, right) => right.matchedTerms.length - left.matchedTerms.length);
}

export function uniquePastRunTags(runs: PastRunSummary[]): string[] {
  const byKey = new Map<string, string>();
  for (const run of runs) {
    for (const rawTag of runTags(run)) {
      const tag = normalizePastRunTags([rawTag])[0];
      if (tag) byKey.set(normalizeSearchValue(tag), tag);
    }
  }
  return Array.from(byKey.values()).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function appendSearchTag(query: string, tag: string): string {
  const normalizedTag = normalizePastRunTags([tag])[0];
  if (!normalizedTag) return query;
  const current = query.trim();
  if (containsSearchPhrase(searchTerms(current), searchTerms(normalizedTag))) return query;
  return current ? `${current} ${normalizedTag}` : normalizedTag;
}

export function availableTagOptions(allTags: string[], run: PastRunSummary, query: string): string[] {
  const normalizedQuery = normalizeSearchValue(query);
  const selected = new Set(runTags(run).map(normalizeSearchValue));
  return allTags
    .filter((tag) => !selected.has(normalizeSearchValue(tag)))
    .filter((tag) => !normalizedQuery || normalizeSearchValue(tag).includes(normalizedQuery))
    .slice(0, 40);
}

export function canCreateTag(run: PastRunSummary, draft: string): boolean {
  const normalizedTag = pendingTag(draft);
  if (!normalizedTag || runTags(run).length >= MAX_PAST_RUN_TAGS) return false;
  return !runTags(run).some((tag) => normalizeSearchValue(tag) === normalizeSearchValue(normalizedTag));
}

export function pendingTag(draft: string): string {
  return normalizePastRunTags([draft])[0] ?? "";
}

export function addTag(run: PastRunSummary, tag: string): string[] {
  return normalizePastRunTags([...runTags(run), tag]);
}

export function removeTag(run: PastRunSummary, tag: string): string[] {
  const removed = normalizeSearchValue(tag);
  return runTags(run).filter((candidate) => normalizeSearchValue(candidate) !== removed);
}

export function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function runSearchCandidates(run: PastRunSummary): PastRunSearchCandidate[] {
  const title = pastRunTitle(run);
  const startedAt = formatDateTime(run.sessionStartedAt);
  const endedAt = formatTime(run.sessionEndedAt);
  const duration = formatDuration(run.durationMs);
  const candidates: PastRunSearchCandidate[] = [
    { id: "character", kind: "character", label: title, detail: "Saved character", searchText: title },
    { id: "started-at", kind: "date", label: "Run date", detail: startedAt, searchText: startedAt },
    { id: "ended-at", kind: "date", label: "End time", detail: endedAt, searchText: endedAt },
    { id: "duration", kind: "duration", label: "Duration", detail: duration, searchText: `${duration} duration` },
    { id: "gold", kind: "stat", label: "Gold", detail: `${formatNumber(run.totalGoldGained)} total`, searchText: `${run.totalGoldGained} gold`, reportItemId: "metric:gold" },
    { id: "xp", kind: "stat", label: "XP", detail: `${formatNumber(run.totalXpGained)} total`, searchText: `${run.totalXpGained} xp`, reportItemId: "metric:xp" },
    { id: "kills", kind: "stat", label: "Kills", detail: `${formatNumber(run.totalKillsGained ?? 0)} total`, searchText: `${run.totalKillsGained ?? 0} kills`, reportItemId: "metric:kills" },
    ...runTags(run).map((tag, index) => ({
      id: `tag:${index}:${normalizeSearchValue(tag)}`,
      kind: "tag" as const,
      label: `#${tag}`,
      detail: "Saved run tag",
      searchText: `${tag} #${tag}`,
    })),
  ];
  const representedItems = new Map<string, RepresentedPastRunItem>();

  for (const [rarity, breakdown] of Object.entries(run.itemBreakdown ?? {})) {
    const drops = Object.values(breakdown);
    const breakdownTotal = drops.reduce((total, drop) => total + drop.total, 0);
    const rarityTotal = Math.max(breakdownTotal, explicitRarityTotal(run, rarity));
    if (rarityTotal > 0) {
      candidates.push({
        id: `drop-rarity:${normalizeSearchValue(rarity)}`,
        kind: "drop",
        label: `${rarity} drops`,
        detail: `${formatNumber(rarityTotal)} tracked`,
        searchText: rarity,
        reportItemId: `rarity:${rarity}`,
        rarity,
      });
    }
    for (const [index, drop] of drops.entries()) {
      const id = `drop:${normalizeSearchValue(rarity)}:${index}:${normalizeSearchValue(drop.name)}`;
      recordRepresentedItem(representedItems, drop.name, drop.total, drop.mf, id);
      candidates.push({
        id,
        kind: "drop",
        label: drop.name,
        detail: `${rarity} · ${formatNumber(drop.total)} ${drop.total === 1 ? "drop" : "drops"}${drop.mf > 0 ? ` · ${formatNumber(drop.mf)} MF flagged` : ""}`,
        searchText: [drop.name, `${drop.total} ${drop.name}`, drop.mf > 0 ? `${drop.name} mf` : ""].filter(Boolean).join(" "),
        rarity,
        itemName: drop.name,
      });
    }
  }

  appendResourceCandidates(candidates, "key", run.keys, representedItems);
  appendResourceCandidates(candidates, "ore", run.ores, representedItems);
  appendResourceCandidates(candidates, "material", run.materials ?? [], representedItems);

  const authoritativeItems = new Map<string, { name: string; total: number; mf: number; index: number }>();
  for (const [index, item] of (run.itemTotals ?? []).entries()) {
    const name = canonicalPastRunTrackerName(item.name);
    const key = pastRunItemNameKey(name);
    if (!key || item.total <= 0) continue;
    const existing = authoritativeItems.get(key);
    if (existing) {
      existing.total += Math.max(item.total, 0);
      existing.mf += Math.max(Math.min(item.mf, item.total), 0);
    } else {
      authoritativeItems.set(key, {
        name,
        total: Math.max(item.total, 0),
        mf: Math.max(Math.min(item.mf, item.total), 0),
        index,
      });
    }
  }
  for (const [key, item] of authoritativeItems) {
    const represented = representedItems.get(key);
    if (represented && represented.total === item.total && represented.mf === item.mf) continue;
    if (represented) {
      const replacedIds = new Set(represented.candidateIds);
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        if (replacedIds.has(candidates[index].id)) candidates.splice(index, 1);
      }
    }
    candidates.push({
      id: `item-total:${item.index}:${key}`,
      kind: "drop",
      label: item.name,
      detail: `${formatNumber(item.total)} saved ${item.total === 1 ? "drop" : "drops"}${item.mf > 0 ? ` · ${formatNumber(item.mf)} MF flagged` : ""}`,
      searchText: [item.name, `${item.total} ${item.name}`, item.mf > 0 ? `${item.name} mf` : ""].filter(Boolean).join(" "),
      reportItemId: exactTrackedItemRowId(item.name),
      itemName: item.name,
    });
  }
  return candidates;
}

function explicitRarityTotal(run: PastRunSummary, rarity: string): number {
  switch (normalizeSearchValue(rarity)) {
    case "set": return run.setDrops;
    case "satanic": return run.satanicDrops;
    case "heroic": return run.heroicDrops;
    case "angelic": return run.angelicDrops;
    default: return 0;
  }
}

function appendResourceCandidates(
  candidates: PastRunSearchCandidate[],
  kind: "key" | "ore" | "material",
  resources: PastRunSummary["keys"],
  representedItems: Map<string, RepresentedPastRunItem>,
) {
  for (const [index, resource] of resources.entries()) {
    const id = `${kind}:${index}:${normalizeSearchValue(resource.name)}`;
    const itemName = kind === "ore" ? pastRunOreTrackerName(resource.name, resource.id) : resource.name;
    recordRepresentedItem(representedItems, itemName, resource.total, 0, id);
    const metric = kind === "key" ? "keys" : kind === "ore" ? "ores" : "materials";
    candidates.push({
      id,
      kind,
      label: itemName,
      detail: `${formatNumber(resource.total)} collected`,
      searchText: `${itemName} ${resource.total} ${resource.name}`,
      reportItemId: `metric:${metric}`,
      resourceKind: kind,
      resourceName: resource.name,
    });
  }
}

function recordRepresentedItem(
  representedItems: Map<string, RepresentedPastRunItem>,
  name: string,
  total: number,
  mf: number,
  candidateId: string,
): void {
  const key = pastRunItemNameKey(canonicalPastRunTrackerName(name));
  if (!key) return;
  const represented = representedItems.get(key);
  if (represented) {
    represented.total += Math.max(total, 0);
    represented.mf += Math.max(Math.min(mf, total), 0);
    represented.candidateIds.push(candidateId);
    return;
  }
  representedItems.set(key, {
    total: Math.max(total, 0),
    mf: Math.max(Math.min(mf, total), 0),
    candidateIds: [candidateId],
  });
}

function runMatchesSearchTerms(candidates: PastRunSearchCandidate[], terms: string[]): boolean {
  const haystack = normalizeSearchValue(candidates.map((candidate) => candidate.searchText).join(" "));
  return terms.every((term) => haystack.includes(term));
}

function normalizeSearchTerms(terms: string[]): string[] {
  return terms.map(normalizeSearchValue).filter(Boolean);
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsSearchPhrase(terms: string[], phrase: string[]): boolean {
  if (!phrase.length) return false;
  for (let index = 0; index <= terms.length - phrase.length; index += 1) {
    if (phrase.every((term, offset) => terms[index + offset] === term)) return true;
  }
  return false;
}
