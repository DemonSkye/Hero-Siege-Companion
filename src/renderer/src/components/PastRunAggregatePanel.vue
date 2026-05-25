<script setup lang="ts">
import { formatDuration, formatNumber } from "../lib/format";
import type { PastRunAggregate } from "../lib/past-runs";
import type { ReportMetricId } from "../lib/report-config";

const props = defineProps<{
  panelKey: string;
  title: string;
  subtitle: string;
  aggregate: PastRunAggregate;
  summaryMetrics: ReportMetricId[];
}>();

function aggregateMetricCards(aggregate: PastRunAggregate) {
  const cards: Record<ReportMetricId, { label: string; value: number; detail: string }> = {
    gold: { label: "Gold/h", value: aggregate.goldPerHour, detail: `Best per hour ${formatNumber(aggregate.bestGoldPerHour)}` },
    xp: { label: "XP/h", value: aggregate.xpPerHour, detail: `Best per hour ${formatNumber(aggregate.bestXpPerHour)}` },
    kills: { label: "Kills/h", value: aggregate.killsPerHour, detail: `Best per hour ${formatNumber(aggregate.bestKillsPerHour)}` },
    keys: { label: "Keys", value: aggregate.totalKeys, detail: `Average per run ${formatNumber(averagePerRun(aggregate.totalKeys, aggregate.runCount))}` },
    ores: { label: "Ore", value: aggregate.totalOres, detail: `Average per run ${formatNumber(averagePerRun(aggregate.totalOres, aggregate.runCount))}` },
    materials: { label: "Materials", value: aggregate.totalMaterials, detail: `Average per run ${formatNumber(averagePerRun(aggregate.totalMaterials, aggregate.runCount))}` },
    mfDrops: { label: "MF drops", value: aggregate.totalMfDrops, detail: `Total gold ${formatNumber(aggregate.totalGold)}` },
  };
  return props.summaryMetrics.map((metric) => cards[metric]).filter(Boolean);
}

function averagePerRun(value: number, runCount: number): number {
  return runCount ? Math.trunc(value / runCount) : 0;
}
</script>

<template>
  <section class="past-run-aggregate">
    <div class="aggregate-heading">
      <div>
        <h3>{{ title }}</h3>
        <span>{{ subtitle }} &middot; Average duration {{ formatDuration(aggregate.averageDurationMs) }}</span>
      </div>
      <div class="aggregate-duration-total">
        <span>Total duration</span>
        <strong>{{ formatDuration(aggregate.totalDurationMs) }}</strong>
      </div>
    </div>
    <div class="aggregate-metrics dynamic-metrics">
      <div v-for="metric in aggregateMetricCards(aggregate)" :key="`${panelKey}-${metric.label}`">
        <span>{{ metric.label }}</span>
        <strong>{{ formatNumber(metric.value) }}</strong>
        <small>{{ metric.detail }}</small>
      </div>
    </div>
    <div class="aggregate-drop-grid">
      <div v-for="drop in aggregate.drops" :key="`${panelKey}-${drop.rarity}`" :class="['aggregate-drop', drop.rarity.toLowerCase()]">
        <span>{{ drop.rarity }}</span>
        <strong>{{ formatNumber(drop.total) }}</strong>
        <small>{{ formatNumber(drop.mf) }} MF &middot; {{ formatNumber(drop.unique) }} unique</small>
      </div>
    </div>
    <div class="aggregate-top-drops">
      <span>Top drops</span>
      <div v-if="aggregate.topDrops.length" class="aggregate-top-list">
        <div v-for="drop in aggregate.topDrops" :key="`${panelKey}-${drop.name}`">
          <span>{{ drop.name }}</span>
          <strong>{{ formatNumber(drop.total) }}</strong>
        </div>
      </div>
      <small v-else>No tracked drops yet.</small>
    </div>
  </section>
</template>
