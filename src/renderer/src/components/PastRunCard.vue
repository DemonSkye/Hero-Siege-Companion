<script setup lang="ts">
import { ref } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDateTime, formatDuration, formatNumber, formatTime } from "../lib/format";
import { itemIconUrl, resourceImage } from "../lib/item-assets";
import { addTag, pastRunTitle, removeTag, runTags, sameTags } from "../lib/past-run-search";
import {
  pastRunDropKey,
  runResourceTotal,
  runResourceTypeCount,
  runTrackedItems,
  type PastRunDropFilterGroup,
} from "../lib/past-runs";
import type { PostRunReportConfig, ReportMetricId, ReportResourceDrawerId } from "../lib/report-config";
import RunTagMenu from "./RunTagMenu.vue";

const props = defineProps<{
  run: PastRunSummary;
  reportConfig: PostRunReportConfig;
  activeReportGroups: PastRunDropFilterGroup[];
  expandedDropKey: string | null;
  allRunTags: string[];
  tagMenuOpen: boolean;
}>();

const emit = defineEmits<{
  "update:expandedDropKey": [value: string | null];
  "toggle-tag-menu": [run: PastRunSummary];
  "close-tag-menu": [];
  "update-run-tags": [runId: string, tags: string[]];
}>();

const expandedResourceDrawers = ref<Set<string>>(new Set());

function togglePastRunDropBreakdown(rarity: string) {
  const key = pastRunDropKey(props.run, rarity);
  emit("update:expandedDropKey", props.expandedDropKey === key ? null : key);
}

function isPastRunDropExpanded(rarity: string): boolean {
  return props.expandedDropKey === pastRunDropKey(props.run, rarity);
}

function addTagToRun(tag: string) {
  const nextTags = addTag(props.run, tag);
  if (sameTags(nextTags, runTags(props.run))) return;
  emit("update-run-tags", props.run.id, nextTags);
}

function removeTagFromRun(tag: string) {
  emit("update-run-tags", props.run.id, removeTag(props.run, tag));
}

function runMetricCards() {
  const cards: Record<ReportMetricId, { label: string; value: number; detail: string }> = {
    gold: { label: "Gold", value: props.run.totalGoldGained, detail: `${formatNumber(ratePerHour(props.run.totalGoldGained, props.run.durationMs))}/h` },
    xp: { label: "XP", value: props.run.totalXpGained, detail: `${formatNumber(ratePerHour(props.run.totalXpGained, props.run.durationMs))}/h` },
    kills: { label: "Kills", value: props.run.totalKillsGained ?? 0, detail: `${formatNumber(ratePerHour(props.run.totalKillsGained ?? 0, props.run.durationMs))}/h` },
    keys: { label: "Keys", value: runResourceTotal(props.run.keys), detail: `${runResourceTypeCount(props.run.keys)} types` },
    ores: { label: "Ore", value: runResourceTotal(props.run.ores), detail: `${runResourceTypeCount(props.run.ores)} types` },
    materials: { label: "Materials", value: runResourceTotal(props.run.materials ?? []), detail: `${runResourceTypeCount(props.run.materials)} types` },
    mfDrops: { label: "MF drops", value: runMfDropTotal(), detail: `${runDropTotal()} tracked` },
  };
  return props.reportConfig.summaryMetrics.map((metric) => cards[metric]).filter(Boolean);
}

function resourceDrawers() {
  const drawers: Record<ReportResourceDrawerId, { id: ReportResourceDrawerId; title: string; empty: string; resources: NonNullable<PastRunSummary["materials"]>; imageKind: "key" | "ore" | "material" }> = {
    materials: { id: "materials", title: "Materials", empty: "No materials logged.", resources: props.run.materials ?? [], imageKind: "material" },
    keys: { id: "keys", title: "Non-basic keys", empty: "No non-basic keys logged.", resources: props.run.keys, imageKind: "key" },
    ores: { id: "ores", title: "Ore mined", empty: "No ore logged.", resources: props.run.ores, imageKind: "ore" },
  };
  return props.reportConfig.resourceDrawers.map((drawer) => drawers[drawer]).filter(Boolean);
}

function resourceDrawerKey(drawerId: ReportResourceDrawerId): string {
  return `${props.run.id}:${drawerId}`;
}

function isResourceDrawerExpanded(drawerId: ReportResourceDrawerId): boolean {
  return expandedResourceDrawers.value.has(resourceDrawerKey(drawerId));
}

