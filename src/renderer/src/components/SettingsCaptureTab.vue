<script setup lang="ts">
defineProps<{
  satanicZoneRefreshEnabled: boolean;
}>();

defineEmits<{
  requestSatanicZoneRefreshChange: [enabled: boolean];
  learnMore: [];
}>();
</script>

<template>
  <div class="settings-ledger-panel-heading">
    <h2>Features</h2>
    <p>Optional capabilities that change how the companion connects to Hero Siege.</p>
  </div>

  <section class="settings-ledger-section settings-feature-section" aria-labelledby="settings-sz-refresh-title">
    <div class="settings-feature-heading">
      <div>
        <h3 id="settings-sz-refresh-title">Satanic Zone Refresh</h3>
        <p>Request the latest Satanic Zone without waiting for the game’s next save query.</p>
      </div>
      <span :class="['settings-status-badge', { active: satanicZoneRefreshEnabled }]">
        {{ satanicZoneRefreshEnabled ? "Enabled" : "Disabled" }}
      </span>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span id="settings-sz-refresh-label" class="settings-ledger-title">Enable SZ Refresh</span>
        <p>Adds Refresh controls that use a short-lived companion-owned connection.</p>
      </div>
      <label class="settings-switch">
        <input
          :checked="satanicZoneRefreshEnabled"
          type="checkbox"
          aria-labelledby="settings-sz-refresh-label settings-sz-refresh-value"
          @change="$emit('requestSatanicZoneRefreshChange', !satanicZoneRefreshEnabled)"
        />
        <span class="settings-switch-track" aria-hidden="true"><span></span></span>
        <span id="settings-sz-refresh-value">{{ satanicZoneRefreshEnabled ? "On" : "Off" }}</span>
      </label>
    </div>

    <div class="settings-notice" role="note">
      <p><strong>Npcap required.</strong> Enabling capture listens for the next fresh API connection and complete game login. Already completed login cannot be recovered. Click Prepare refresh to listen again if needed; once ready, click Refresh. Login context stays only in memory for the current game session, with no Ready time expiry. No proxy or certificate installation is required.</p>
      <button class="icon-button ghost" type="button" @click="$emit('learnMore')">Learn More</button>
    </div>
  </section>
</template>
