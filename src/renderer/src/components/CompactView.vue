<script setup lang="ts">
import { computed } from "vue";
import type { CompanionState } from "../../../shared/app-state";
import { effectiveSatanicZonePhase } from "../../../shared/satanic-zone";
import type { CompactRunTileDisplay } from "../lib/compact-tiles";
import { satanicZoneRefreshControl } from "../lib/satanic-zone-display";
import RefreshIcon from "./RefreshIcon.vue";

const props = defineProps<{
  state: CompanionState;
  now: number;
  compactRunTileDisplays: CompactRunTileDisplay[];
  runPausedLabel: string;
  canToggleRunPaused: boolean;
  showZone: boolean;
  satanicZoneRefreshSubmitting: boolean;
}>();

const zonePhaseLabel = computed(() => {
  const phase = effectiveSatanicZonePhase(props.state.satanicZone, props.now);
  if (phase === "current") return "Current";
  if (phase === "stale") return "Stale";
  if (phase === "refreshing" || phase === "updating") return "Updating";
  if (phase === "missed" || phase === "failed") return "Update missed";
  return "Waiting";
});

const refreshControl = computed(() =>
  satanicZoneRefreshControl(
    props.state.satanicZone,
    props.now,
    props.satanicZoneRefreshSubmitting,
  ),
);

defineEmits<{
  "update:showZone": [value: boolean];
  toggleRunPaused: [];
  endRun: [];
  refreshSatanicZone: [];
}>();
</script>

<template>
  <section class="compact-view">
    <section v-if="showZone" class="compact-shopping-tray compact-zone-tray" aria-label="Satanic zone details">
      <div class="compact-shopping-head">
        <div>
          <span>Satanic Zone · {{ zonePhaseLabel }}</span>
          <strong>{{ state.satanicZone.current?.zone || "Waiting for zone packet" }}</strong>
        </div>
        <button
          class="compact-shopping-close"
          type="button"
          title="Dismiss zone details"
          aria-label="Dismiss zone details"
          @click="$emit('update:showZone', false)"
        >
          x
        </button>
      </div>
      <div v-if="state.satanicZone.current" class="compact-zone-effects">
        <div class="compact-zone-pros">
          <span>Pros</span>
          <p v-if="!state.satanicZone.current.pros.length">None found</p>
          <p v-for="effect in state.satanicZone.current.pros" :key="`pro-${effect.id}`"><strong>{{ effect.name }}</strong></p>
        </div>
        <div class="compact-zone-cons">
          <span>Cons</span>
          <p v-if="!state.satanicZone.current.cons.length">None found</p>
          <p v-for="effect in state.satanicZone.current.cons" :key="`con-${effect.id}`"><strong>{{ effect.name }}</strong></p>
        </div>
      </div>
      <p v-else class="compact-shopping-empty">Zone details appear after the game sends a Satanic Zone packet.</p>
    </section>
    <section class="compact-cover compact-run-cover compact-run-home" aria-label="This run details">
      <div class="compact-cover-head compact-run-cover-head">
        <div class="compact-run-cover-title">
          <div>
            <span>This Run</span>
            <strong>{{ state.runStatus === "paused" ? runPausedLabel : "Recording" }}</strong>
          </div>
          <div class="compact-run-cover-controls">
            <button
              type="button"
              :disabled="!canToggleRunPaused"
              :title="!canToggleRunPaused ? 'Run resumes when capture starts' : state.runStatus === 'paused' ? 'Resume run' : 'Stop run timer'"
              @click="$emit('toggleRunPaused')"
            >
              {{ state.runStatus === "paused" ? "Resume" : "Stop" }}
            </button>
            <button type="button" title="End run" @click="$emit('endRun')">End Run</button>
          </div>
        </div>
        <div class="compact-cover-actions">
          <button class="compact-cover-button" type="button" title="Open Satanic zone details" @click="$emit('update:showZone', true)">SZ Details</button>
        </div>
      </div>
      <div class="compact-cover-grid">
        <div
          v-for="tile in compactRunTileDisplays"
          :key="`cover-${tile.id}`"
          :class="{ 'compact-zone-tile-with-refresh': tile.kind === 'sz' && refreshControl.visible }"
          :title="tile.title"
        >
          <span>{{ tile.kind === "duration" ? "Duration" : tile.label }}</span>
          <span v-if="tile.kind === 'sz'" class="compact-zone-clock">
            <strong>{{ tile.value }}</strong>
            <button
              v-if="refreshControl.visible"
              class="compact-zone-refresh-button"
              type="button"
              :disabled="refreshControl.disabled"
              :title="refreshControl.title"
              :aria-label="refreshControl.ariaLabel"
              @click="$emit('refreshSatanicZone')"
            >
              <RefreshIcon />
            </button>
          </span>
          <strong v-else>{{ tile.value }}</strong>
        </div>
      </div>
    </section>
  </section>
</template>