function toggleResourceDrawer(drawerId: ReportResourceDrawerId, totalResources: number) {
  if (totalResources <= 3) return;
  const key = resourceDrawerKey(drawerId);
  const next = new Set(expandedResourceDrawers.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedResourceDrawers.value = next;
}

function visibleDrawerResources(drawer: ReturnType<typeof resourceDrawers>[number]) {
  return isResourceDrawerExpanded(drawer.id) ? drawer.resources : drawer.resources.slice(0, 3);
}

function runDrops() {
  return runTrackedItems(props.run, props.reportConfig.dropRarities, [], props.activeReportGroups);
}

function runMfDropTotal(): number {
  return runDrops().reduce((total, item) => total + item.mf, 0);
}

function runDropTotal(): number {
  return runDrops().reduce((total, item) => total + item.total, 0);
}

function ratePerHour(value: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.trunc(value / (durationMs / 3_600_000));
}
</script>

<template>
  <section class="past-run-card">
    <div class="past-run-header">
      <div class="past-run-header-main">
        <h3>{{ pastRunTitle(run) }}</h3>
        <span>{{ formatDateTime(run.sessionStartedAt) }} &middot; {{ formatDuration(run.durationMs) }}</span>
        <div v-if="runTags(run).length" class="past-run-tags" aria-label="Run tags">
          <span v-for="tag in runTags(run)" :key="`${run.id}-${tag}`" class="run-tag-chip">
            #{{ tag }}
            <button type="button" :aria-label="`Remove ${tag} tag`" @click="removeTagFromRun(tag)">x</button>
          </span>
        </div>
      </div>
      <div class="past-run-header-actions">
        <div class="past-run-time">{{ formatTime(run.sessionEndedAt) }}</div>
        <button class="tag-selector-button" type="button" :aria-expanded="tagMenuOpen" @click="emit('toggle-tag-menu', run)">
          <span>Tag</span>
          <strong>{{ runTags(run)[0] ?? "Select" }}</strong>
        </button>
      </div>
    </div>

    <RunTagMenu
      v-if="tagMenuOpen"
      :run="run"
      :all-run-tags="allRunTags"
      @add-tag="addTagToRun"
      @close="emit('close-tag-menu')"
    />

    <div class="past-run-metrics dynamic-metrics">
      <div v-for="metric in runMetricCards()" :key="`${run.id}-${metric.label}`">
        <span>{{ metric.label }}</span>
        <strong>{{ formatNumber(metric.value) }}</strong>
        <small>{{ metric.detail }}</small>
      </div>
    </div>

    <div class="past-run-drops">
      <div class="past-run-drop-grid">
        <button
          v-for="item in runDrops()"
          :key="`${run.id}-${item.rarity}`"
          type="button"
          :class="['item-counter', item.rarity.toLowerCase(), { expanded: isPastRunDropExpanded(item.rarity) }]"
          @click="togglePastRunDropBreakdown(item.rarity)"
        >
          <span>{{ item.rarity }}</span>
          <strong>{{ formatNumber(item.total) }}</strong>
          <small>{{ formatNumber(item.mf) }} MF &middot; {{ item.drops.length }} unique</small>
        </button>
      </div>
      <template v-for="item in runDrops()" :key="`${run.id}-${item.rarity}-details`">
        <div v-if="isPastRunDropExpanded(item.rarity)" class="drop-breakdown past-run-drop-breakdown" :class="item.rarity.toLowerCase()">
          <div class="drop-breakdown-head">
            <strong>{{ item.rarity }} drops</strong>
            <span>{{ item.drops.length }} unique</span>
          </div>
          <div v-if="item.drops.length" class="drop-breakdown-list">
            <div v-for="drop in item.drops" :key="`${run.id}-${item.rarity}-${drop.name}`" class="drop-breakdown-row">
              <img v-if="itemIconUrl(drop.name)" class="drop-breakdown-icon" :src="itemIconUrl(drop.name)" :alt="drop.name" />
              <span v-else class="drop-breakdown-icon drop-breakdown-icon-empty" aria-hidden="true"></span>
              <span class="drop-breakdown-name">{{ drop.name }}</span>
              <strong>{{ formatNumber(drop.total) }}</strong>
            </div>
          </div>
          <p v-else class="empty-copy">No saved {{ item.rarity.toLowerCase() }} item detail for this run.</p>
        </div>
      </template>
    </div>

    <div class="resource-columns">
      <div v-for="drawer in resourceDrawers()" :key="`${run.id}-${drawer.id}`" class="resource-column">
        <button
          class="resource-column-toggle"
          type="button"
          :disabled="drawer.resources.length <= 3"
          :aria-expanded="isResourceDrawerExpanded(drawer.id)"
          @click="toggleResourceDrawer(drawer.id, drawer.resources.length)"
        >
          <h4>{{ drawer.title }}</h4>
          <span v-if="drawer.resources.length > 3">
            {{ isResourceDrawerExpanded(drawer.id) ? "Show less" : `+${drawer.resources.length - 3} more` }}
          </span>
        </button>
        <div v-if="drawer.resources.length" :class="['resource-list', { expanded: isResourceDrawerExpanded(drawer.id) }]">
          <div
            v-for="resource in visibleDrawerResources(drawer)"
            :key="`${run.id}-${drawer.id}-${resource.name}`"
            class="resource-chip"
            :class="{ 'resource-chip-no-image': !resourceImage(resource, drawer.imageKind) }"
          >
            <img v-if="resourceImage(resource, drawer.imageKind)" :src="resourceImage(resource, drawer.imageKind)" :alt="resource.name" />
            <span>{{ resource.name }}</span>
            <strong>{{ formatNumber(resource.total) }}</strong>
          </div>
        </div>
        <p v-else class="empty-copy">{{ drawer.empty }}</p>
      </div>
    </div>
  </section>
</template>
