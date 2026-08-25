<script setup lang="ts">
import type { CompanionState, LogEntry } from "../../../shared/app-state";
import type { ItemTimelineEntry } from "../../../shared/stats";
import type { CompactRunTileDisplay } from "../lib/compact-tiles";
import type { ItemFilterGroup, ItemFilterMatchHistoryEntry } from "../lib/item-filters";
import type { LiveItemTypeOption, LiveTrackedItem } from "../lib/live-view-types";
import ItemTimelinePanel from "./ItemTimelinePanel.vue";
import LiveLogPanel from "./LiveLogPanel.vue";
import LiveMetricGrid from "./LiveMetricGrid.vue";
import LiveStatusPanel from "./LiveStatusPanel.vue";
import SatanicZonePanel from "./SatanicZonePanel.vue";
import ShoppingListPanel from "./ShoppingListPanel.vue";
import TrackedDropsPanel from "./TrackedDropsPanel.vue";

defineProps<{
  state: CompanionState;
  now: number;
  captureStatusLabel: string;
  runTileDisplays: CompactRunTileDisplay[];
  zoneCountdown: string;
  zoneResetLabel: string;
  satanicZoneRefreshSubmitting: boolean;
  trackedItems: LiveTrackedItem[];
  keyDropTotal: number;
  oreDropTotal: number;
  visibleItemTimeline: ItemTimelineEntry[];
  itemTimelineCount: number;
  itemFilterMatchHistory: ItemFilterMatchHistoryEntry[];
  logLimitOptions: number[];
  itemTypeOptions: LiveItemTypeOption[];
  itemFilterGroups: ItemFilterGroup[];
  shoppingListItems: string[];
  shoppingSuggestions: string[];
  activeShoppingItem: string;
  developerItemResearchEnabled: boolean;
  recentLogs: LogEntry[];
  expandedLogIds: Set<string>;
}>();

defineEmits<{
  copyShoppingItem: [item: string];
  addShoppingItem: [];
  removeShoppingItem: [item: string];
  openNpcapGuide: [];
  openItemFilterGroup: [groupId: string];
  identifyTimelineItem: [item: ItemTimelineEntry];
  refreshSatanicZone: [];
  toggleLog: [log: LogEntry];
}>();

const showCaptureDetails = defineModel<boolean>("showCaptureDetails", { required: true });
const expandedDropRarity = defineModel<string | null>("expandedDropRarity", { required: true });
const timelineLimit = defineModel<number>("timelineLimit", { required: true });
const timelineType = defineModel<string>("timelineType", { required: true });
const hideSocketables = defineModel<boolean>("hideSocketables", { required: true });
const hideKeys = defineModel<boolean>("hideKeys", { required: true });
const hideMaterials = defineModel<boolean>("hideMaterials", { required: true });
const hideUnfilteredItems = defineModel<boolean>("hideUnfilteredItems", { required: true });
const shoppingDraftItem = defineModel<string>("shoppingDraftItem", { required: true });
const logLimit = defineModel<number>("logLimit", { required: true });
</script>

<template>
  <section class="live-view">
    <LiveStatusPanel
      v-model:show-capture-details="showCaptureDetails"
      :state="state"
      :capture-status-label="captureStatusLabel"
      @open-npcap-guide="$emit('openNpcapGuide')"
    />

    <LiveMetricGrid :run-tile-displays="runTileDisplays" />

    <section class="dashboard-grid">
      <div class="dashboard-column dashboard-column-main">
        <SatanicZonePanel
          :zone-state="state.satanicZone"
          :now="now"
          :zone-countdown="zoneCountdown"
          :zone-reset-label="zoneResetLabel"
          :refresh-submitting="satanicZoneRefreshSubmitting"
          @refresh="$emit('refreshSatanicZone')"
        />

        <ItemTimelinePanel
          v-model:timeline-limit="timelineLimit"
          v-model:timeline-type="timelineType"
          v-model:hide-socketables="hideSocketables"
          v-model:hide-keys="hideKeys"
          v-model:hide-materials="hideMaterials"
          :visible-item-timeline="visibleItemTimeline"
          :item-timeline-count="itemTimelineCount"
          :item-filter-match-history="itemFilterMatchHistory"
          :log-limit-options="logLimitOptions"
          :item-type-options="itemTypeOptions"
          :item-filter-groups="itemFilterGroups"
          :developer-item-research-enabled="developerItemResearchEnabled"
          v-model:hide-unfiltered-items="hideUnfilteredItems"
          @identify-timeline-item="$emit('identifyTimelineItem', $event)"
          @open-item-filter-group="$emit('openItemFilterGroup', $event)"
        />

        <ShoppingListPanel
          v-model:shopping-draft-item="shoppingDraftItem"
          :shopping-list-items="shoppingListItems"
          :shopping-suggestions="shoppingSuggestions"
          :active-shopping-item="activeShoppingItem"
          @copy-shopping-item="$emit('copyShoppingItem', $event)"
          @add-shopping-item="$emit('addShoppingItem')"
          @remove-shopping-item="$emit('removeShoppingItem', $event)"
        />
      </div>

      <div class="dashboard-column dashboard-column-side">
        <TrackedDropsPanel
          v-model:expanded-drop-rarity="expandedDropRarity"
          :tracked-items="trackedItems"
          :key-drop-total="keyDropTotal"
          :ore-drop-total="oreDropTotal"
        />

        <LiveLogPanel
          v-model:log-limit="logLimit"
          :recent-logs="recentLogs"
          :expanded-log-ids="expandedLogIds"
          :log-limit-options="logLimitOptions"
          @toggle-log="$emit('toggleLog', $event)"
        />
      </div>
    </section>
  </section>
</template>
