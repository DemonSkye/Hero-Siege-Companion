<script setup lang="ts">
import type { RunStatus } from "../../../shared/app-state";

defineProps<{
  captureRunning: boolean;
  runStatus: RunStatus;
  canToggleRunPaused: boolean;
}>();

const emit = defineEmits<{
  "open-settings": [];
  "toggle-run-paused": [];
  "end-run": [];
  "toggle-capture": [];
}>();
</script>

<template>
  <section class="topbar">
    <div class="topbar-title">
      <p class="eyebrow">Hero Siege Companion</p>
      <h1>Live Session</h1>
    </div>
    <div class="actions">
      <button class="icon-button ghost" type="button" @click="emit('open-settings')" title="Settings" aria-label="Settings">⚙</button>
      <button class="icon-button ghost" type="button" @click="emit('toggle-run-paused')" :disabled="!canToggleRunPaused" :title="!canToggleRunPaused ? 'Run will resume when capture starts' : runStatus === 'paused' ? 'Resume this run' : 'Pause this run'">
        {{ runStatus === "paused" ? "Resume Run" : "Pause Run" }}
      </button>
      <button class="icon-button ghost" type="button" @click="emit('end-run')" title="Save this run to Past Runs and reset session stats">End Run</button>
      <button class="icon-button primary" type="button" @click="emit('toggle-capture')">
        {{ captureRunning ? "Stop Capture" : "Launch Game" }}
      </button>
    </div>
  </section>
</template>
