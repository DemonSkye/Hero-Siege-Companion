<script setup lang="ts">
import LiveDashboardCard from "./LiveDashboardCard.vue";

defineProps<{
  shoppingListItems: string[];
  shoppingSuggestions: string[];
  activeShoppingItem: string;
}>();

defineEmits<{
  copyShoppingItem: [item: string];
  addShoppingItem: [];
  removeShoppingItem: [item: string];
}>();

const shoppingDraftItem = defineModel<string>("shoppingDraftItem", { required: true });
</script>

<template>
  <LiveDashboardCard id="shopping-list-card" panel-class="shopping-panel" title="Shopping List">
    <template #eyebrow>Marketplace</template>
    <template #title>
      Shopping List <span class="info-bubble" data-tip="The shopping list is currently for quickly copying item names into the shop. Future API changes may expose more market surface area, but the developers do not want market automation here right now.">i</span>
    </template>
    <template #actions>
      <span class="shopping-count">{{ shoppingListItems.length }} saved</span>
    </template>
    <form class="shopping-form" @submit.prevent="$emit('addShoppingItem')">
      <div class="shopping-input-wrap">
        <input
          v-model="shoppingDraftItem"
          type="text"
          list="shopping-item-suggestions"
          autocomplete="off"
          spellcheck="false"
          placeholder="Add item"
          title="Add marketplace search item"
        />
        <datalist id="shopping-item-suggestions">
          <option v-for="name in shoppingSuggestions" :key="name" :value="name"></option>
        </datalist>
      </div>
      <button class="icon-button primary shopping-add" type="submit">Add</button>
    </form>
    <div v-if="shoppingListItems.length" class="shopping-list">
      <div v-for="item in shoppingListItems" :key="item" :class="['shopping-item-row', { active: item === activeShoppingItem }]">
        <button type="button" class="shopping-item" @click="$emit('copyShoppingItem', item)">
          {{ item }}
        </button>
        <button class="shopping-remove" type="button" @click="$emit('removeShoppingItem', item)" title="Remove item" :aria-label="`Remove ${item}`">x</button>
      </div>
    </div>
    <p v-else class="empty-copy">Add item names here to copy marketplace searches quickly.</p>
  </LiveDashboardCard>
</template>
