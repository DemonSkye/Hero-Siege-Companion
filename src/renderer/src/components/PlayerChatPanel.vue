<script setup lang="ts">
import { formatTime } from "../lib/format";
import type { PlayerChatDisplayEntry } from "../lib/player-chat-display";
import LiveDashboardCard from "./LiveDashboardCard.vue";

defineProps<{
  entries: readonly PlayerChatDisplayEntry[];
}>();

defineEmits<{
  hide: [];
}>();
</script>

<template>
  <LiveDashboardCard id="player-chat-card" panel-class="player-chat-panel" title="Player Chat" hideable @hide="$emit('hide')">
    <template #eyebrow>Social</template>
    <template #title>Player Chat</template>
    <ul v-if="entries.length" class="player-chat-list" aria-label="Player chat history">
      <li v-for="entry in entries" :key="entry.id" class="player-chat-row">
        <div class="player-chat-meta">
          <strong>{{ entry.playerName }}</strong>
          <span>{{ formatTime(entry.createdAt) }}</span>
        </div>
        <p class="player-chat-message">{{ entry.message }}</p>
      </li>
    </ul>
    <p v-else class="empty-copy dashboard-empty-state">Player messages will appear here as they arrive.</p>
  </LiveDashboardCard>
</template>
