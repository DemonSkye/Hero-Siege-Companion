<script setup lang="ts">
import { computed, ref } from "vue";
import type { SatanicZoneLoginCacheState } from "../../../shared/satanic-zone-login-cache";
const props = defineProps<{ refreshEnabled: boolean; state?: SatanicZoneLoginCacheState }>();
const busy = ref(false), failed = ref(false);
const detail = computed(() => failed.value ? "Could not change saved sign-in. Try again." : {
  disabled: "Off. No saved sign-in is kept.", empty: "Waiting for a complete sign-in to save.",
  saved: "Sign-in saved with Windows encryption. You can close and reopen Companion to test reuse.",
  unverified: "Saved sign-in restored. Waiting for fresh account and mode evidence from the game; no request has been sent.",
  validated: "Saved sign-in matched the current account, mode and game build. Refresh sends only when clicked.",
  identity_mismatch: "Current account or mode did not match. The saved sign-in was cleared.",
  build_unavailable: "Cannot verify the running game build. Saved Refresh is unavailable.",
  build_mismatch: "The game build changed. The saved sign-in was cleared.",
  encryption_unavailable: "Windows encryption is unavailable. Sign-in will not be saved or restored.",
  storage_error: "Encrypted sign-in could not be saved or restored. Use Clear saved sign-in, then try again.",
  clear_failed: "Could not delete the encrypted file. Cached Refresh is disabled; try Clear saved sign-in again.",
}[props.state?.status ?? "disabled"]);
async function change(clear = false) {
  if (busy.value) return; busy.value = true; failed.value = false;
  try {
    if (clear) await window.heroSiegeCompanion.clearSatanicZoneLoginCache();
    else await window.heroSiegeCompanion.setSatanicZoneLoginCacheEnabled(!props.state?.enabled);
  } catch { failed.value = true; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="settings-ledger-row">
    <div class="settings-ledger-copy">
      <span id="settings-sz-login-cache-label" class="settings-ledger-title">Remember sign-in (experimental)</span>
      <p>Save the paired sign-in messages with Windows encryption to test reuse after Companion reopens. Off by default. Turning this or SZ Refresh off clears the saved sign-in.</p>
    </div>
    <label class="settings-switch">
      <input type="checkbox" :checked="state?.enabled ?? false" :disabled="busy || !refreshEnabled"
        aria-labelledby="settings-sz-login-cache-label" @change="change()" />
      <span class="settings-switch-track" aria-hidden="true"><span></span></span>
      <span>{{ state?.enabled ? "On" : "Off" }}</span>
    </label>
  </div>
  <div class="settings-notice" role="status">
    <p>{{ detail }}</p>
    <button type="button" class="icon-button ghost" :disabled="busy" @click="change(true)">Clear saved sign-in</button>
  </div>
</template>
