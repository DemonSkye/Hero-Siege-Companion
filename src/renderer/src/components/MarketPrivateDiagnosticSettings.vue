<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { MarketPrivateDiagnosticState } from "../../../shared/market-private-diagnostic";
const state = ref<MarketPrivateDiagnosticState>({ phase: "off" });
const busy = ref(false);
let disposed = false;
let revision = 0;
let unsubscribe: (() => void) | undefined;
const status = computed(() => ({ off: "Off.", armed: "Ready to save the next Market search you run.", recording: "Saving this request and response.",
  saved: state.value.completeResponse ? "Saved the complete received response locally." : "Saved partial evidence locally. The response did not complete.",
  failed: "Could not finish saving. Any partial file is kept." }[state.value.phase]));
onMounted(async () => {
  const api = window.heroSiegeCompanion;
  if (!api?.getMarketPrivateDiagnosticState) return;
  unsubscribe = api.onMarketPrivateDiagnosticUpdated(next => { revision++; if (!disposed) state.value = next; });
  const initialRevision = revision;
  try { const next = await api.getMarketPrivateDiagnosticState(); if (!disposed && revision === initialRevision) state.value = next; } catch { /* Local status only. */ }
});
onBeforeUnmount(() => { disposed = true; unsubscribe?.(); });
async function setEnabled(enabled: boolean) {
  if (busy.value) return;
  busy.value = true;
  const initialRevision = revision;
  try { const next = await window.heroSiegeCompanion.setMarketPrivateDiagnosticEnabled(enabled); if (!disposed && revision === initialRevision) state.value = next; }
  catch { if (!disposed) state.value = { phase: "failed" }; }
  finally { busy.value = false; }
}
async function openFolder() {
  try { await window.heroSiegeCompanion.openMarketPrivateDiagnosticDirectory(); } catch { /* No raw error text. */ }
}
</script>
<template>
  <details class="settings-disclosure">
    <summary><span><strong>Private Market request</strong><small>One search, unredacted, saved locally.</small></span></summary>
    <div class="settings-disclosure-body">
      <p>This saves the full HSC request, headers and received response for one Market search you run. It can contain reusable sign-in values. The file is stored in Companion's private diagnostics folder, outside support logs, and kept until you delete it. Do not share it as a support bundle.</p>
      <p role="status" aria-live="polite">{{ status }}</p>
      <p v-if="state.filePath"><code>{{ state.filePath }}</code></p>
      <div class="settings-action-group">
        <button v-if="state.phase !== 'armed' && state.phase !== 'recording'" class="icon-button warning" type="button" :disabled="busy" @click="setEnabled(true)">Save next Market request locally</button>
        <button v-if="state.phase === 'armed'" class="icon-button ghost" type="button" :disabled="busy" @click="setEnabled(false)">Cancel recording</button>
        <button v-if="state.filePath" class="icon-button ghost" type="button" @click="openFolder">Open private folder</button>
      </div>
      <p>Arming this does not send a request. Cached results and blocked searches do not consume it. Response bytes stay within the existing response limit; interrupted or oversized responses are marked incomplete.</p>
    </div>
  </details>
</template>
