<script setup lang="ts">
withDefaults(defineProps<{
  tone?: "primary" | "ghost" | "danger" | "warning";
  type?: "button" | "submit" | "reset";
}>(), { tone: "ghost", type: "button" });
</script>

<template>
  <button :type="type" :class="['icon-button', 'ui-button', tone]"><slot /></button>
</template>
