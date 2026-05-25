<script setup lang="ts">
defineProps<{
  compactMode: boolean;
}>();

const emit = defineEmits<{
  "toggle-compact-mode": [];
  "open-compact-settings": [];
  "minimize-window": [];
  "toggle-maximize-window": [];
  "close-window": [];
}>();
</script>

<template>
  <header class="app-titlebar">
    <div class="drag-strip" aria-label="Drag window">
      <span class="app-mark">HSC</span>
      <span>Hero Siege Companion</span>
    </div>
    <div class="window-controls" aria-label="Window controls">
      <button class="compact-window-button" type="button" @click="emit('toggle-compact-mode')" :title="compactMode ? 'Exit compact mode' : 'Compact mode'" :aria-label="compactMode ? 'Exit compact mode' : 'Compact mode'">
        <span class="compact-arrows" aria-hidden="true">{{ compactMode ? "↗↙" : "↙↗" }}</span>
      </button>
      <button v-if="compactMode" type="button" @click="emit('open-compact-settings')" title="Settings" aria-label="Settings">⚙</button>
      <button type="button" @click="emit('minimize-window')" title="Minimize" aria-label="Minimize">−</button>
      <button v-if="!compactMode" type="button" @click="emit('toggle-maximize-window')" title="Maximize or restore" aria-label="Maximize or restore">□</button>
      <button class="close" type="button" @click="emit('close-window')" title="Close" aria-label="Close">×</button>
    </div>
  </header>
</template>
