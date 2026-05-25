<script setup lang="ts">
import { computed } from "vue";
import type { CompanionState, LogEntry } from "../../../shared/app-state";
import type { ItemDropCounter, ItemTimelineEntry } from "../../../shared/stats";
import { formatNumber, formatTime } from "../lib/format";
import { itemIconUrl } from "../lib/item-assets";
import type { CompactRunTileDisplay } from "../lib/compact-tiles";
import type { ItemFilterGroup, ItemFilterMatch, ItemFilterSoundOption } from "../lib/item-filters";
import { soundName } from "../lib/item-filters";
import { isItemResearchCandidate } from "../lib/item-research";
import { logClass, logEventLabel, logEventTone, logItemIconUrl, logSummary } from "../lib/log-display";

interface ItemTypeOption {
  value: string;
  label: string;
}

interface TrackedItem {
  rarity: string;
  total: number;
  mf: number;
  perHour: number;
  drops: ItemDropCounter[];
}

const props = defineProps<{
  state: CompanionState;
  captureStatusLabel: string;
  runTileDisplays: CompactRunTileDisplay[];
  zoneCountdown: string;
  zoneResetLabel: string;
  trackedItems: TrackedItem[];
  keyDropTotal: number;
  oreDropTotal: number;
  visibleItemTimeline: ItemTimelineEntry[];
  itemTimelineCount: number;
  logLimitOptions: number[];
  itemTypeOptions: ItemTypeOption[];
  shoppingListItems: string[];
  shoppingSuggestions: string[];
  activeShoppingItem: string;
  activeItemFilterGroups: ItemFilterGroup[];
  itemFilterSounds: ItemFilterSoundOption[];
  itemFilterGroupCount: number;
  watchedItemCount: number;
  lastItemFilterMatch: ItemFilterMatch | null;
  developerItemResearchEnabled: boolean;
  recentLogs: LogEntry[];
  expandedLogIds: Set<string>;
}>();

const emit = defineEmits<{
  copyShoppingItem: [item: string];
  addShoppingItem: [];
  removeShoppingItem: [item: string];
  testItemFilterSound: [];
  configureFilter: [];
  identifyTimelineItem: [item: ItemTimelineEntry];
  toggleLog: [log: LogEntry];
}>();

const showCaptureDetails = defineModel<boolean>("showCaptureDetails", { required: true });
const expandedDropRarity = defineModel<string | null>("expandedDropRarity", { required: true });
const timelineLimit = defineModel<number>("timelineLimit", { required: true });
const timelineType = defineModel<string>("timelineType", { required: true });
const hideSocketables = defineModel<boolean>("hideSocketables", { required: true });
const hideKeys = defineModel<boolean>("hideKeys", { required: true });
const hideMaterials = defineModel<boolean>("hideMaterials", { required: true });
const shoppingDraftItem = defineModel<string>("shoppingDraftItem", { required: true });
const itemFilterMuted = defineModel<boolean>("itemFilterMuted", { required: true });
const logLimit = defineModel<number>("logLimit", { required: true });

const expandedDrops = computed(() => props.trackedItems.find((item) => item.rarity === expandedDropRarity.value)?.drops ?? []);

function toggleDropBreakdown(rarity: string) {
  expandedDropRarity.value = expandedDropRarity.value === rarity ? null : rarity;
}

function isLogExpanded(log: LogEntry): boolean {
  return props.expandedLogIds.has(log.id);
}

function canIdentifyTimelineItem(item: ItemTimelineEntry): boolean {
  return props.developerItemResearchEnabled && isItemResearchCandidate(item);
}
</script>

