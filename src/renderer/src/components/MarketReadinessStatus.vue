<script setup lang="ts">
import { computed } from "vue";
import type { MarketReadiness } from "../../../shared/market-readiness";
import { marketReadinessDisplay } from "../lib/market-readiness-display";

const props = defineProps<{ readiness: MarketReadiness }>();
const display = computed(() => marketReadinessDisplay(props.readiness));
</script>

<template>
  <div class="market-readiness" :class="{
    'is-ready': readiness.phase === 'ready' || readiness.phase === 'region-required',
    'is-error': readiness.phase === 'region-error',
  }">
    <p class="market-readiness-label" role="status" aria-live="polite">
      <span class="market-readiness-light" aria-hidden="true"></span>
      <strong>{{ display.label }}</strong>
    </p>
    <p v-if="readiness.phase !== 'ready'" class="market-readiness-detail">{{ display.detail }}</p>
  </div>
</template>
