<script setup lang="ts">
import type { RunStatus } from "../../../shared/app-state";
import UiButton from "./UiButton.vue";

defineProps<{
  captureRunning: boolean;
  runStatus: RunStatus;
  canToggleRunPaused: boolean;
  title?: string;
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
      <h1>{{ title ?? "Live Session" }}</h1>
    </div>
    <div class="actions">
      <UiButton class="session-settings-button" @click="emit('open-settings')" title="Settings" aria-label="Settings">Settings</UiButton>
      <UiButton @click="emit('toggle-run-paused')" :disabled="!canToggleRunPaused" :title="!canToggleRunPaused ? 'Run will resume when capture starts' : runStatus === 'paused' ? 'Resume this run' : 'Pause this run'">
        {{ runStatus === "paused" ? "Resume Run" : "Pause Run" }}
      </UiButton>
      <UiButton @click="emit('end-run')" title="Save this run to Past Runs and reset session stats">End Run</UiButton>
      <UiButton tone="primary" @click="emit('toggle-capture')">
        {{ captureRunning ? "Stop Capture" : "Launch Game" }}
      </UiButton>
    </div>
  </section>
</template>
