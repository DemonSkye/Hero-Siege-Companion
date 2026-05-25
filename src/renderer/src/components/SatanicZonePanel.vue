<script setup lang="ts">
import type { SatanicZoneInfo } from "../../../shared/parser";
import LiveDashboardCard from "./LiveDashboardCard.vue";

defineProps<{
  zone: SatanicZoneInfo | null;
  zoneCountdown: string;
  zoneResetLabel: string;
}>();
</script>

<template>
  <LiveDashboardCard id="satanic-zone-card" panel-class="zone-panel" :title="zone?.zone || 'Waiting for zone packet'">
    <template #eyebrow>
      Satanic Zone <span class="info-bubble" data-tip="Satanic zone data updates when the game sends a fresh zone vote/reset packet.">i</span>
    </template>
    <template #title>{{ zone?.zone || "Waiting for zone packet" }}</template>
    <template #actions>
      <div class="countdown">
        <span>{{ zoneCountdown }}</span>
        <small>until {{ zoneResetLabel }}</small>
      </div>
    </template>

    <div v-if="zone" class="zone-effects">
      <div class="effect-column">
        <h3>Pros</h3>
        <div v-if="zone.pros.length" class="buff-list">
          <div v-for="buff in zone.pros" :key="buff.id" class="buff buff-pro">
            <strong>{{ buff.name }}</strong>
            <span>{{ buff.description }}</span>
          </div>
        </div>
        <p v-else class="empty-copy">No positive modifiers found on the last zone packet.</p>
      </div>

      <div class="effect-column">
        <h3>Cons</h3>
        <div class="buff-list">
          <div v-for="con in zone.cons" :key="con.id" class="buff buff-con">
            <strong>{{ con.name }}</strong>
            <span>{{ con.description }}</span>
          </div>
        </div>
      </div>
    </div>
    <p v-else class="empty-copy">Zone details are cached until the next half-hour once a zone packet arrives.</p>
  </LiveDashboardCard>
</template>