<template>
  <section class="live-view">
    <section class="status-strip">
      <div class="status-item">
        <span :class="['status-dot', state.captureStatus]"></span>
        <div>
          <strong>{{ state.captureStatus === "running" ? "Connected" : captureStatusLabel }}</strong>
          <span>{{ state.captureStatus === "running" ? "Capture active" : "No active capture" }}</span>
        </div>
      </div>
      <div class="status-item">
        <strong>Packets</strong>
        <span>{{ formatNumber(state.health.packetsSeen) }} seen &middot; {{ formatNumber(state.health.parsedEvents) }} parsed</span>
      </div>
      <div class="status-item">
        <button class="details-button" type="button" @click="showCaptureDetails = !showCaptureDetails">
          {{ showCaptureDetails ? "Hide Details" : "Details" }}
        </button>
      </div>
      <div v-if="showCaptureDetails" class="status-details">
        <span>Device: {{ state.health.device || "none" }}</span>
        <span>Npcap: {{ state.health.npcapService }} &middot; WinPcap {{ state.health.winPcapCompatible ? "on" : "off" }} &middot; Admin-only {{ state.health.adminOnly ? "on" : "off" }}</span>
        <span>Filter: {{ state.health.filter || "none" }}</span>
        <span>Payloads: {{ formatNumber(state.health.payloadsAssembled) }} assembled &middot; {{ formatNumber(state.health.messagesDecoded) }} decoded</span>
        <span>Parser: {{ formatNumber(state.health.parserErrors) }} errors &middot; {{ formatNumber(state.health.parserRestarts) }} restarts</span>
      </div>
    </section>

    <p v-if="state.captureError" class="error-banner">{{ state.captureError }}</p>

    <section class="metric-grid">
      <article v-for="tile in runTileDisplays" :key="`desktop-${tile.id}`" class="metric" :title="tile.title">
        <span class="metric-label">
          {{ tile.kind === "duration" ? "This Run" : tile.label }}
          <span v-if="tile.kind === 'kills'" class="info-bubble" data-tip="Tracks positive changes from the character's lifetime kill statistic while this run is recording.">i</span>
          <span v-else-if="tile.kind === 'gold'" class="info-bubble" data-tip="Gold starts from the current server total and tracks positive differences. Sometimes you may need to force a server sync twice, such as vote reset or starting a new game, before gold fully syncs.">i</span>
        </span>
        <strong>{{ tile.value }}</strong>
        <small>{{ tile.detail || "Current run" }}</small>
      </article>
    </section>

    <section class="dashboard-grid">
      <article class="panel zone-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Satanic Zone <span class="info-bubble" data-tip="Satanic zone data updates when the game sends a fresh zone vote/reset packet.">i</span></p>
            <h2>{{ state.stats.satanicZone?.zone || "Waiting for zone packet" }}</h2>
          </div>
          <div class="countdown">
            <span>{{ zoneCountdown }}</span>
            <small>until {{ zoneResetLabel }}</small>
          </div>
        </div>

        <div v-if="state.stats.satanicZone" class="zone-effects">
          <div class="effect-column">
            <h3>Pros</h3>
            <div v-if="state.stats.satanicZone.pros.length" class="buff-list">
              <div v-for="buff in state.stats.satanicZone.pros" :key="buff.id" class="buff buff-pro">
                <strong>{{ buff.name }}</strong>
                <span>{{ buff.description }}</span>
              </div>
            </div>
            <p v-else class="empty-copy">No positive modifiers found on the last zone packet.</p>
          </div>

          <div class="effect-column">
            <h3>Cons</h3>
            <div class="buff-list">
              <div v-for="con in state.stats.satanicZone.cons" :key="con.id" class="buff buff-con">
                <strong>{{ con.name }}</strong>
                <span>{{ con.description }}</span>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="empty-copy">Zone details are cached until the next half-hour once a zone packet arrives.</p>
      </article>

      <article class="panel items-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Drops</p>
            <h2>Tracked Items</h2>
          </div>
        </div>
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
      </article>

      <article class="panel timeline-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Recent</p>
            <h2>Item Timeline</h2>
          </div>
          <label class="timeline-limit">
            <span>History</span>
            <select v-model.number="timelineLimit" title="Visible item timeline history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
        </div>
        <div class="timeline-filters">
          <label class="timeline-type-filter">
            <span>Type</span>
            <select v-model="timelineType" title="Filter item timeline by item type">
              <option value="all">All</option>
              <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
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
        </div>
        <div v-if="visibleItemTimeline.length" class="timeline">
          <div v-for="item in visibleItemTimeline" :key="`${item.createdAt}-${item.id}-${item.fingerprint}`" class="timeline-row">
            <img v-if="itemIconUrl(item.label)" class="timeline-icon" :src="itemIconUrl(item.label)" :alt="item.label" />
            <span v-else class="timeline-icon timeline-icon-empty" aria-hidden="true"></span>
            <span :class="['rarity-pill', item.rarity.toLowerCase()]">{{ item.rarity }}</span>
            <strong>{{ item.label || (item.id ? `#${item.id}` : "Unknown item") }}</strong>
            <div class="timeline-meta-actions">
              <button v-if="canIdentifyTimelineItem(item)" class="sound-test-button timeline-identify-button" type="button" @click="$emit('identifyTimelineItem', item)">Identify</button>
              <small>
                {{ item.mfDrop ? "Magic find" : "Normal" }}
                <template v-if="item.amount > 1">&middot; x{{ item.amount }}</template>
                &middot; {{ formatTime(item.createdAt) }}
              </small>
            </div>
          </div>
        </div>
        <p v-else-if="itemTimelineCount" class="empty-copy">All recent items are hidden by the current filters.</p>
        <p v-else class="empty-copy">No tracked item drops in this session yet.</p>
      </article>

      <article class="panel shopping-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Marketplace</p>
            <h2>Shopping List <span class="info-bubble" data-tip="The shopping list is currently for quickly copying item names into the shop. Future API changes may expose more market surface area, but the developers do not want market automation here right now.">i</span></h2>
          </div>
          <span class="shopping-count">{{ shoppingListItems.length }} saved</span>
        </div>
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
            <button class="shopping-remove" type="button" @click="$emit('removeShoppingItem', item)" title="Remove item" :aria-label="`Remove ${item}`">×</button>
          </div>
        </div>
        <p v-else class="empty-copy">Add item names here to copy marketplace searches quickly.</p>
      </article>

      <article class="panel item-filter-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Loot Audio</p>
            <h2>Item Filter <span class="info-bubble" data-tip="Sounds are triggered from captured network traffic, so alerts can arrive a couple seconds after the item appears in game.">i</span></h2>
          </div>
          <div class="item-filter-actions">
            <button class="icon-button ghost" type="button" @click="itemFilterMuted = !itemFilterMuted">{{ itemFilterMuted ? "Unmute" : "Mute" }}</button>
            <button class="icon-button ghost" type="button" @click="$emit('testItemFilterSound')">Test</button>
          </div>
        </div>
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
          <span>Last match</span>
          <strong>{{ lastItemFilterMatch?.itemLabel || "None this session" }}</strong>
          <small v-if="lastItemFilterMatch">{{ lastItemFilterMatch.groupName }} &middot; {{ lastItemFilterMatch.soundName }} &middot; {{ formatTime(lastItemFilterMatch.createdAt) }}</small>
          <small v-else>Matching starts from new drops after the app opens.</small>
        </div>
        <div v-if="activeItemFilterGroups.length" class="item-filter-card-groups">
          <div v-for="group in activeItemFilterGroups" :key="group.id" class="item-filter-card-group">
            <strong>{{ group.name }}</strong>
            <span>{{ soundName(group.soundId, itemFilterSounds) }} &middot; {{ group.volume }}% &middot; {{ group.cooldownMs }}ms</span>
          </div>
        </div>
        <p v-else class="empty-copy">No enabled filter groups. Configure groups in the Item Filter tab.</p>
        <button class="icon-button primary item-filter-configure" type="button" @click="$emit('configureFilter')">Configure Filter</button>
      </article>

      <article class="panel log-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Diagnostics</p>
            <h2>Live Log</h2>
          </div>
          <label class="log-limit">
            <span>History</span>
            <select v-model.number="logLimit" title="Visible log history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
        </div>
        <div class="logs">
          <button v-for="log in recentLogs" :key="log.id" type="button" :class="[logClass(log), { expanded: isLogExpanded(log) }]" @click="$emit('toggleLog', log)">
            <span class="log-time">{{ formatTime(log.createdAt) }}</span>
            <span :class="['log-event', logEventTone(log)]">{{ logEventLabel(log) }}</span>
            <img v-if="logItemIconUrl(log)" class="log-icon" :src="logItemIconUrl(log)" alt="" />
            <span v-else class="log-icon log-icon-empty" aria-hidden="true"></span>
            <p class="log-message">{{ logSummary(log) }}</p>
            <pre v-if="isLogExpanded(log)" class="log-full">{{ log.message }}</pre>
          </button>
        </div>
      </article>
    </section>
  </section>
</template>
