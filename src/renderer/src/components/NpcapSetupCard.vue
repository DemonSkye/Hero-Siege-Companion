<script setup lang="ts">
import { computed } from "vue";
import type { CaptureHealth } from "../../../shared/app-state";

const props = defineProps<{
  health: CaptureHealth;
}>();

defineEmits<{
  openNpcapGuide: [];
}>();

const npcapServiceStatus = computed(() => props.health.npcapService.trim().toLowerCase());
const npcapServiceRunning = computed(() => npcapServiceStatus.value === "running");
</script>

<template>
  <section class="npcap-setup-card" aria-label="Npcap setup checklist">
    <div class="npcap-setup-heading">
      <div>
        <p class="eyebrow">First-run setup</p>
        <h2>Npcap needs a quick check</h2>
      </div>
      <button class="icon-button ghost" type="button" @click="$emit('openNpcapGuide')">Open Npcap Guide</button>
    </div>
    <div class="npcap-checklist">
      <div :class="['npcap-check', { ok: npcapServiceRunning }]">
        <span aria-hidden="true">{{ npcapServiceRunning ? "OK" : "!" }}</span>
        <div>
          <strong>Npcap service is running</strong>
          <small>Current status: {{ health.npcapService || "Unknown" }}</small>
        </div>
      </div>
      <div :class="['npcap-check', { ok: !health.adminOnly }]">
        <span aria-hidden="true">{{ health.adminOnly ? "!" : "OK" }}</span>
        <div>
          <strong>Administrator-only access is off</strong>
          <small>{{ health.adminOnly ? "Reinstall Npcap with administrator-only access unchecked." : "Capture can run without launching the app as administrator." }}</small>
        </div>
      </div>
      <div :class="['npcap-check', { ok: health.winPcapCompatible }]">
        <span aria-hidden="true">{{ health.winPcapCompatible ? "OK" : "!" }}</span>
        <div>
          <strong>WinPcap compatibility is on</strong>
          <small>{{ health.winPcapCompatible ? "The compatible API mode is enabled." : "Reinstall Npcap with WinPcap API-compatible mode checked." }}</small>
        </div>
      </div>
    </div>
  </section>
</template>
