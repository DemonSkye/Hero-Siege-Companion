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
        <p>Starts the managed local relay and adds Refresh controls to full and compact dashboards.</p>
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
      <p><strong>Reconnect required.</strong> Changing this while Hero Siege is connected can disconnect the active game. VPNs, system proxies, and network-security tools may conflict with the relay.</p>
      <button class="icon-button ghost" type="button" @click="$emit('learnMore')">Learn More</button>
    </div>
  </section>
</template>
