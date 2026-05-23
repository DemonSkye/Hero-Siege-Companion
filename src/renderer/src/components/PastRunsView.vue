<script setup lang="ts">
import { computed } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDateTime, formatDuration, formatNumber, formatTime } from "../lib/format";
import { itemIconUrl, resourceImage } from "../lib/item-assets";
import { aggregatePastRuns, pastRunDropKey, runResourceTotal, runTrackedItems } from "../lib/past-runs";

const props = defineProps<{
  pastRuns: PastRunSummary[];
  expandedDropKey: string | null;
}>();

const emit = defineEmits<{
  "update:expandedDropKey": [value: string | null];
}>();

const allRunAggregate = computed(() => aggregatePastRuns(props.pastRuns));
const recentRunAggregate = computed(() => aggregatePastRuns(props.pastRuns.slice(0, 10)));
const aggregatePanels = computed(() => [
  { key: "all", title: "All Runs", subtitle: `${allRunAggregate.value.runCount} saved`, aggregate: allRunAggregate.value },
  { key: "recent", title: "Last 10 Runs", subtitle: `${recentRunAggregate.value.runCount} included`, aggregate: recentRunAggregate.value },
]);

function togglePastRunDropBreakdown(run: PastRunSummary, rarity: string) {
  const key = pastRunDropKey(run, rarity);
  emit("update:expandedDropKey", props.expandedDropKey === key ? null : key);
}

function isPastRunDropExpanded(run: PastRunSummary, rarity: string): boolean {
  return props.expandedDropKey === pastRunDropKey(run, rarity);
}

function runTitle(run: PastRunSummary): string {
  return run.accountName || "Hero Siege Run";
}
</script>

