<script setup lang="ts">
import { computed } from "vue";
import { isSatanicZoneDiagnosticActive, type SatanicZoneDiagnosticState } from "../../../shared/satanic-zone-diagnostic";
const props = defineProps<{ diagnostic: SatanicZoneDiagnosticState; now: number; busy?: boolean; cancelBusy?: boolean }>();
defineEmits<{ arm: []; start: []; cancel: [] }>();
const active = computed(() => isSatanicZoneDiagnosticActive(props.diagnostic));
const remaining = computed(() => Math.max(0, Math.ceil(((props.diagnostic.deadlineAt ?? props.now) - props.now) / 1000)));
const status = computed(() => ({ idle: "Off", arming: "Checking capture scope", "waiting-initialization": "Capture ready: restart Hero Siege once",
  collecting: "Collecting native initialization", ready: "Ready: start one initialized attempt", requesting: "Initialized attempt running",
  complete: "Verified SZ response on the app connection", incomplete: "Stopped: incomplete or failed", ambiguous: "Stopped: ambiguous flow",
  "timed-out": "Deadline reached", cancelled: "Private material discarded", unavailable: "Not run: unavailable" }[props.diagnostic.phase]));
</script>

<template>
  <section class="settings-ledger-section" aria-labelledby="sz-diagnostic-title">
    <div class="settings-ledger-section-heading">
      <h3 id="sz-diagnostic-title">One-shot initialized SZ probe</h3>
      <p>Advanced test: turn off normal SZ Refresh first, then collect a fresh native login and explicitly start one app connection.</p>
    </div>
    <p class="settings-ledger-footnote">Start with Hero Siege connected. Click Collect, wait for “Capture ready”, then restart the game once and enter the world normally. When Ready appears, Start sends the captured login bodies and requests SZ once. This second login may disconnect the game or change its session identifier.</p>
    <p class="settings-ledger-footnote">Collection and readiness expire after 120 seconds. The active attempt stops after 30 seconds. One adapter, then one attributable fresh game flow, 1 MiB observed payload and 1 MiB owned raw buffers. No retries. Normal Refresh remains separate.</p>
    <p class="settings-ledger-footnote">Private material stays in main-process memory and is discarded on completion, expiry or cancellation. Detailed capture logging pauses through collection, readiness and the attempt. Only stage, outcome and counts remain. JavaScript strings and OS memory are outside the raw-buffer cap.</p>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy" role="status" aria-live="polite">
        <span class="settings-ledger-title">{{ status }}</span>
        <p v-if="active">{{ remaining }} seconds remaining</p>
        <p v-if="diagnostic.reason !== 'none'">Stop reason: {{ diagnostic.reason }}</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <button class="icon-button ghost" type="button" :disabled="active || busy" @click="$emit('arm')">Collect native initialization</button>
        <button class="icon-button ghost" type="button" :disabled="diagnostic.phase !== 'ready' || busy" @click="$emit('start')">Start one initialized attempt</button>
        <button v-if="active || busy" class="icon-button warning" type="button" :disabled="cancelBusy" @click="$emit('cancel')">Discard SZ probe</button>
      </div>
    </div>
    <div v-if="diagnostic.startedAt !== null" class="settings-ledger-copy">
      <p>Stage: {{ diagnostic.probeStage }}. Own-connection outcome: {{ diagnostic.directOutcome }}. SZ write completed: {{ diagnostic.requestDispatched ? 'yes' : 'no' }}.</p>
      <p>Selection: {{ diagnostic.selectionStatus }}. Decoded capture packets: {{ diagnostic.capturePackets }}. Game API flows: {{ diagnostic.apiFlowCount }}. Fresh handshake: {{ diagnostic.freshSyn ? 'yes' : 'no' }}. Owned flow: {{ diagnostic.attributed ? 'yes' : 'no' }}.</p>
      <p>Frames (native during collection, app during attempt): outbound {{ diagnostic.outboundFrames }}; inbound {{ diagnostic.inboundFrames }}; controls {{ diagnostic.controlFrames }}.</p>
      <p v-if="diagnostic.connectAcknowledgment">Connect acknowledgment: {{ diagnostic.connectAcknowledgment.bodyBytes }} body bytes; opcode {{ diagnostic.connectAcknowledgment.opcode }}; trailing NUL {{ diagnostic.connectAcknowledgment.trailingNul ? 'yes' : 'no' }}; embedded NUL {{ diagnostic.connectAcknowledgment.embeddedNul ? 'yes' : 'no' }}.</p>
      <p>Collected: {{ diagnostic.bytesObserved }} bytes. Peak owned raw buffers: {{ diagnostic.peakOwnedBufferBytes }} bytes.</p>
      <p>A passive game update cannot complete this probe. A local write alone does not prove a successful request.</p>
    </div>
  </section>
</template>
