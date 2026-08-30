<script setup lang="ts">
import { computed } from "vue";
import type { CompanionState } from "../../../shared/app-state";
import { formatNumber } from "../lib/format";
import NpcapSetupCard from "./NpcapSetupCard.vue";

const props = defineProps<{
  state: CompanionState;
  captureStatusLabel: string;
}>();

defineEmits<{
  openNpcapGuide: [];
}>();

const showCaptureDetails = defineModel<boolean>("showCaptureDetails", { required: true });
const npcapServiceStatus = computed(() => props.state.health.npcapService.trim().toLowerCase());
const npcapServiceRunning = computed(() => npcapServiceStatus.value === "running");
const showNpcapSetupChecklist = computed(() => !npcapServiceRunning.value || props.state.health.adminOnly || !props.state.health.winPcapCompatible);
</script>

<template>
  <section>
    <section class="status-strip">
      <div class="status-item">
        <span :class="['status-dot', state.captureStatus]"></span>
        <div class="status-copy">
          <strong>{{ state.captureStatus === "running" ? "Connected" : captureStatusLabel }}</strong>
          <span>{{ state.captureStatus === "running" ? "Capture active" : "No active capture" }}</span>
        </div>
      </div>
      <div class="status-item">
        <div class="status-copy">
          <strong>Packets</strong>
          <span>{{ formatNumber(state.health.packetsSeen) }} seen &middot; {{ formatNumber(state.health.parsedEvents) }} parsed</span>
        </div>
      </div>
      <div class="status-item status-actions">
        <slot name="actions"></slot>
        <button
          class="details-button"
          type="button"
          aria-controls="capture-details"
          :aria-expanded="showCaptureDetails"
          @click="showCaptureDetails = !showCaptureDetails"
        >
          {{ showCaptureDetails ? "Hide Capture Details" : "Capture Details" }}
        </button>
      </div>
      <div v-if="showCaptureDetails" id="capture-details" class="status-details">
        <span>Device: {{ state.health.device || "none" }}</span>
        <span>Npcap: {{ state.health.npcapService }} &middot; WinPcap {{ state.health.winPcapCompatible ? "on" : "off" }} &middot; Admin-only {{ state.health.adminOnly ? "on" : "off" }}</span>
        <span>Filter: {{ state.health.filter || "none" }}</span>
        <span>Payloads: {{ formatNumber(state.health.payloadsAssembled) }} assembled &middot; {{ formatNumber(state.health.messagesDecoded) }} decoded</span>
        <span>Parser: {{ formatNumber(state.health.parserErrors) }} errors &middot; {{ formatNumber(state.health.parserRestarts) }} restarts</span>
      </div>
    </section>

    <p v-if="state.captureError" class="error-banner">{{ state.captureError }}</p>

    <NpcapSetupCard
      v-if="showNpcapSetupChecklist"
      :health="state.health"
      @open-npcap-guide="$emit('openNpcapGuide')"
    />
  </section>
</template>
