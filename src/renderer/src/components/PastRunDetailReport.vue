<script setup lang="ts">
import { computed } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDateTime, formatDuration, formatNumber, formatTime } from "../lib/format";
import { itemIconUrl, resourceImage } from "../lib/item-assets";
import { pastRunSearchMatches, pastRunTitle, runTags, searchTerms } from "../lib/past-run-search";
import { hasReportItemDetailEntries, runReportItemRows, type PastRunReportItemRow } from "../lib/past-runs";
import type { ItemFilterGroup } from "../lib/item-filters";
import type { PostRunReportConfig } from "../lib/report-config";

const props = defineProps<{
  run: PastRunSummary;
  reportConfig: PostRunReportConfig;
  itemFilterGroups: ItemFilterGroup[];
  searchQuery: string;
}>();

const reportRows = computed(() => runReportItemRows(props.run, props.reportConfig, props.itemFilterGroups));
const searchMatches = computed(() => pastRunSearchMatches(props.run, searchTerms(props.searchQuery)));
const matchedSearchIds = computed(() => new Set(searchMatches.value.map((match) => match.id)));

const standardSearchRows = computed(() => {
  const configuredIds = new Set(reportRows.value.map((row) => row.id));
  const searchIds = Array.from(new Set(searchMatches.value
    .filter((match) => match.kind === "stat" || match.resourceKind || match.id.startsWith("drop-rarity:"))
    .map((match) => match.reportItemId)
    .filter((id): id is string => Boolean(id))))
    .filter((id) => !configuredIds.has(id));
  return reportRowsForSearch(searchIds);
});

const matchedDropRows = computed(() => {
  const alreadyVisible = visibleDropNames([...reportRows.value, ...standardSearchRows.value]);
  const groups = new Map<string, Set<string>>();
  for (const match of searchMatches.value) {
    if (!match.itemName || !match.rarity || alreadyVisible.has(normalizeMatchValue(match.itemName))) continue;
    const names = groups.get(match.rarity) ?? new Set<string>();
    names.add(match.itemName);
    groups.set(match.rarity, names);
  }
  if (!groups.size) return [];

  const itemGroups = Array.from(groups.entries()).map(([rarity, names], index) => ({
    id: `search-match-${index}`,
    name: rarity,
    enabled: true,
    rarities: [rarity],
    types: [],
    items: Array.from(names),
  }));
  return runReportItemRows(
    props.run,
    {
      ...props.reportConfig,
      summaryItems: itemGroups.map((group) => `group:${group.id}`),
      itemGroups,
    },
    props.itemFilterGroups,
  );
});

const searchOnlyRowIds = computed(() => new Set(
  [...standardSearchRows.value, ...matchedDropRows.value].map((row) => row.id),
));
const visibleReportRows = computed(() => [...reportRows.value, ...standardSearchRows.value, ...matchedDropRows.value]);
const detailRows = computed(() => visibleReportRows.value.filter((row) => hasReportItemDetailEntries(row.detailPanel)));

function reportRowsForSearch(summaryItems: string[]): PastRunReportItemRow[] {
  if (!summaryItems.length) return [];
  return runReportItemRows(props.run, { ...props.reportConfig, summaryItems }, props.itemFilterGroups);
}

function visibleDropNames(rows: PastRunReportItemRow[]): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.detailPanel?.kind !== "drops") continue;
    for (const drop of row.detailPanel.drops.slice(0, props.reportConfig.topDropLimit)) {
      names.add(normalizeMatchValue(drop.name));
    }
  }
  return names;
}

function hasSearchMatch(id: string): boolean {
  return matchedSearchIds.value.has(id);
}

function isTagSearchMatch(tag: string): boolean {
  const tagLabel = `#${normalizeMatchValue(tag)}`;
  return searchMatches.value.some((match) => match.kind === "tag" && normalizeMatchValue(match.label) === tagLabel);
}

function isDropSearchMatch(name: string, row: PastRunReportItemRow): boolean {
  const normalizedName = normalizeMatchValue(name);
  return searchMatches.value.some((match) => (
    (match.itemName && normalizeMatchValue(match.itemName) === normalizedName)
    || (!match.itemName && match.reportItemId === row.id)
  ));
}

function isResourceSearchMatch(name: string): boolean {
  const normalizedName = normalizeMatchValue(name);
  return searchMatches.value.some((match) => match.resourceName && normalizeMatchValue(match.resourceName) === normalizedName);
}

function isReportRowSearchMatch(row: PastRunReportItemRow): boolean {
  if (searchOnlyRowIds.value.has(row.id)) return true;
  if (searchMatches.value.some((match) => match.reportItemId === row.id)) return true;
  if (row.detailPanel?.kind === "drops") return row.detailPanel.drops.some((drop) => isDropSearchMatch(drop.name, row));
  if (row.detailPanel?.kind === "resources") return row.detailPanel.resources.some((resource) => isResourceSearchMatch(resource.name));
  return false;
}

function visibleDrops(row: PastRunReportItemRow) {
  if (row.detailPanel?.kind !== "drops") return [];
  return searchOnlyRowIds.value.has(row.id)
    ? row.detailPanel.drops
    : row.detailPanel.drops.slice(0, props.reportConfig.topDropLimit);
}

function normalizeMatchValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
</script>

