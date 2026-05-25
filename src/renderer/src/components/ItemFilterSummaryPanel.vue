<script setup lang="ts">
import { computed, ref } from "vue";
import { formatNumber, formatTime } from "../lib/format";
import type { ItemFilterGroup, ItemFilterMatch, ItemFilterMatchTotal, ItemFilterSoundOption } from "../lib/item-filters";
import { soundName } from "../lib/item-filters";
import LiveDashboardCard from "./LiveDashboardCard.vue";

const props = defineProps<{
  activeItemFilterGroups: ItemFilterGroup[];
  itemFilterSounds: ItemFilterSoundOption[];
  itemFilterGroupCount: number;
  watchedItemCount: number;
  lastItemFilterMatch: ItemFilterMatch | null;
  itemFilterMatchTotals: ItemFilterMatchTotal[];
}>();

defineEmits<{
  testItemFilterSound: [];
  configureFilter: [];
}>();

const itemFilterMuted = defineModel<boolean>("itemFilterMuted", { required: true });
const showItemFilterTotals = ref(false);
const itemFilterMatchedDropTotal = computed(() => props.itemFilterMatchTotals.reduce((total, match) => total + match.count, 0));
</script>

<template>
  <LiveDashboardCard id="item-filter-card" panel-class="item-filter-panel" title="Item Filter">
    <template #eyebrow>Loot Audio</template>
    <template #title>
      Item Filter <span class="info-bubble" data-tip="Sounds are triggered from captured network traffic, so alerts can arrive a couple seconds after the item appears in game.">i</span>
    </template>
    <template #actions>
      <div class="item-filter-actions">
        <button class="icon-button ghost" type="button" @click="itemFilterMuted = !itemFilterMuted">{{ itemFilterMuted ? "Unmute" : "Mute" }}</button>
        <button class="icon-button ghost" type="button" @click="$emit('testItemFilterSound')">Test</button>
      </div>
    </template>
    <div class="item-filter-status-grid">
      <div>
        <span>Status</span>
        <strong>{{ itemFilterMuted ? "Muted" : "Armed" }}</strong>
      </div>
      <div>
        <span>Groups</span>
        <strong>{{ activeItemFilterGroups.length }}/{{ itemFilterGroupCount }}</strong>
      </div>
      <div>
        <span>Watched</span>
        <strong>{{ watchedItemCount }}</strong>
      </div>
    </div>
    <div class="item-filter-last">
      <div class="item-filter-last-head">
        <span>Last match</span>
        <button
          class="item-filter-total-toggle"
          type="button"
          aria-controls="item-filter-match-totals"
          :aria-expanded="showItemFilterTotals"
          :title="showItemFilterTotals ? 'Hide filtered drop totals' : 'Show filtered drop totals'"
          @click="showItemFilterTotals = !showItemFilterTotals"
        >
          Totals<template v-if="itemFilterMatchedDropTotal"> {{ formatNumber(itemFilterMatchedDropTotal) }}</template>
        </button>
      </div>
      <strong>{{ lastItemFilterMatch?.itemLabel || "None this session" }}</strong>
      <small v-if="lastItemFilterMatch">{{ lastItemFilterMatch.groupName }} &middot; {{ lastItemFilterMatch.soundName }} &middot; {{ formatTime(lastItemFilterMatch.createdAt) }}</small>
      <small v-else>Matching starts from new drops after the app opens.</small>
    </div>
    <div v-if="showItemFilterTotals" id="item-filter-match-totals" class="item-filter-match-totals" aria-label="Filtered drop totals">
      <div v-for="match in itemFilterMatchTotals" :key="match.id" class="item-filter-match-total-row">
        <div class="item-filter-match-total-meta">
          <strong>{{ match.itemLabel }}</strong>
          <span>{{ match.groupName }} &middot; last {{ formatTime(match.lastMatchedAt) }}</span>
        </div>
        <strong class="item-filter-match-total-count">x{{ formatNumber(match.count) }}</strong>
      </div>
      <p v-if="!itemFilterMatchTotals.length" class="empty-copy item-filter-match-empty">No filtered drops counted yet.</p>
    </div>
    <div v-if="activeItemFilterGroups.length" class="item-filter-card-groups">
      <div v-for="group in activeItemFilterGroups" :key="group.id" class="item-filter-card-group">
        <strong>{{ group.name }}</strong>
        <span>{{ soundName(group.soundId, itemFilterSounds) }} &middot; {{ group.volume }}% &middot; {{ group.cooldownMs }}ms</span>
      </div>
    </div>
    <p v-else class="empty-copy">No enabled filter groups. Configure groups in the Item Filter tab.</p>
    <button class="icon-button primary item-filter-configure" type="button" @click="$emit('configureFilter')">Configure Filter</button>
  </LiveDashboardCard>
</template>
