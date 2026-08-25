<script setup lang="ts">
import { computed } from "vue";

import type { SatanicZoneState } from "../../../shared/satanic-zone";
import { satanicZoneDisplay, satanicZoneRefreshControl } from "../lib/satanic-zone-display";
import LiveDashboardCard from "./LiveDashboardCard.vue";
import RefreshIcon from "./RefreshIcon.vue";

const props = defineProps<{
  zoneState: SatanicZoneState;
  now: number;
  zoneCountdown: string;
  zoneResetLabel: string;
  refreshSubmitting: boolean;
}>();

defineEmits<{
  refresh: [];
}>();

const zone = computed(() => props.zoneState.current);
const display = computed(() => satanicZoneDisplay(props.zoneState, props.now));
const refreshControl = computed(() =>
  satanicZoneRefreshControl(props.zoneState, props.now, props.refreshSubmitting),
);
</script>

<template>
  <LiveDashboardCard id="satanic-zone-card" panel-class="zone-panel" :title="zone?.zone || 'Waiting for zone packet'">
    <template #eyebrow>
      Satanic Zone <span class="info-bubble" data-tip="Manual refresh uses the Companion's local relay and does not require a vote reset or leaving your zone. Some VPN or proxy setups may interfere with it.">i</span>
    </template>
    <template #title>{{ zone?.zone || "Waiting for zone packet" }}</template>
    <template #actions>
      <div class="countdown">
        <span>{{ zoneCountdown }}</span>
        <small>until {{ zoneResetLabel }}</small>
      </div>
      <button
        v-if="refreshControl.visible"
        class="icon-button ghost zone-refresh-button"
        type="button"
        :disabled="refreshControl.disabled"
        :title="refreshControl.title"
        :aria-label="refreshControl.ariaLabel"
        @click="$emit('refresh')"
      >
        <RefreshIcon />
      </button>
    </template>

    <div class="status-details zone-status" role="status" aria-live="polite" :data-phase="display.phase">
      <p><strong>{{ display.statusLabel }}</strong> — {{ display.statusDetail }}</p>
      <p v-if="display.observedLabel || display.validUntilLabel" class="zone-freshness">
        <span v-if="display.observedLabel">{{ display.observedLabel }}</span>
        <span v-if="display.observedLabel && display.validUntilLabel" aria-hidden="true"> · </span>
        <span v-if="display.validUntilLabel">{{ display.validUntilLabel }}</span>
      </p>
    </div>

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
    <p v-else class="empty-copy">No zone details have been observed for this half-hour window yet.</p>
  </LiveDashboardCard>
</template>
