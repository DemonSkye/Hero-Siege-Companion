<script setup lang="ts">
import type { CompanionState } from "../../../shared/app-state";
import {
  type CompactRunTileDisplay,
} from "../lib/compact-tiles";

const props = defineProps<{
  state: CompanionState;
  compactRunTileDisplays: CompactRunTileDisplay[];
  runPausedLabel: string;
  canToggleRunPaused: boolean;
  showZone: boolean;
}>();

const emit = defineEmits<{
  "update:showZone": [value: boolean];
  toggleRunPaused: [];
  endRun: [];
}>();
</script>

<template>
  <section class="compact-view">
    <section v-if="showZone" class="compact-shopping-tray compact-zone-tray" aria-label="Satanic zone details">
      <div class="compact-shopping-head">
        <div>
          <span>Satanic Zone</span>
          <strong>{{ state.stats.satanicZone?.zone || "Waiting for zone packet" }}</strong>
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
      <div v-if="state.stats.satanicZone" class="compact-zone-effects">
        <div>
          <span>Pros</span>
          <p v-if="!state.stats.satanicZone.pros.length">None found</p>
          <p v-for="effect in state.stats.satanicZone.pros" :key="`pro-${effect.id}`"><strong>{{ effect.name }}</strong></p>
        </div>
        <div>
          <span>Cons</span>
          <p v-if="!state.stats.satanicZone.cons.length">None found</p>
          <p v-for="effect in state.stats.satanicZone.cons" :key="`con-${effect.id}`"><strong>{{ effect.name }}</strong></p>
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
        <div v-for="tile in compactRunTileDisplays" :key="`cover-${tile.id}`" :title="tile.title">
          <span>{{ tile.kind === "duration" ? "Duration" : tile.label }}</span>
          <strong>{{ tile.value }}</strong>
        </div>
      </div>
    </section>
  </section>
</template>
