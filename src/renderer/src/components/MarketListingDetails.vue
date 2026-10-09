<script setup lang="ts">
import { computed } from "vue";
import type { MarketListingItem } from "../../../shared/market-listing-item";
import { itemStatDefinition } from "../../../shared/item-stat-ranges";
import { lookupKnownItemRarity } from "../../../shared/item-rarity";
import { marketItemByKey } from "../lib/market-items";
import { marketCatalogStatRows, marketTriggeredSkillDescription, marketTriggeredSkillStatIds } from "../lib/market-stat-display";
import { itemBaseStatMetadata } from "../../../shared/item-base-stat-catalog";
import type { MarketListingStatReason } from "../../../shared/market-listing-item";

const props = defineProps<{ item?: MarketListingItem; rank?: number }>();
const option = computed(() => marketItemByKey(props.item?.itemKey ?? null));
const rarity = computed(() => lookupKnownItemRarity(0, option.value?.name));
const definition = computed(() => itemStatDefinition(props.item?.itemKey ?? null));
const triggeredSkill = computed(() => marketTriggeredSkillDescription(definition.value, props.item?.stats ?? []));
const stats = computed(() => marketCatalogStatRows(props.item?.stats?.filter(stat => !triggeredSkill.value
  || !marketTriggeredSkillStatIds(definition.value).includes(stat.statId)).map(stat => ({ statId: stat.statId,
    kind: "scalar" as const, minimum: stat.value, maximum: stat.value,
  })) ?? [], props.item?.itemKey ?? null, "listing"));
const reasonLabels: Record<MarketListingStatReason, string> = {
  "constructor-value": "Conditional value unavailable", "prior-draw": "Depends on an unavailable roll",
  "native-stat-case": "This effect is unavailable", modifier: "Modifier effects unavailable",
  "constructor-helper": "Item effects unavailable",
  "invalid-seed": "Listing data incomplete", "invalid-projection": "Invalid listing value", "not-reconstructed": "Value unavailable",
};
const unknownStats = computed(() => props.item?.unknownStats?.map(stat => ({ ...stat,
  name: itemBaseStatMetadata(stat.statId)?.name ?? `Stat ${stat.statId}`, label: reasonLabels[stat.reason],
})) ?? []);
const unknown = computed(() => props.item?.statsReason === "unidentified" ? "Unidentified — rolls hidden"
  : props.item?.statsReason === "unsupported-variant" ? "Rolls for this variant can't be read yet"
  : props.item?.statsReason === "unverified-definition" ? "Listing rolls are not verified for this item"
  : props.item?.statsReason === "constructor-helper" ? "Rolls for this item type can't be read yet"
  : "Stats unknown for this item");
</script>

<template>
  <div class="market-listing-details">
    <div class="market-listing-heading">
      <span v-if="rank" class="market-listing-rank" aria-hidden="true">#{{ rank }}</span>
      <strong v-if="option">{{ rarity ? `${rarity} · ` : '' }}{{ option.typeLabel }}<span v-if="item && !item.identified"> · Unidentified</span></strong>
      <small v-else>Variant unavailable</small>
    </div>
    <small v-if="stats.length" class="market-listing-badge">{{ item?.statsExperimental ? 'Reconstructed listing stats (experimental)' : 'Actual listing rolls' }}</small>
    <template v-if="stats.length">
      <ul class="market-listing-stats">
        <li v-for="stat in stats" :key="stat.key"><span>{{ stat.label }}</span><strong>{{ stat.value ?? stat.detail }}</strong></li>
      </ul>
      <small v-if="triggeredSkill" class="market-triggered-skill">{{ triggeredSkill }}</small>
    </template>
    <small v-else>{{ unknown }}</small>
    <details v-if="stats.length && unknownStats.length" class="market-listing-unavailable">
      <summary>{{ unknownStats.length }} field{{ unknownStats.length === 1 ? '' : 's' }} unavailable</summary>
      <ul class="market-listing-stats">
        <li v-for="stat in unknownStats" :key="stat.statId"><span>{{ stat.name }}</span><small>{{ stat.label }}</small></li>
      </ul>
    </details>
  </div>
</template>
