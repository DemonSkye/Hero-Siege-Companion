<script setup lang="ts">
import type { WhatsNewRelease } from "../lib/whats-new";

defineProps<{
  whatsNew: WhatsNewRelease;
}>();
</script>

<template>
  <div class="settings-grid settings-grid-single">
    <section class="settings-wide compact-settings-section whats-new-settings">
      <div class="compact-settings-heading">
        <strong>What's New in {{ whatsNew.version }}</strong>
        <span>{{ whatsNew.title }}</span>
      </div>
      <ul class="whats-new-list">
        <li v-for="item in whatsNew.items" :key="item">{{ item }}</li>
      </ul>
    </section>
  </div>
</template>
