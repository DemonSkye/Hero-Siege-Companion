<script setup lang="ts">
import { computed } from "vue";
import { isSatanicZoneDiagnosticActive, type SatanicZoneDiagnosticState } from "../../../shared/satanic-zone-diagnostic";

const props = defineProps<{ diagnostic: SatanicZoneDiagnosticState; now: number; busy?: boolean; cancelBusy?: boolean }>();
defineEmits<{ arm: []; cancel: [] }>();
const active = computed(() => isSatanicZoneDiagnosticActive(props.diagnostic));
const remaining = computed(() => Math.max(0, Math.ceil(((props.diagnostic.deadlineAt ?? props.now) - props.now) / 1000)));
const status = computed(() => ({
  idle: "Off", arming: "Checking capture scope", "waiting-initialization": "Armed: restart Hero Siege once",
  collecting: "Recording fresh game flow", requesting: "Testing one independent refresh",
  complete: "Diagnostic complete", incomplete: "Diagnostic incomplete", ambiguous: "Stopped: ambiguous flow",
  "timed-out": "Diagnostic timed out", cancelled: "Diagnostic cancelled", unavailable: "Diagnostic unavailable",
}[props.diagnostic.phase] ?? "Diagnostic unavailable"));
const reason = computed(() => ({
  none: "", "game-not-ready": "Start Hero Siege and connect before arming.",
  "adapter-unavailable": "A capture adapter could not be opened.", "unsupported-capture": "This capture setup is unsupported.",
  busy: "Another refresh or its cooldown is still active.", "scope-changed": "The game connection changed during collection.",
  "missing-initialization": "No fresh connection handshake was captured.", "missing-baseline": "No successful natural SZ exchange was captured.",
  "stream-gap": "The initialization stream was incomplete.", "invalid-frame": "The initialization framing could not be verified.",
  "ambiguous-flow": "The connection could not be attributed unambiguously.", "byte-limit": "The 1 MiB collection limit was reached.",
  "capture-truncated": "A packet was truncated.", "capture-failed": "Capture could not continue safely.",
  "context-unavailable": "Fresh request context was incomplete.", "direct-failed": "The independent request did not produce a verified zone response.",
  deadline: "The two-minute deadline was reached.", "user-cancelled": "Collection stopped and private buffers were released.",
  shutdown: "Collection stopped when the app closed.",
}[props.diagnostic.reason] ?? "Collection stopped."));
const directResult = computed(() => ({
  "not-attempted": "Not attempted", pending: "Waiting", success: "Verified on its own connection",
  timeout: "Timed out", failed: "Failed", cancelled: "Cancelled",
}[props.diagnostic.directOutcome] ?? "Not verified"));
const controlResult = computed(() => ({
  "not-observed": "Not observed", "same-as-pong": "Two-byte body 01 00",
  "other-control": "Different two-byte control body", "not-control": "Not a two-byte control frame",
}[props.diagnostic.secondControl] ?? "Not classified"));
const eventNames = { connected: "Connected", "bootstrap-write": "Ping frame prepared", "bootstrap-pong": "First control body validated (01 00)",
  "zone-write": "SZ frame prepared", "response-chunk": "Received chunk", "second-control": "Second control classified", "zone-observation": "Zone object validated" };
</script>

