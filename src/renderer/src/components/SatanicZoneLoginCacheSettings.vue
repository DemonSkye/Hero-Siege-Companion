<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { SatanicZoneLoginCacheState } from "../../../shared/satanic-zone-login-cache";
const props = defineProps<{ refreshEnabled: boolean; state?: SatanicZoneLoginCacheState }>();
const busy = ref(false);
const failed = ref(false);
const passphrase = ref("");
const passphraseInput = ref<HTMLInputElement | null>(null);
const utf8 = new TextEncoder();
const validPassphrase = computed(() => utf8.encode(passphrase.value).byteLength <= 1024
  && Array.from(passphrase.value).length >= 12);
const pending = computed(() => busy.value || props.state?.status === "unlocking");
const showUnlock = computed(() => props.refreshEnabled && props.state?.enabled && !props.state.unlocked);
const detail = computed(() => failed.value ? "Could not change saved sign-in. Try again." : {
  disabled: "Off. An existing encrypted file is kept until you choose Forget saved sign-in.",
  locked: "Locked. Enter your passphrase to use or save sign-in during this Companion session.",
  unlocking: "Unlocking saved sign-in.",
  unlock_failed: "Could not unlock. Check your passphrase. If it is lost or the file is damaged, use Forget saved sign-in to start again.",
  empty: "Unlocked. Waiting for a complete sign-in to save.",
  saved: "Sign-in saved with your passphrase. Enter it again after Companion reopens to test reuse.",
  unverified: "Saved sign-in unlocked. Waiting for fresh account and mode evidence from the game; no request has been sent.",
  validated: "Saved sign-in matched the current account and mode. Refresh sends only when clicked.",
  identity_mismatch: "Current account or mode did not match. The saved sign-in was cleared.",
  storage_error: "Encrypted sign-in could not be saved or restored. Check access to the cache file, then try again.",
  clear_failed: "Could not delete the encrypted file. Cached Refresh is disabled; try Forget saved sign-in again.",
}[props.state?.status ?? "disabled"]);

function clearPassphrase() {
  passphrase.value = "";
  if (passphraseInput.value) passphraseInput.value.value = "";
}

watch([() => props.refreshEnabled, () => props.state?.enabled, () => props.state?.unlocked], clearPassphrase);
onBeforeUnmount(clearPassphrase);

async function change(action: "toggle" | "lock" | "forget" | "unlock") {
  if (pending.value || (action === "unlock" && (!showUnlock.value || !validPassphrase.value))) return;
  const submitted = action === "unlock" ? passphrase.value : "";
  clearPassphrase();
  busy.value = true;
  failed.value = false;
  try {
    const api = window.heroSiegeCompanion;
    if (action === "unlock") await api.unlockSatanicZoneLoginCache(submitted);
    else if (action === "lock") await api.lockSatanicZoneLoginCache();
    else if (action === "forget") await api.clearSatanicZoneLoginCache();
    else await api.setSatanicZoneLoginCacheEnabled(!props.state?.enabled);
  } catch { failed.value = true; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="settings-ledger-row">
    <div class="settings-ledger-copy">
      <span id="settings-sz-login-cache-label" class="settings-ledger-title">Remember sign-in (experimental)</span>
      <p>Optional portable file encrypted with your passphrase. Off by default. Enable, then unlock to save or reuse sign-in. Reuse may not be accepted across game sessions.</p>
    </div>
    <label class="settings-switch">
      <input type="checkbox" :checked="state?.enabled ?? false" :disabled="pending || !refreshEnabled"
        aria-labelledby="settings-sz-login-cache-label" @change="change('toggle')" />
      <span class="settings-switch-track" aria-hidden="true"><span></span></span>
      <span>{{ state?.enabled ? "On" : "Off" }}</span>
    </label>
  </div>
  <div class="settings-notice settings-login-cache-notice">
    <p role="status" aria-live="polite">{{ detail }}</p>
    <p>Enter the passphrase each Companion session. A lost passphrase cannot be recovered. Anyone with the file and passphrase can use the saved sign-in.</p>
    <form v-if="showUnlock" class="settings-ledger-row" @submit.prevent="change('unlock')">
      <div class="settings-ledger-copy">
        <label for="settings-sz-cache-passphrase" class="settings-ledger-title">Passphrase</label>
        <p id="settings-sz-cache-passphrase-help">Use at least 12 characters. With no saved file, this sets the passphrase for the next saved sign-in. Otherwise use its existing passphrase.</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <input id="settings-sz-cache-passphrase" ref="passphraseInput" v-model="passphrase" type="password" autocomplete="off"
          :disabled="pending" minlength="12" maxlength="1024" spellcheck="false" autocapitalize="off"
          aria-describedby="settings-sz-cache-passphrase-help" />
        <button type="submit" class="icon-button ghost" :disabled="pending || !validPassphrase">Unlock</button>
        <button type="button" class="icon-button ghost" :disabled="pending" @click="clearPassphrase">Cancel</button>
      </div>
    </form>
    <div class="settings-action-group">
      <button v-if="state?.unlocked" type="button" class="icon-button ghost" :disabled="pending" @click="change('lock')">Lock</button>
      <button type="button" class="icon-button ghost" :disabled="pending" @click="change('forget')">Forget saved sign-in</button>
    </div>
    <p>Lock clears the unlocked cache from memory and keeps the encrypted file. Turning Remember sign-in or SZ Refresh off also locks and disables the cache. Forget deletes the portable file and turns Remember sign-in off. Older Windows-encrypted files are left untouched.</p>
  </div>
</template>
