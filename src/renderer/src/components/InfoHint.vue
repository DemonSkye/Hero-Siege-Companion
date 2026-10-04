<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <span class="info-bubble" role="note" tabindex="0" :aria-label="text" :data-tip="text">i</span>
</template>
