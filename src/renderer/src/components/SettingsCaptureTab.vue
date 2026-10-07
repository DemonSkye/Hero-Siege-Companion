<script setup lang="ts">
import SatanicZoneLoginCacheSettings from "./SatanicZoneLoginCacheSettings.vue";
import { ACTIVE_SATANIC_ZONE_REFRESH_ENABLED } from "../../../shared/release-features";
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
    <p v-if="ACTIVE_SATANIC_ZONE_REFRESH_ENABLED">Optional capabilities that change how the companion connects to Hero Siege.</p>
    <p v-else>Satanic Zone updates are observed from normal game traffic. Manual Refresh is temporarily unavailable.</p>
  </div>

  <section v-if="ACTIVE_SATANIC_ZONE_REFRESH_ENABLED" class="settings-ledger-section settings-feature-section" aria-labelledby="settings-sz-refresh-title">
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
        <p>Requests are sent only when you click Refresh.</p>
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
      <p>Open Companion before signing in, or launch the game here.</p>
    </div>
    <SatanicZoneLoginCacheSettings :refresh-enabled="satanicZoneRefreshEnabled" :state="satanicZoneLoginCache" />
    <div class="settings-action-group">
      <button class="icon-button ghost" type="button" @click="$emit('learnMore')">Details</button>
    </div>
  </section>
</template>
