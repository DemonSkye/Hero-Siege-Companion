<script setup lang="ts">
import type { CompanionState } from "../../../shared/app-state";
import { formatNumber } from "../lib/format";

interface CompactTrackedItem {
  rarity: string;
  total: number;
}

defineProps<{
  state: CompanionState;
  captureStatusLabel: string;
  compactClock: string;
  sessionDuration: string;
  zoneCountdown: string;
  compactTrackedItems: CompactTrackedItem[];
  oreDropTotal: number;
  showShopping: boolean;
  activeShoppingItem: string;
  shoppingListItems: string[];
}>();

defineEmits<{
  "update:showShopping": [value: boolean];
  copyShoppingItem: [item: string];
}>();
</script>

<template>
  <section class="compact-view">
    <div class="compact-status">
      <span :class="['status-dot', state.captureStatus]"></span>
      <strong>{{ state.captureStatus === "running" ? "Connected" : captureStatusLabel }}</strong>
      <span class="compact-parsed">{{ formatNumber(state.health.parsedEvents) }} parsed</span>
      <button
        class="compact-shopping-toggle"
        type="button"
        title="Shopping list"
        aria-label="Shopping list"
        @click="$emit('update:showShopping', !showShopping)"
      >
        List
      </button>
      <span class="compact-clock">{{ compactClock }}</span>
    </div>
    <div class="compact-primary">
      <div>
        <span>Session</span>
        <strong>{{ sessionDuration }}</strong>
      </div>
      <div>
        <span>Gold</span>
        <strong>{{ formatNumber(state.stats.totalGoldEarned) }}</strong>
      </div>
      <div>
        <span>XP</span>
        <strong>{{ formatNumber(state.stats.totalXpEarned) }}</strong>
      </div>
      <div>
        <span>Zone</span>
        <strong>{{ zoneCountdown }}</strong>
      </div>
    </div>
    <div class="compact-drops">
      <div v-for="item in compactTrackedItems" :key="item.rarity" :class="['compact-drop', item.rarity.toLowerCase()]">
        <span>{{ item.rarity }}</span>
        <strong>{{ formatNumber(item.total) }}</strong>
      </div>
      <div class="compact-drop compact-resource ore">
        <span>Ore</span>
        <strong>{{ formatNumber(oreDropTotal) }}</strong>
      </div>
    </div>
    <section v-if="showShopping" class="compact-shopping-tray" aria-label="Shopping list">
      <div class="compact-shopping-head">
        <div>
          <span>Shopping List</span>
          <strong>{{ activeShoppingItem || "Empty" }}</strong>
        </div>
        <button
          class="compact-shopping-close"
          type="button"
          title="Dismiss shopping list"
          aria-label="Dismiss shopping list"
          @click="$emit('update:showShopping', false)"
        >
          ×
        </button>
      </div>
      <div v-if="shoppingListItems.length" class="compact-shopping-list">
        <button
          v-for="item in shoppingListItems"
          :key="item"
          type="button"
          :class="['shopping-item', { active: item === activeShoppingItem }]"
          @click="$emit('copyShoppingItem', item)"
        >
          {{ item }}
        </button>
      </div>
      <p v-else class="compact-shopping-empty">Add item names in full view.</p>
    </section>
  </section>
</template>
