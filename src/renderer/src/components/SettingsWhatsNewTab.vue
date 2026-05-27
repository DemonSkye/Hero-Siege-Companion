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
      <p class="whats-new-intro">{{ whatsNew.intro }}</p>
      <div class="whats-new-sections">
        <section class="whats-new-section">
          <h3>Highlights</h3>
          <ul class="whats-new-list">
            <li v-for="item in whatsNew.items" :key="item">{{ item }}</li>
          </ul>
        </section>
        <section v-for="section in whatsNew.sections" :key="section.title" class="whats-new-section">
          <h3>{{ section.title }}</h3>
          <ul class="whats-new-list">
            <li v-for="item in section.items" :key="item">{{ item }}</li>
          </ul>
        </section>
      </div>
    </section>
  </div>
</template>
