<script setup lang="ts">
import { computed } from "vue";
import type { MarketListingItem } from "../../../shared/market-listing-item";
import { itemStatDefinition } from "../../../shared/item-stat-ranges";
import { lookupKnownItemRarity } from "../../../shared/item-rarity";
import { marketItemByKey } from "../lib/market-items";

const props = defineProps<{ item?: MarketListingItem }>();
const option = computed(() => marketItemByKey(props.item?.itemKey ?? null));
const rarity = computed(() => lookupKnownItemRarity(0, option.value?.name));
const definition = computed(() => itemStatDefinition(props.item?.itemKey ?? null));
const stats = computed(() => props.item?.stats?.map(stat => ({ ...stat,
  range: definition.value?.stats.find(range => range.statId === stat.statId),
})) ?? []);
const unknown = computed(() => props.item?.statsReason === "unidentified" ? "Unidentified — rolls hidden"
  : props.item?.statsReason === "unsupported-variant" ? "Stats unknown for this variant"
  : "Stats unknown for this item");
</script>

<template>
  <div class="market-listing-details">
    <strong v-if="option">{{ rarity ? `${rarity} · ` : '' }}{{ option.typeLabel }}<span v-if="item && !item.identified"> · Unidentified</span></strong>
    <small v-else>Variant unavailable</small>
    <template v-if="stats.length">
      <small>Actual listing rolls</small>
      <ul class="market-listing-stats">
        <li v-for="stat in stats" :key="stat.statId"><span>{{ stat.range?.name ?? `Unknown stat ${stat.statId}` }}</span><strong>{{ stat.value }}{{ stat.range?.unit === 'percent' ? '%' : '' }}</strong></li>
      </ul>
    </template>
    <small v-else>{{ unknown }}</small>
  </div>
</template>
