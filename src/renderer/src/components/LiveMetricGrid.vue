<script setup lang="ts">
import { ref } from "vue";
import type { CompactRunTileDisplay } from "../lib/compact-tiles";
import InfoHint from "./InfoHint.vue";

defineProps<{
  runTileDisplays: CompactRunTileDisplay[];
}>();

const collapsedMetricIds = ref(new Set<string>());

function isMetricCollapsed(id: string): boolean {
  return collapsedMetricIds.value.has(id);
}

function metricToggleLabel(tile: CompactRunTileDisplay): string {
  return `${isMetricCollapsed(tile.id) ? "Expand" : "Collapse"} ${tile.kind === "duration" ? "This Run" : tile.label}`;
}

function toggleMetricCard(id: string) {
  const nextIds = new Set(collapsedMetricIds.value);
  if (nextIds.has(id)) {
    nextIds.delete(id);
  } else {
    nextIds.add(id);
  }
  collapsedMetricIds.value = nextIds;
}
</script>

<template>
  <section class="metric-grid run-score-strip" aria-label="Run score">
    <article
      v-for="tile in runTileDisplays"
      :key="`desktop-${tile.id}`"
      :class="[
        'metric',
        'collapsible-metric',
        'run-score-cell',
        `run-score-${tile.kind}`,
        { collapsed: isMetricCollapsed(tile.id), 'run-score-identity': tile.kind === 'duration' },
      ]"
      :title="tile.title"
    >
      <div class="metric-heading">
        <span class="metric-label">
          {{ tile.kind === "duration" ? "This Run" : tile.label }}
          <InfoHint v-if="tile.kind === 'kills'" text="Tracks positive changes from the character's lifetime kill statistic while this run is recording." />
          <InfoHint v-else-if="tile.kind === 'gold'" text="Gold starts from the first complete character and currency baseline, then tracks positive server-total changes during this run." />
        </span>
        <button
          class="dashboard-card-toggle metric-toggle"
          type="button"
          :aria-expanded="!isMetricCollapsed(tile.id)"
          :aria-label="metricToggleLabel(tile)"
          :title="metricToggleLabel(tile)"
          @click="toggleMetricCard(tile.id)"
        ></button>
      </div>
      <template v-if="!isMetricCollapsed(tile.id)">
        <strong>{{ tile.value }}</strong>
        <small>{{ tile.detail || "Current run" }}</small>
      </template>
    </article>
  </section>
</template>
