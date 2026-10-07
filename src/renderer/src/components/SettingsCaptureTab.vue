<script setup lang="ts">
import SatanicZoneLoginCacheSettings from "./SatanicZoneLoginCacheSettings.vue";
defineProps<{
  satanicZoneRefreshEnabled: boolean;
  satanicZoneLoginCache?: import("../../../shared/satanic-zone-login-cache").SatanicZoneLoginCacheState;
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
        <p>Check the current Satanic Zone when you need it.</p>
      </div>
      <span :class="['settings-status-badge', { active: satanicZoneRefreshEnabled }]">
        {{ satanicZoneRefreshEnabled ? "Enabled" : "Disabled" }}
      </span>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span id="settings-sz-refresh-label" class="settings-ledger-title">Enable SZ Refresh</span>
        <p>Gets ready automatically while capture is enabled, or from a loaded saved sign-in with a known server. Requests are sent only when you click Refresh.</p>
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
      <p><strong>Npcap required to collect a new sign-in.</strong> Open Companion before signing into the game, or launch the game here. If this login was already completed, you can keep playing; without a saved sign-in, Refresh will be ready after the game next signs in. Capture interruptions pause Refresh using live sign-in data until fresh matching sign-in data is observed.</p>
      <p>With a loaded saved sign-in and known server, you can try Refresh after restarting Companion or stopping capture. The server may reject the saved sign-in. Older saved sign-ins wait for the game's server connection to be observed; a new sign-in is not required.</p>
      <p>With Remember sign-in off, new sign-in data stays in memory and is cleared when you disable this feature or close Companion. Existing saved Off settings are preserved.</p>
      <button class="icon-button ghost" type="button" @click="$emit('learnMore')">Learn More</button>
    </div>
    <SatanicZoneLoginCacheSettings :refresh-enabled="satanicZoneRefreshEnabled" :state="satanicZoneLoginCache" />
  </section>
</template>
