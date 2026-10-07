<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { SatanicZoneLoginCacheState } from "../../../shared/satanic-zone-login-cache";
const props = defineProps<{ refreshEnabled: boolean; state?: SatanicZoneLoginCacheState }>();
const busy = ref(false);
const failed = ref(false);
const passphrase = ref("");
const automaticConsent = ref(false);
const passphraseInput = ref<HTMLInputElement | null>(null);
const utf8 = new TextEncoder();
const validPassphrase = computed(() => utf8.encode(passphrase.value).byteLength <= 1024
  && Array.from(passphrase.value).length >= 8);
const pending = computed(() => busy.value || props.state?.status === "unlocking");
const automatic = computed(() => props.state?.automatic === true);
const showPassphrase = computed(() => props.refreshEnabled && (!automatic.value || !props.state?.unlocked));
const detail = computed(() => failed.value ? "Could not change saved sign-in. Try again." : {
  disabled: "Off. No local unlocking key is kept. An existing encrypted file stays until you choose Forget saved sign-in.",
  locked: automatic.value
    ? "Locked for this session. Automatic save/load remains on for the next Companion launch. Enter the existing passphrase to unlock now."
    : "Locked. Automatic save/load is off. Use the existing passphrase to enable it, or unlock just this session.",
  unlocking: "Unlocking saved sign-in.",
  unlock_failed: "Could not unlock. Check your passphrase. If it is lost or the file is damaged, use Forget saved sign-in to start again.",
  empty: automatic.value ? "Automatic save/load is on. Waiting for a complete sign-in to save."
    : "Unlocked for this session. Waiting for a complete sign-in to save.",
  saved: automatic.value ? "Sign-in saved. Companion will load it automatically on future launches."
    : "Sign-in saved for manual unlock. Automatic save/load remains off.",
  loaded: "Saved sign-in loaded. Refresh sends only when clicked.",
  route_required: "Saved sign-in loaded. Waiting for the game's server address; no new sign-in is needed.",
  storage_error: "Encrypted sign-in could not be saved or restored. Check access to the cache file, then try again.",
  clear_failed: "Could not remove all saved sign-in files. Cached Refresh is disabled; try Forget saved sign-in again.",
}[props.state?.status ?? "disabled"]);

function clearPassphrase() {
  passphrase.value = "";
  automaticConsent.value = false;
  if (passphraseInput.value) passphraseInput.value.value = "";
}

watch([() => props.refreshEnabled, () => props.state?.enabled, () => props.state?.unlocked,
  () => automatic.value], clearPassphrase);
onBeforeUnmount(clearPassphrase);

async function change(action: "toggle" | "lock" | "forget" | "unlock" | "automatic") {
  const needsPassphrase = action === "unlock" || action === "automatic";
  if (pending.value || (needsPassphrase && (!showPassphrase.value || !validPassphrase.value))) return;
  if (action === "automatic" && (automatic.value || !automaticConsent.value)) return;
  if (action === "unlock" && (!props.state?.enabled || props.state.unlocked)) return;
  const submitted = needsPassphrase ? passphrase.value : "";
  clearPassphrase();
  busy.value = true;
  failed.value = false;
  try {
    const api = window.heroSiegeCompanion;
    if (action === "automatic") await api.enableSatanicZoneLoginCacheAutomatic(submitted);
    else if (action === "unlock") await api.unlockSatanicZoneLoginCache(submitted);
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
      <p>Save sign-in in an encrypted portable file and load it whenever Companion launches. Off by default; automatic save/load needs your agreement below. Reuse may not be accepted across game sessions. Refresh sends only when clicked.</p>
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
    <p v-if="state?.accountLabel">{{ state.accountLabel }}. Forget saved sign-in clears it.</p>
    <p v-if="automatic">Automatic save/load is enabled. Companion keeps the local unlocking key, so future launches do not require the passphrase. Saved sign-in can be used without another game sign-in.</p>
    <p>Automatic save/load keeps a local unlocking key alongside the encrypted sign-in. Anyone who can read both files can use the saved sign-in. Refresh still sends only when you click it.</p>
    <form v-if="showPassphrase" class="settings-ledger-row" @submit.prevent="change(automatic ? 'unlock' : 'automatic')">
      <div class="settings-ledger-copy">
        <label for="settings-sz-cache-passphrase" class="settings-ledger-title">Passphrase</label>
        <p id="settings-sz-cache-passphrase-help">Use at least 8 characters. With an existing file, enter its old passphrase once; enabling automatic save/load keeps its encrypted contents unchanged. A lost passphrase cannot be recovered; Forget lets you start again.</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <input id="settings-sz-cache-passphrase" ref="passphraseInput" v-model="passphrase" type="password" autocomplete="off"
          :disabled="pending" minlength="8" maxlength="1024" spellcheck="false" autocapitalize="off"
          aria-describedby="settings-sz-cache-passphrase-help" />
        <label v-if="!automatic" for="settings-sz-cache-consent">
          <input id="settings-sz-cache-consent" v-model="automaticConsent" type="checkbox" :disabled="pending" />
          I understand and agree to keep the local unlocking key for automatic save/load.
        </label>
        <button v-if="!automatic" type="submit" class="icon-button primary"
          :disabled="pending || !validPassphrase || !automaticConsent">Enable automatic save/load</button>
        <button v-if="state?.enabled && !state.unlocked" :type="automatic ? 'submit' : 'button'" class="icon-button ghost"
          :disabled="pending || !validPassphrase" @click="!automatic && change('unlock')">Unlock for this session</button>
        <button type="button" class="icon-button ghost" :disabled="pending" @click="clearPassphrase">Cancel</button>
      </div>
    </form>
    <div class="settings-action-group">
      <button v-if="state?.unlocked" type="button" class="icon-button ghost" :disabled="pending" @click="change('lock')">Lock</button>
      <button type="button" class="icon-button ghost" :disabled="pending" @click="change('forget')">Forget saved sign-in</button>
    </div>
    <p>Lock clears the cache from memory for this session; automatic reopening stays enabled for the next launch. Turning Remember sign-in or SZ Refresh off removes the local unlocking key and keeps the encrypted sign-in file. Forget deletes both files and turns Remember sign-in off. Older Windows-encrypted files are left untouched.</p>
  </div>
</template>