<template>
  <section class="past-runs-view">
    <article class="panel past-runs-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">History</p>
          <h2>Past Runs</h2>
        </div>
        <span class="past-run-count">{{ pastRuns.length }}/100 saved</span>
      </div>

      <div v-if="pastRuns.length" class="past-run-aggregate-grid">
        <section v-for="panel in aggregatePanels" :key="panel.key" class="past-run-aggregate">
          <div class="aggregate-heading">
            <div>
              <h3>{{ panel.title }}</h3>
              <span>{{ panel.subtitle }} &middot; Avg {{ formatDuration(panel.aggregate.averageDurationMs) }}</span>
            </div>
            <strong>{{ formatDuration(panel.aggregate.totalDurationMs) }}</strong>
          </div>
          <div class="aggregate-metrics">
            <div>
              <span>Gold/h</span>
              <strong>{{ formatNumber(panel.aggregate.goldPerHour) }}</strong>
              <small>Best {{ formatNumber(panel.aggregate.bestGoldPerHour) }}</small>
            </div>
            <div>
              <span>XP/h</span>
              <strong>{{ formatNumber(panel.aggregate.xpPerHour) }}</strong>
              <small>Best {{ formatNumber(panel.aggregate.bestXpPerHour) }}</small>
            </div>
            <div>
              <span>Keys</span>
              <strong>{{ formatNumber(panel.aggregate.totalKeys) }}</strong>
              <small>{{ formatNumber(panel.aggregate.totalOres) }} ore</small>
            </div>
            <div>
              <span>MF drops</span>
              <strong>{{ formatNumber(panel.aggregate.totalMfDrops) }}</strong>
              <small>{{ formatNumber(panel.aggregate.totalGold) }} gold</small>
            </div>
          </div>
          <div class="aggregate-drop-grid">
            <div v-for="drop in panel.aggregate.drops" :key="`${panel.key}-${drop.rarity}`" :class="['aggregate-drop', drop.rarity.toLowerCase()]">
              <span>{{ drop.rarity }}</span>
              <strong>{{ formatNumber(drop.total) }}</strong>
              <small>{{ formatNumber(drop.mf) }} MF &middot; {{ formatNumber(drop.unique) }} unique</small>
            </div>
          </div>
          <div class="aggregate-top-drops">
            <span>Top drops</span>
            <div v-if="panel.aggregate.topDrops.length" class="aggregate-top-list">
              <div v-for="drop in panel.aggregate.topDrops" :key="`${panel.key}-${drop.name}`">
                <span>{{ drop.name }}</span>
                <strong>{{ formatNumber(drop.total) }}</strong>
              </div>
            </div>
            <small v-else>No tracked drops yet.</small>
          </div>
        </section>
      </div>

      <div v-if="pastRuns.length" class="past-runs-list">
        <section v-for="run in pastRuns" :key="run.id" class="past-run-card">
          <div class="past-run-header">
            <div>
              <h3>{{ runTitle(run) }}</h3>
              <span>{{ formatDateTime(run.sessionStartedAt) }} &middot; {{ formatDuration(run.durationMs) }}</span>
            </div>
            <div class="past-run-time">{{ formatTime(run.sessionEndedAt) }}</div>
          </div>

          <div class="past-run-metrics">
            <div>
              <span>Gold</span>
              <strong>{{ formatNumber(run.totalGoldGained) }}</strong>
            </div>
            <div>
              <span>XP</span>
              <strong>{{ formatNumber(run.totalXpGained) }}</strong>
            </div>
            <div>
              <span>Keys</span>
              <strong>{{ formatNumber(runResourceTotal(run.keys)) }}</strong>
            </div>
            <div>
              <span>Ore</span>
              <strong>{{ formatNumber(runResourceTotal(run.ores)) }}</strong>
            </div>
          </div>

          <div class="past-run-drops">
            <div class="past-run-drop-grid">
              <button
                v-for="item in runTrackedItems(run)"
                :key="`${run.id}-${item.rarity}`"
                type="button"
                :class="['item-counter', item.rarity.toLowerCase(), { expanded: isPastRunDropExpanded(run, item.rarity) }]"
                @click="togglePastRunDropBreakdown(run, item.rarity)"
              >
                <span>{{ item.rarity }}</span>
                <strong>{{ formatNumber(item.total) }}</strong>
                <small>{{ formatNumber(item.mf) }} MF &middot; {{ item.drops.length }} unique</small>
              </button>
            </div>
            <template v-for="item in runTrackedItems(run)" :key="`${run.id}-${item.rarity}-details`">
              <div v-if="isPastRunDropExpanded(run, item.rarity)" class="drop-breakdown past-run-drop-breakdown" :class="item.rarity.toLowerCase()">
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
            <div class="resource-column">
              <h4>Non-basic keys</h4>
              <div v-if="run.keys.length" class="resource-list">
                <div
                  v-for="key in run.keys"
                  :key="`${run.id}-${key.name}`"
                  class="resource-chip"
                  :class="{ 'resource-chip-no-image': !resourceImage(key, 'key') }"
                >
                  <img v-if="resourceImage(key, 'key')" :src="resourceImage(key, 'key')" :alt="key.name" />
                  <span>{{ key.name }}</span>
                  <strong>{{ formatNumber(key.total) }}</strong>
                </div>
              </div>
              <p v-else class="empty-copy">No non-basic keys logged.</p>
            </div>

            <div class="resource-column">
              <h4>Ore mined</h4>
              <div v-if="run.ores.length" class="resource-list">
                <div
                  v-for="ore in run.ores"
                  :key="`${run.id}-${ore.name}`"
                  class="resource-chip"
                  :class="{ 'resource-chip-no-image': !resourceImage(ore, 'ore') }"
                >
                  <img v-if="resourceImage(ore, 'ore')" :src="resourceImage(ore, 'ore')" :alt="ore.name" />
                  <span>{{ ore.name }}</span>
                  <strong>{{ formatNumber(ore.total) }}</strong>
                </div>
              </div>
              <p v-else class="empty-copy">No ore logged.</p>
            </div>
          </div>
        </section>
      </div>
      <p v-else class="empty-copy">Click End Run to save the current session here. Closing the app also saves the run, and it will appear on the next launch.</p>
    </article>
  </section>
</template>
