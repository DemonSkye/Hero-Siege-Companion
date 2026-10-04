<script setup lang="ts">
import { computed } from "vue";
import type { MarketReadiness } from "../../../shared/market-readiness";
import { marketContextChecklist, marketReadinessDisplay } from "../lib/market-readiness-display";

const props = defineProps<{ readiness: MarketReadiness }>();
const display = computed(() => marketReadinessDisplay(props.readiness));
const checklist = computed(() => marketContextChecklist(props.readiness));
</script>

<template>
  <details class="market-readiness" aria-label="Market readiness">
    <summary>
      <strong role="status" aria-live="polite">{{ display.label }}</strong>
      <span>{{ checklist.filter((entry) => entry.received).length }}/6 fields received</span>
    </summary>
    <p>{{ display.detail }}</p>
    <ul aria-label="Market context checklist">
      <li v-for="entry in checklist" :key="entry.field">
        {{ entry.label }}: {{ entry.received ? "Received" : "Waiting" }}
      </li>
      <li>Current session: {{ readiness.sessionCurrent ? "Confirmed" : "Waiting" }}</li>
      <li>Account region: {{ readiness.regionQualified ? "Confirmed" : "Not confirmed" }}</li>
    </ul>
  </details>
</template>
