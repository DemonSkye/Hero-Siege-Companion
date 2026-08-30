<script setup lang="ts">
import { computed } from "vue";
import type { CompanionState, LogEntry } from "../../../shared/app-state";
import type { ItemTimelineEntry } from "../../../shared/stats";
import type { CompactRunTileDisplay } from "../lib/compact-tiles";
import { eventChecked } from "../lib/dom-events";
import type { ItemFilterGroup, ItemFilterMatchHistoryEntry } from "../lib/item-filters";
import type { LiveRunChartLane, LiveRunCustomItem, LiveRunStandardMetric } from "../lib/live-run-history";
import type { LiveItemTypeOption, LiveTrackedItem } from "../lib/live-view-types";
import ItemTimelinePanel from "./ItemTimelinePanel.vue";
import LiveLogPanel from "./LiveLogPanel.vue";
import LiveMetricGrid from "./LiveMetricGrid.vue";
import LiveRunGraphPanel from "./LiveRunGraphPanel.vue";
import LiveStatusPanel from "./LiveStatusPanel.vue";
import SatanicZonePanel from "./SatanicZonePanel.vue";
import ShoppingListPanel from "./ShoppingListPanel.vue";
import TrackedDropsPanel from "./TrackedDropsPanel.vue";

defineProps<{
  state: CompanionState;
  now: number;
  captureStatusLabel: string;
  runTileDisplays: CompactRunTileDisplay[];
  liveRunGraphElapsedMs: number;
  runPausedLabel: string;
  liveRunGraphLanes: readonly LiveRunChartLane[];
  liveRunGraphCustomItems: readonly LiveRunCustomItem[];
  liveRunGraphEnabledStandardMetrics: readonly LiveRunStandardMetric[];
  liveRunItemNameOptions: readonly string[];
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
  recentLogs: LogEntry[];
  expandedLogIds: Set<string>;
}>();

const emit = defineEmits<{
  copyShoppingItem: [item: string];
  addShoppingItem: [];
  removeShoppingItem: [item: string];
  openNpcapGuide: [];
  openItemFilterGroup: [groupId: string];
  addLiveRunGraphItem: [name: string];
  removeLiveRunGraphItem: [seriesId: string];
  setLiveRunGraphStandardMetric: [metric: LiveRunStandardMetric, enabled: boolean];
  refreshSatanicZone: [];
  toggleLog: [log: LogEntry];
}>();

const showCaptureDetails = defineModel<boolean>("showCaptureDetails", { required: true });
const expandedDropRarity = defineModel<string | null>("expandedDropRarity", { required: true });
const timelineType = defineModel<string>("timelineType", { required: true });
const hideSocketables = defineModel<boolean>("hideSocketables", { required: true });
const hideKeys = defineModel<boolean>("hideKeys", { required: true });
const hideMaterials = defineModel<boolean>("hideMaterials", { required: true });
const hideUnfilteredItems = defineModel<boolean>("hideUnfilteredItems", { required: true });
const shoppingDraftItem = defineModel<string>("shoppingDraftItem", { required: true });
const logLimit = defineModel<number>("logLimit", { required: true });
const hiddenFixtures = defineModel<HideableLiveDashboardFixture[]>("hiddenFixtures", { required: true });

type HideableLiveDashboardFixture = "item-timeline" | "live-log";

const itemTimelineVisible = computed(() => !hiddenFixtures.value.includes("item-timeline"));
const liveLogVisible = computed(() => !hiddenFixtures.value.includes("live-log"));
const hiddenFixtureCount = computed(() => hiddenFixtures.value.length);

function setFixtureVisible(fixture: HideableLiveDashboardFixture, visible: boolean): void {
  hiddenFixtures.value = visible
    ? hiddenFixtures.value.filter((candidate) => candidate !== fixture)
    : Array.from(new Set([...hiddenFixtures.value, fixture]));
}

function updateHideUnfilteredItems(value: boolean): void {
  hideUnfilteredItems.value = value;
}

function restoreAllFixtures(): void {
  hiddenFixtures.value = [];
}

function setLiveRunGraphStandardMetric(metric: LiveRunStandardMetric, enabled: boolean): void {
  emit("setLiveRunGraphStandardMetric", metric, enabled);
}
</script>

<template>
  <section class="live-view">
    <LiveStatusPanel
      v-model:show-capture-details="showCaptureDetails"
      :state="state"
      :capture-status-label="captureStatusLabel"
      @open-npcap-guide="$emit('openNpcapGuide')"
    >
      <template #actions>
        <details class="dashboard-customizer">
          <summary
            class="dashboard-customizer-trigger dashboard-customizer-trigger-icon"
            aria-label="Customize dashboard"
            title="Customize dashboard"
          >
            <span aria-hidden="true">⚙</span>
            <span v-if="hiddenFixtureCount" class="dashboard-hidden-count">{{ hiddenFixtureCount }}</span>
          </summary>
          <div class="dashboard-customizer-popover" aria-label="Dashboard fixtures">
            <strong>Dashboard fixtures</strong>
            <span>Hidden panels stay hidden until you restore them here.</span>
            <label class="filter-box">
              <input :checked="itemTimelineVisible" type="checkbox" @change="setFixtureVisible('item-timeline', eventChecked($event))" />
              <span>Item Timeline</span>
            </label>
            <label class="filter-box">
              <input :checked="liveLogVisible" type="checkbox" @change="setFixtureVisible('live-log', eventChecked($event))" />
              <span>Live Log</span>
            </label>
            <button v-if="hiddenFixtureCount" class="dashboard-restore-button" type="button" @click="restoreAllFixtures">
              Restore all fixtures
            </button>
          </div>
        </details>
      </template>
    </LiveStatusPanel>

    <LiveMetricGrid :run-tile-displays="runTileDisplays" />

    <LiveRunGraphPanel
      :lanes="liveRunGraphLanes"
      :custom-items="liveRunGraphCustomItems"
      :enabled-standard-metrics="liveRunGraphEnabledStandardMetrics"
      :elapsed-ms="liveRunGraphElapsedMs"
      :run-status="state.runStatus"
      :run-paused-label="runPausedLabel"
      :item-name-options="liveRunItemNameOptions"
      @add-custom-item="$emit('addLiveRunGraphItem', $event)"
      @remove-custom-item="$emit('removeLiveRunGraphItem', $event)"
      @set-standard-metric-enabled="setLiveRunGraphStandardMetric"
    />

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
          v-if="itemTimelineVisible"
          v-model:timeline-type="timelineType"
          v-model:hide-socketables="hideSocketables"
          v-model:hide-keys="hideKeys"
          v-model:hide-materials="hideMaterials"
          :hide-unfiltered-items="hideUnfilteredItems"
          :visible-item-timeline="visibleItemTimeline"
          :item-timeline-count="itemTimelineCount"
          :item-filter-match-history="itemFilterMatchHistory"
          :item-type-options="itemTypeOptions"
          :item-filter-groups="itemFilterGroups"
          @update:hide-unfiltered-items="updateHideUnfilteredItems"
          @hide="setFixtureVisible('item-timeline', false)"
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
          v-if="liveLogVisible"
          v-model:log-limit="logLimit"
          :recent-logs="recentLogs"
          :expanded-log-ids="expandedLogIds"
          :log-limit-options="logLimitOptions"
          @hide="setFixtureVisible('live-log', false)"
          @toggle-log="$emit('toggleLog', $event)"
        />
      </div>
    </section>
  </section>
</template>
