<script setup lang="ts">
import { computed } from "vue";
import { formatNumber } from "../lib/format";
import { itemIconUrl } from "../lib/item-assets";
import type { LiveTrackedItem } from "../lib/live-view-types";
import LiveDashboardCard from "./LiveDashboardCard.vue";

const props = defineProps<{
  trackedItems: LiveTrackedItem[];
  keyDropTotal: number;
  oreDropTotal: number;
}>();

const expandedDropRarity = defineModel<string | null>("expandedDropRarity", { required: true });
const expandedDrops = computed(() => props.trackedItems.find((item) => item.rarity === expandedDropRarity.value)?.drops ?? []);

function toggleDropBreakdown(rarity: string) {
  expandedDropRarity.value = expandedDropRarity.value === rarity ? null : rarity;
}
</script>

<template>
  <LiveDashboardCard id="tracked-drops-card" panel-class="items-panel" title="Tracked Items">
    <template #eyebrow>Drops</template>
    <template #title>Tracked Items</template>
    <div class="item-grid">
      <button
        v-for="item in trackedItems"
        :key="item.rarity"
        type="button"
        :class="['item-counter', item.rarity.toLowerCase(), { expanded: expandedDropRarity === item.rarity }]"
        @click="toggleDropBreakdown(item.rarity)"
      >
        <span>{{ item.rarity }}</span>
        <strong>{{ formatNumber(item.total) }}</strong>
        <small>{{ formatNumber(item.mf) }} MF &middot; {{ formatNumber(item.perHour) }}/h</small>
      </button>
    </div>
    <div v-if="expandedDropRarity" class="drop-breakdown" :class="expandedDropRarity.toLowerCase()">
      <div class="drop-breakdown-head">
        <strong>{{ expandedDropRarity }} drops</strong>
        <span>{{ expandedDrops.length }} unique</span>
      </div>
      <div v-if="expandedDrops.length" class="drop-breakdown-list">
        <div v-for="drop in expandedDrops" :key="drop.name" class="drop-breakdown-row">
          <img v-if="itemIconUrl(drop.name)" class="drop-breakdown-icon" :src="itemIconUrl(drop.name)" :alt="drop.name" />
          <span v-else class="drop-breakdown-icon drop-breakdown-icon-empty" aria-hidden="true"></span>
          <span class="drop-breakdown-name">{{ drop.name }}</span>
          <strong>{{ formatNumber(drop.total) }}</strong>
        </div>
      </div>
      <p v-else class="empty-copy">No {{ expandedDropRarity.toLowerCase() }} drops yet.</p>
    </div>
    <div class="drop-resource-grid" aria-label="Resource drops">
      <div class="drop-resource-counter keys">
        <span>Non-basic keys</span>
        <strong>{{ formatNumber(keyDropTotal) }}</strong>
      </div>
      <div class="drop-resource-counter ore">
        <span>Ore mined</span>
        <strong>{{ formatNumber(oreDropTotal) }}</strong>
      </div>
    </div>
  </LiveDashboardCard>
</template>
