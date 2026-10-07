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
const showPassphrase = computed(() => props.refreshEnabled && props.state?.enabled === true
  && (!automatic.value || !props.state.unlocked));
const detail = computed(() => failed.value ? "Could not change saved sign-in. Try again." : {
  disabled: "Off.",
  locked: "Passphrase required.",
  unlocking: "Unlocking saved sign-in.",
  unlock_failed: "Could not unlock. Check your passphrase.",
  empty: "Waiting for a complete sign-in to save.",
  saved: automatic.value ? "Sign-in saved. Automatic loading is on." : "Sign-in saved. Unlock manually next time.",
  loaded: "Saved sign-in loaded.",
  route_required: "Waiting for the game's server address. No new sign-in needed.",
  storage_error: "Could not save or load sign-in. Try again.",
  clear_failed: "Could not clear saved sign-in files. Try again.",
}[props.state?.status ?? "disabled"]);

function clearPassphrase() {
  passphrase.value = "";
  automaticConsent.value = false;
  if (passphraseInput.value) passphraseInput.value.value = "";
}

watch([() => props.refreshEnabled, () => props.state?.enabled, () => props.state?.unlocked,
  () => automatic.value], clearPassphrase);
onBeforeUnmount(clearPassphrase);

async function change(action: "toggle" | "forget" | "unlock" | "automatic") {
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
    else if (action === "forget") await api.clearSatanicZoneLoginCache();
    else await api.setSatanicZoneLoginCacheEnabled(!props.state?.enabled);
  } catch { failed.value = true; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="settings-ledger-row">
    <div class="settings-ledger-copy">
      <span id="settings-sz-login-cache-label" class="settings-ledger-title">Remember sign-in</span>
      <p>Save sign-in for future use.</p>
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
    <form v-if="showPassphrase" class="settings-ledger-row" @submit.prevent="change(automatic ? 'unlock' : 'automatic')">
      <div class="settings-ledger-copy">
        <label for="settings-sz-cache-passphrase" class="settings-ledger-title">Passphrase</label>
        <p id="settings-sz-cache-passphrase-help">Use at least 8 characters. For an existing saved sign-in, use its current passphrase.</p>
        <p v-if="!automatic" id="settings-sz-cache-consent-help">Automatic save/load keeps a local unlocking key beside the encrypted sign-in. Anyone who can read both can use the saved sign-in. Refresh still sends only when clicked.</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <input id="settings-sz-cache-passphrase" ref="passphraseInput" v-model="passphrase" type="password" autocomplete="off"
          :disabled="pending" minlength="8" maxlength="1024" spellcheck="false" autocapitalize="off"
          aria-describedby="settings-sz-cache-passphrase-help" />
        <label v-if="!automatic" for="settings-sz-cache-consent">
          <input id="settings-sz-cache-consent" v-model="automaticConsent" type="checkbox" :disabled="pending"
            aria-describedby="settings-sz-cache-consent-help" />
          I agree to keep the local unlocking key for automatic save/load.
        </label>
        <button v-if="!automatic" type="submit" class="icon-button primary"
          :disabled="pending || !validPassphrase || !automaticConsent">Enable automatic save/load</button>
        <button v-if="state?.enabled && !state.unlocked" :type="automatic ? 'submit' : 'button'" class="icon-button ghost"
          :disabled="pending || !validPassphrase" @click="!automatic && change('unlock')">Unlock for this session</button>
        <button type="button" class="icon-button ghost" :disabled="pending" @click="clearPassphrase">Cancel</button>
      </div>
    </form>
    <div class="settings-action-group">
      <button type="button" class="icon-button ghost" :disabled="pending" @click="change('forget')">Forget saved sign-in</button>
    </div>
  </div>
</template>
