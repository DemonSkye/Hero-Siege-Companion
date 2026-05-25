import { MAX_PAST_RUN_TAGS, normalizePastRunTags, type PastRunSummary } from "../../../shared/stats";
import { formatDateTime, formatDuration, formatTime } from "./format";

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
  return runs.filter((run) => {
    const haystack = runSearchText(run);
    return terms.every((term) => haystack.includes(term));
  });
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

function runSearchText(run: PastRunSummary): string {
  const chunks = [
    pastRunTitle(run),
    formatDateTime(run.sessionStartedAt),
    formatTime(run.sessionEndedAt),
    `${formatDuration(run.durationMs)} duration`,
    `${run.totalGoldGained} gold`,
    `${run.totalXpGained} xp`,
    `${run.totalKillsGained ?? 0} kills`,
    ...runTags(run).flatMap((tag) => [tag, `#${tag}`]),
  ];

  for (const [rarity, breakdown] of Object.entries(run.itemBreakdown ?? {})) {
    chunks.push(rarity);
    for (const drop of Object.values(breakdown)) {
      chunks.push(drop.name, `${drop.total} ${drop.name}`, drop.mf > 0 ? `${drop.name} mf` : "");
    }
  }
  for (const resource of [...run.keys, ...run.ores, ...(run.materials ?? [])]) {
    chunks.push(resource.name, `${resource.total} ${resource.name}`);
  }

  return normalizeSearchValue(chunks.filter(Boolean).join(" "));
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