<template>
  <section class="past-run-single-report">
    <header class="past-run-report-header">
      <div>
        <p class="eyebrow">Run report</p>
        <h2 tabindex="-1" data-past-run-report-heading :class="{ 'is-search-match': hasSearchMatch('character') }">
          {{ pastRunTitle(run) }}<span v-if="hasSearchMatch('character')" class="sr-only"> Matches search.</span>
        </h2>
        <span class="past-run-report-meta">
          <span :class="{ 'is-search-match': hasSearchMatch('started-at') }">
            {{ formatDateTime(run.sessionStartedAt) }}<span v-if="hasSearchMatch('started-at')" class="sr-only"> Matches search.</span>
          </span>
          <span aria-hidden="true">&middot;</span>
          <span :class="{ 'is-search-match': hasSearchMatch('duration') }">
            {{ formatDuration(run.durationMs) }}<span v-if="hasSearchMatch('duration')" class="sr-only"> Matches search.</span>
          </span>
          <span v-if="hasSearchMatch('ended-at')" class="is-search-match">
            &middot; Ended {{ formatTime(run.sessionEndedAt) }}<span class="sr-only"> Matches search.</span>
          </span>
        </span>
      </div>
      <div v-if="runTags(run).length" class="past-run-report-tags" aria-label="Run tags">
        <span v-for="tag in runTags(run)" :key="`${run.id}-report-${tag}`" class="run-tag-chip" :class="{ 'is-search-match': isTagSearchMatch(tag) }">
          #{{ tag }}<span v-if="isTagSearchMatch(tag)" class="sr-only"> Matches search.</span>
        </span>
      </div>
    </header>

    <p v-if="searchMatches.length" class="past-run-search-results-label">Search results for <strong>&ldquo;{{ searchQuery.trim() }}&rdquo;</strong></p>

    <div v-if="visibleReportRows.length" class="past-run-metrics dynamic-metrics" aria-label="Run report summary">
      <div
        v-for="row in visibleReportRows"
        :key="`${run.id}-${row.id}`"
        :data-report-item-id="row.id"
        :class="{ 'is-search-match': isReportRowSearchMatch(row) }"
      >
        <span>{{ row.label }}</span>
        <strong>{{ formatNumber(row.value) }}</strong>
        <small>{{ row.detail }}</small>
        <span v-if="isReportRowSearchMatch(row)" class="sr-only">Matches search.</span>
      </div>
    </div>

    <div v-if="detailRows.length" class="past-run-details">
      <section
        v-for="row in detailRows"
        :key="`${run.id}-${row.id}-details`"
        class="past-run-detail-panel"
        :class="{ 'is-search-match': isReportRowSearchMatch(row) }"
        :data-report-detail-id="row.id"
      >
        <div class="drop-breakdown-head">
          <strong>{{ row.label }}<span v-if="isReportRowSearchMatch(row)" class="sr-only"> Matches search.</span></strong>
          <span>{{ row.detail }}</span>
        </div>
        <div v-if="row.detailPanel?.kind === 'drops'">
          <div v-if="row.detailPanel.drops.length" class="drop-breakdown-list">
            <div
              v-for="drop in visibleDrops(row)"
              :key="`${run.id}-${row.id}-${drop.name}`"
              class="drop-breakdown-row"
              :class="{ 'is-search-match': isDropSearchMatch(drop.name, row) }"
            >
              <img v-if="itemIconUrl(drop.name)" class="drop-breakdown-icon" :src="itemIconUrl(drop.name)" :alt="drop.name" />
              <span v-else class="drop-breakdown-icon drop-breakdown-icon-empty" aria-hidden="true"></span>
              <span class="drop-breakdown-name">
                {{ drop.name }}<span v-if="isDropSearchMatch(drop.name, row)" class="sr-only"> Matches search.</span>
              </span>
              <strong>{{ formatNumber(drop.total) }}</strong>
            </div>
          </div>
          <p v-else class="empty-copy">{{ row.detailPanel.empty }}</p>
        </div>
        <div v-else-if="row.detailPanel?.kind === 'resources'">
          <div v-if="row.detailPanel.resources.length" class="resource-list expanded">
            <div
              v-for="resource in row.detailPanel.resources"
              :key="`${run.id}-${row.id}-${resource.name}`"
              class="resource-chip"
              :class="{
                'resource-chip-no-image': !resourceImage(resource, row.detailPanel.imageKind),
                'is-search-match': isResourceSearchMatch(resource.name),
              }"
            >
              <img v-if="resourceImage(resource, row.detailPanel.imageKind)" :src="resourceImage(resource, row.detailPanel.imageKind)" :alt="resource.name" />
              <span>{{ resource.name }}<span v-if="isResourceSearchMatch(resource.name)" class="sr-only"> Matches search.</span></span>
              <strong>{{ formatNumber(resource.total) }}</strong>
            </div>
          </div>
          <p v-else class="empty-copy">{{ row.detailPanel.empty }}</p>
        </div>
      </section>
    </div>
    <p v-else-if="visibleReportRows.length" class="empty-copy past-run-report-empty-detail">No detailed report sections contain saved data for this run.</p>
    <p v-else class="empty-copy past-run-report-empty-detail">No report items are selected. Configure the report to choose what appears here.</p>
  </section>
</template>