<template>
  <section class="settings-ledger-section" aria-labelledby="sz-diagnostic-title">
    <div class="settings-ledger-section-heading">
      <h3 id="sz-diagnostic-title">One-shot SZ diagnostic</h3>
      <p>Record a fresh game connection, then permit at most one independent refresh.</p>
    </div>
    <p class="settings-ledger-footnote">Scope: one adapter and the current native API endpoint on port 6668 or 6669. Stops after 120 seconds, 1 MiB of observed payload, or 1 MiB of owned raw buffers including transient copies and the configured 64 KiB native capture capacity. No injection, relay, or automatic retries.</p>
    <p class="settings-ledger-footnote">The buffer limit excludes JavaScript strings and objects, allocator overhead, normal app capture, and OS socket memory. Total process memory is larger.</p>
    <p class="settings-ledger-footnote">Start with Hero Siege connected. Arm, then restart the game once and enter the world normally. No vote reset is required; a missing natural exchange stops the test.</p>
    <p class="settings-ledger-footnote">Raw bytes stay in memory and are cleared when collection stops. Only a sanitized summary remains. Detailed capture logging pauses during collection. Unknown protocol bytes cannot be reviewed afterward.</p>
    <div class="settings-ledger-row">
      <div class="settings-ledger-copy" role="status" aria-live="polite">
        <span class="settings-ledger-title">{{ status }}</span>
        <p v-if="active">{{ remaining }} seconds remaining</p>
        <p v-if="reason">{{ reason }}</p>
      </div>
      <div class="settings-ledger-control settings-action-group">
        <button class="icon-button ghost" type="button" :disabled="active || busy" @click="$emit('arm')">Arm SZ diagnostic</button>
        <button v-if="active || busy" class="icon-button warning" type="button" :disabled="cancelBusy" @click="$emit('cancel')">Cancel SZ diagnostic</button>
      </div>
    </div>
    <div v-if="diagnostic.startedAt !== null" class="settings-ledger-copy">
      <p>Captured fresh game flow: {{ diagnostic.initializationComplete ? "framed and attributed" : "not verified" }}. Native SZ object after SZ request: {{ diagnostic.naturalBaseline ? "observed" : "not observed" }}<span v-if="diagnostic.nativeZoneInboundOrdinal !== null"> in inbound frame #{{ diagnostic.nativeZoneInboundOrdinal }}</span>.</p>
      <p>Independent result: {{ directResult }}. Direct second frame: {{ controlResult }}. SZ socket write completed: {{ diagnostic.requestDispatched ? "yes" : "no" }}.</p>
      <p>First native inbound frame body: {{ diagnostic.nativeBootstrapControl === 'same-as-pong' ? 'two-byte body 01 00' : diagnostic.nativeBootstrapControl === 'other-control' ? 'other two-byte control body' : diagnostic.nativeBootstrapControl === 'not-control' ? 'not a two-byte control body' : 'not observed' }}. Direct control #2 body vs first native inbound frame body: {{ diagnostic.secondControlMatchesNative === null ? 'not compared' : diagnostic.secondControlMatchesNative ? 'equal' : 'different' }}.</p>
      <p>Native/direct SZ bodies: {{ diagnostic.requestBodyMatchesNative === null ? "not compared" : diagnostic.requestBodyMatchesNative ? "equal" : "different" }}. Collected: {{ diagnostic.bytesObserved }} bytes.</p>
      <p>Captured framing and equal control bodies do not establish session initialization or request acknowledgment. Socket write completion is local.</p>
      <p v-if="diagnostic.frameSummaryLimited">The frame summary reached its 32-frame display limit.</p>
      <p>Peak owned raw buffers: {{ diagnostic.peakOwnedBufferBytes }} bytes.</p>
      <ol v-if="diagnostic.frames.length" aria-label="Captured native frame sequence">
        <li v-for="(frame, index) in diagnostic.frames" :key="index">Frame #{{ index + 1 }}: {{ frame.direction === 'outbound' ? 'Outbound' : 'Inbound' }} {{ frame.kind === 'ping' ? 'two-byte ping' : frame.kind === 'zone-request' ? 'SZ request' : frame.kind === 'other-api' ? 'API frame' : 'generic frame' }}: {{ frame.bodyBytes }} body bytes<span v-if="frame.counter !== null">, counter {{ frame.counter }}</span><span v-if="frame.inboundOrdinal !== null">, inbound #{{ frame.inboundOrdinal }}</span><span v-if="frame.controlOrdinal !== null">, native control #{{ frame.controlOrdinal }}</span><span v-if="frame.control === 'same-as-pong'">, body 01 00</span><span v-else-if="frame.control === 'other-control'">, other control body</span><span v-if="frame.zoneObserved">, SZ object after request</span></li>
      </ol>
      <ol v-if="diagnostic.directEvents.length" aria-label="Independent transport event sequence">
        <li v-for="(event, index) in diagnostic.directEvents" :key="index">{{ event.direction === 'outbound' ? 'Outbound' : event.direction === 'inbound' ? 'Inbound' : 'Local' }} {{ eventNames[event.kind] ?? 'Transport event' }}: {{ event.bytes }} bytes<span v-if="event.controlOrdinal !== null">, direct control #{{ event.controlOrdinal }}</span></li>
      </ol>
    </div>
  </section>
</template>
