<script setup lang="ts">
import { computed } from "vue";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { MAGIC_FIND_FLAG_HELP, MAGIC_FIND_FLAG_METRIC_LABEL, formatTime } from "../lib/format";
import { itemIconUrl } from "../lib/item-assets";
import { itemFilterTimelineOptions, itemTimelineKey, type ItemFilterGroup, type ItemFilterMatchHistoryEntry } from "../lib/item-filters";
import { isItemResearchCandidate } from "../lib/item-research";
import type { LiveItemTypeOption } from "../lib/live-view-types";
import LiveDashboardCard from "./LiveDashboardCard.vue";

const props = defineProps<{
  visibleItemTimeline: ItemTimelineEntry[];
  itemTimelineCount: number;
  itemFilterMatchHistory: ItemFilterMatchHistoryEntry[];
  logLimitOptions: number[];
  itemTypeOptions: LiveItemTypeOption[];
  itemFilterGroups: ItemFilterGroup[];
  developerItemResearchEnabled: boolean;
}>();

defineEmits<{
  identifyTimelineItem: [item: ItemTimelineEntry];
  openItemFilterGroup: [groupId: string];
}>();

const timelineLimit = defineModel<number>("timelineLimit", { required: true });
const timelineType = defineModel<string>("timelineType", { required: true });
const hideSocketables = defineModel<boolean>("hideSocketables", { required: true });
const hideKeys = defineModel<boolean>("hideKeys", { required: true });
const hideMaterials = defineModel<boolean>("hideMaterials", { required: true });
const hideUnfilteredItems = defineModel<boolean>("hideUnfilteredItems", { required: true });

const timelineItemFilterOptions = computed(() => itemFilterTimelineOptions(props.itemFilterGroups));
const itemFilterMatchByTimelineKey = computed(() => new Map(props.itemFilterMatchHistory.map((entry) => [entry.id, entry])));

function canIdentifyTimelineItem(item: ItemTimelineEntry): boolean {
  return props.developerItemResearchEnabled && isItemResearchCandidate(item);
}

function itemFilterMatch(item: ItemTimelineEntry): ItemFilterMatchHistoryEntry | null {
  return itemFilterMatchByTimelineKey.value.get(itemTimelineKey(item)) ?? null;
}

function itemFilterGroupExists(groupId: string): boolean {
  return props.itemFilterGroups.some((group) => group.id === groupId);
}
</script>

<template>
  <LiveDashboardCard id="item-timeline-card" panel-class="timeline-panel" title="Item Timeline">
    <template #eyebrow>Recent</template>
    <template #title>Item Timeline</template>
    <template #actions>
      <label class="timeline-limit">
        <span>History</span>
        <select v-model.number="timelineLimit" title="Visible item timeline history">
          <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
    </template>
    <div class="timeline-filters">
      <label class="timeline-type-filter">
        <span>Filter</span>
        <select v-model="timelineType" title="Filter item timeline by type or item filter">
          <option value="all">All</option>
          <optgroup label="Item types">
            <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </optgroup>
          <optgroup v-if="timelineItemFilterOptions.length" label="Item filters">
            <option v-for="option in timelineItemFilterOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </optgroup>
        </select>
      </label>
      <label class="filter-box">
        <input v-model="hideSocketables" type="checkbox" />
        <span>Hide socketable</span>
      </label>
      <label class="filter-box">
        <input v-model="hideKeys" type="checkbox" />
        <span>Hide keys</span>
      </label>
      <label class="filter-box">
        <input v-model="hideMaterials" type="checkbox" />
        <span>Hide materials</span>
      </label>
      <label class="filter-box">
        <input v-model="hideUnfilteredItems" type="checkbox" />
        <span>Hide unfiltered</span>
      </label>
    </div>
    <div v-if="visibleItemTimeline.length" class="timeline">
      <div v-for="item in visibleItemTimeline" :key="`${item.createdAt}-${item.id}-${item.fingerprint}`" class="timeline-row">
        <img v-if="itemIconUrl(item.label)" class="timeline-icon" :src="itemIconUrl(item.label)" :alt="item.label" />
        <span v-else class="timeline-icon timeline-icon-empty" aria-hidden="true"></span>
        <span :class="['rarity-pill', item.rarity.toLowerCase()]">{{ item.rarity }}</span>
        <strong>{{ item.label || (item.id ? `#${item.id}` : "Unknown item") }}</strong>
        <div class="timeline-meta-actions">
          <button v-if="canIdentifyTimelineItem(item)" class="sound-test-button timeline-identify-button" type="button" @click="$emit('identifyTimelineItem', item)">Identify</button>
          <button
            v-if="itemFilterMatch(item)"
            class="timeline-filter-match"
            type="button"
            :disabled="!itemFilterGroupExists(itemFilterMatch(item)?.groupId ?? '')"
            :title="`${itemFilterMatch(item)?.soundName} matched at ${formatTime(itemFilterMatch(item)?.matchedAt ?? item.createdAt)}`"
            :aria-label="`Open ${itemFilterMatch(item)?.groupName} item filter`"
            @click="$emit('openItemFilterGroup', itemFilterMatch(item)?.groupId ?? '')"
          >
            {{ itemFilterMatch(item)?.groupName }}
          </button>
          <small>
            <span :title="item.mfDrop ? MAGIC_FIND_FLAG_HELP : undefined">{{ item.mfDrop ? MAGIC_FIND_FLAG_METRIC_LABEL : "Normal" }}</span>
            <template v-if="item.amount > 1">&middot; x{{ item.amount }}</template>
            &middot; {{ formatTime(item.createdAt) }}
          </small>
        </div>
      </div>
    </div>
    <p v-else-if="itemTimelineCount" class="empty-copy">All recent items are hidden by the current filters.</p>
    <p v-else class="empty-copy">No tracked item drops in this session yet.</p>
  </LiveDashboardCard>
</template>
