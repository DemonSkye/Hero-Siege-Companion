<script setup lang="ts">
import type { LogEntry } from "../../../shared/app-state";
import { formatTime } from "../lib/format";
import { logClass, logEventLabel, logEventTone, logItemIconUrl, logSummary } from "../lib/log-display";
import LiveDashboardCard from "./LiveDashboardCard.vue";

const props = defineProps<{
  recentLogs: LogEntry[];
  expandedLogIds: Set<string>;
  logLimitOptions: number[];
}>();

defineEmits<{
  hide: [];
  toggleLog: [log: LogEntry];
}>();

const logLimit = defineModel<number>("logLimit", { required: true });

function isLogExpanded(log: LogEntry): boolean {
  return props.expandedLogIds.has(log.id);
}
</script>

<template>
  <LiveDashboardCard id="live-log-card" panel-class="log-panel" title="Live Log" hideable @hide="$emit('hide')">
    <template #eyebrow>Diagnostics</template>
    <template #title>Live Log</template>
    <template #actions>
      <label class="log-limit">
        <span>History</span>
        <select v-model.number="logLimit" title="Visible log history">
          <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
    </template>
    <div v-if="recentLogs.length" class="logs">
      <button v-for="log in recentLogs" :key="log.id" type="button" :class="[logClass(log), { expanded: isLogExpanded(log) }]" @click="$emit('toggleLog', log)">
        <span class="log-time">{{ formatTime(log.createdAt) }}</span>
        <span :class="['log-event', logEventTone(log)]">{{ logEventLabel(log) }}</span>
        <img v-if="logItemIconUrl(log)" class="log-icon" :src="logItemIconUrl(log)" alt="" />
        <span v-else class="log-icon log-icon-empty" aria-hidden="true"></span>
        <p class="log-message">{{ logSummary(log) }}</p>
        <pre v-if="isLogExpanded(log)" class="log-full">{{ log.message }}</pre>
      </button>
    </div>
    <p v-else class="empty-copy dashboard-empty-state">Capture events and diagnostics will appear here as they arrive.</p>
  </LiveDashboardCard>
</template>
