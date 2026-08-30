<script setup lang="ts">
defineProps<{
  compactMode: boolean;
  fullWindowPinned: boolean;
}>();

const emit = defineEmits<{
  "toggle-compact-mode": [];
  "open-compact-customization": [];
  "toggle-full-window-pinned": [];
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
      <button v-if="compactMode" type="button" @click="emit('open-compact-customization')" title="Customize compact mode" aria-label="Customize compact mode">⚙</button>
      <button
        v-else
        type="button"
        :class="{ active: fullWindowPinned }"
        :aria-pressed="fullWindowPinned"
        :title="fullWindowPinned ? 'Unpin window' : 'Pin window on top'"
        :aria-label="fullWindowPinned ? 'Unpin window' : 'Pin window on top'"
        @click="emit('toggle-full-window-pinned')"
      >⌖</button>
      <button type="button" @click="emit('minimize-window')" title="Minimize" aria-label="Minimize">−</button>
      <button v-if="!compactMode" type="button" @click="emit('toggle-maximize-window')" title="Maximize or restore" aria-label="Maximize or restore">□</button>
      <button class="close" type="button" @click="emit('close-window')" title="Close" aria-label="Close">×</button>
    </div>
  </header>
</template>
