<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { CompanionState, LogEntry } from "../../shared/app-state";
import { ITEM_TYPE_NAMES, MATERIAL_LIKE_TIMELINE_TYPES } from "../../shared/constants";
import { createInitialStats } from "../../shared/stats";

const state = ref<CompanionState>({
  captureRunning: false,
  captureStatus: "idle",
  captureError: null,
  connections: [],
  health: {
    npcapService: "Unknown",
    winPcapCompatible: false,
    adminOnly: false,
    device: null,
    filter: "",
    packetsSeen: 0,
    payloadsAssembled: 0,
    messagesDecoded: 0,
    parsedEvents: 0,
  },
  stats: createInitialStats(),
  logs: [],
});

const now = ref(Date.now());
let unsubscribe: (() => void) | null = null;
let clock: number | null = null;
const logLimit = ref(20);
const logLimitOptions = [10, 20, 50, 100, 250, 500];
const timelineLimit = ref(10);
const showCaptureDetails = ref(false);
const showSettings = ref(false);
const hideSocketables = ref(false);
const hideKeys = ref(false);
const hideMaterials = ref(false);
const timelineType = ref("all");
const PREFERENCES_STORAGE_KEY = "hero-siege-companion:preferences:v1";

interface UiPreferences {
  logLimit: number;
  timelineLimit: number;
  showCaptureDetails: boolean;
  hideSocketables: boolean;
  hideKeys: boolean;
  hideMaterials: boolean;
  timelineType: string;
}

const defaultPreferences: UiPreferences = {
  logLimit: 20,
  timelineLimit: 10,
  showCaptureDetails: false,
  hideSocketables: false,
  hideKeys: false,
  hideMaterials: false,
  timelineType: "all",
};

const itemTypeOptions = computed(() =>
  Object.entries(ITEM_TYPE_NAMES)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

const captureStatusLabel = computed(() => {
  if (state.value.captureStatus === "running") return "Capturing";
  if (state.value.captureStatus === "waiting") return "Waiting for Hero Siege";
  if (state.value.captureStatus === "error") return "Needs attention";
  return "Idle";
});

const sessionDuration = computed(() => formatDuration(now.value - state.value.stats.sessionStartedAt));
const nextZoneAt = computed(() => {
  const date = new Date(now.value);
  const minutes = date.getMinutes();
  const nextMinute = minutes < 30 ? 30 : 60;
  const next = new Date(date);
  next.setMinutes(nextMinute, 0, 0);
  return next;
});
const zoneCountdown = computed(() => formatDuration(Math.max(nextZoneAt.value.getTime() - now.value, 0)));
const zoneResetLabel = computed(() => nextZoneAt.value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
const trackedItems = computed(() => {
  const order = ["Set", "Satanic", "Heroic", "Angelic"];
  return order.map((rarity) => ({
    rarity,
    total: state.value.stats.items[rarity]?.total ?? 0,
    mf: state.value.stats.items[rarity]?.mf ?? 0,
    perHour: state.value.stats.itemsPerHour[rarity] ?? 0,
  }));
});
const filteredItemTimeline = computed(() =>
  state.value.stats.itemTimeline.filter((item) => {
    if (hideKeys.value && item.type === 12) return false;
    if (hideMaterials.value && MATERIAL_LIKE_TIMELINE_TYPES.has(item.type)) return false;
    if (hideSocketables.value && item.type === 15) return false;
    if (timelineType.value !== "all" && item.type !== Number(timelineType.value)) return false;
    return true;
  }),
);
const visibleItemTimeline = computed(() => filteredItemTimeline.value.slice(0, timelineLimit.value));
const recentLogs = computed(() => state.value.logs.slice(0, logLimit.value));

onMounted(async () => {
  applyPreferences(loadPreferences());
  state.value = await window.heroSiegeCompanion.getState();
  unsubscribe = window.heroSiegeCompanion.onStateUpdated((nextState) => {
    state.value = nextState;
  });
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

watch([logLimit, timelineLimit, showCaptureDetails, hideSocketables, hideKeys, hideMaterials, timelineType], () => {
  savePreferences(currentPreferences());
});

onUnmounted(() => {
  unsubscribe?.();
  if (clock) window.clearInterval(clock);
});

async function toggleCapture() {
  state.value = state.value.captureRunning
    ? await window.heroSiegeCompanion.stopCapture()
    : await window.heroSiegeCompanion.startCapture();
}

async function resetStats() {
  state.value = await window.heroSiegeCompanion.resetStats();
}

async function minimizeWindow() {
  await window.heroSiegeCompanion.minimizeWindow();
}

async function toggleMaximizeWindow() {
  await window.heroSiegeCompanion.toggleMaximizeWindow();
}

async function closeWindow() {
  await window.heroSiegeCompanion.closeWindow();
}

function resetPreferences() {
  applyPreferences(defaultPreferences);
}

function currentPreferences(): UiPreferences {
  return {
    logLimit: logLimit.value,
    timelineLimit: timelineLimit.value,
    showCaptureDetails: showCaptureDetails.value,
    hideSocketables: hideSocketables.value,
    hideKeys: hideKeys.value,
    hideMaterials: hideMaterials.value,
    timelineType: timelineType.value,
  };
}

function applyPreferences(preferences: UiPreferences) {
  logLimit.value = preferences.logLimit;
  timelineLimit.value = preferences.timelineLimit;
  showCaptureDetails.value = preferences.showCaptureDetails;
  hideSocketables.value = preferences.hideSocketables;
  hideKeys.value = preferences.hideKeys;
  hideMaterials.value = preferences.hideMaterials;
  timelineType.value = preferences.timelineType;
}

function loadPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return defaultPreferences;
    return normalizePreferences(JSON.parse(raw) as Partial<UiPreferences>);
  } catch {
    return defaultPreferences;
  }
}

function savePreferences(preferences: UiPreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences should never block the live tracker.
  }
}

function normalizePreferences(value: Partial<UiPreferences>): UiPreferences {
  const validLogLimit = logLimitOptions.includes(Number(value.logLimit)) ? Number(value.logLimit) : defaultPreferences.logLimit;
  const validTimelineLimit = logLimitOptions.includes(Number(value.timelineLimit))
    ? Number(value.timelineLimit)
    : defaultPreferences.timelineLimit;
  const validTimelineType =
    value.timelineType === "all" || Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAMES, Number(value.timelineType))
      ? String(value.timelineType)
      : defaultPreferences.timelineType;

  return {
    logLimit: validLogLimit,
    timelineLimit: validTimelineLimit,
    showCaptureDetails: Boolean(value.showCaptureDetails),
    hideSocketables: Boolean(value.hideSocketables),
    hideKeys: Boolean(value.hideKeys),
    hideMaterials: Boolean(value.hideMaterials),
    timelineType: validTimelineType,
  };
}

function formatNumber(value: number): string {
  return Math.trunc(value || 0).toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function logClass(log: LogEntry): string {
  return `log log-${log.level}`;
}
</script>

<template>
  <main class="app-shell">
    <header class="app-titlebar">
      <div class="drag-strip" aria-label="Drag window">
        <span class="app-mark">HSC</span>
        <span>Hero Siege Companion</span>
      </div>
      <div class="window-controls" aria-label="Window controls">
        <button type="button" @click="minimizeWindow" title="Minimize" aria-label="Minimize">−</button>
        <button type="button" @click="toggleMaximizeWindow" title="Maximize or restore" aria-label="Maximize or restore">□</button>
        <button class="close" type="button" @click="closeWindow" title="Close" aria-label="Close">×</button>
      </div>
    </header>

    <section class="topbar">
      <div class="topbar-title">
        <p class="eyebrow">Hero Siege Companion</p>
        <h1>Live Session</h1>
      </div>
      <div class="actions">
        <button class="icon-button ghost" type="button" @click="showSettings = true" title="Settings" aria-label="Settings">⚙</button>
        <button class="icon-button ghost" type="button" @click="resetStats" title="Reset session stats">Reset</button>
        <button class="icon-button primary" type="button" @click="toggleCapture">
          {{ state.captureRunning ? "Stop Capture" : "Start Capture" }}
        </button>
      </div>
    </section>

    <div class="app-scroll">
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
        </div>
      </section>

      <p v-if="state.captureError" class="error-banner">{{ state.captureError }}</p>

        <section class="metric-grid">
          <article class="metric">
            <span class="metric-label">Session <span class="info-bubble" data-tip="How long this capture session has been running.">i</span></span>
            <strong>{{ sessionDuration }}</strong>
            <small>{{ state.stats.accountName || "No character packet yet" }}</small>
          </article>
          <article class="metric">
            <span class="metric-label">Gold Earned <span class="info-bubble" data-tip="Gold usually updates when the game sends a currency snapshot, commonly after changing zones.">i</span></span>
            <strong>{{ formatNumber(state.stats.totalGoldEarned) }}</strong>
            <small>{{ formatNumber(state.stats.goldPerHour) }}/h &middot; {{ state.stats.seasonMode || "mode pending" }}</small>
          </article>
          <article class="metric">
            <span class="metric-label">XP Earned</span>
            <strong>{{ formatNumber(state.stats.totalXpEarned) }}</strong>
            <small>{{ formatNumber(state.stats.xpPerHour) }}/h</small>
          </article>
          <article class="metric">
            <span class="metric-label">Mailbox <span class="info-bubble" data-tip="Mailbox state updates when the game sends mailbox data, commonly when you go to town.">i</span></span>
            <strong>{{ state.stats.hasMail ? "Mail" : "Clear" }}</strong>
            <small>Last event {{ formatTime(state.stats.lastEventAt) }}</small>
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
            <div v-for="item in trackedItems" :key="item.rarity" :class="['item-counter', item.rarity.toLowerCase()]">
              <span>{{ item.rarity }}</span>
              <strong>{{ formatNumber(item.total) }}</strong>
              <small>{{ formatNumber(item.mf) }} MF &middot; {{ formatNumber(item.perHour) }}/h</small>
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
              <span :class="['rarity-pill', item.rarity.toLowerCase()]">{{ item.rarity }}</span>
              <strong>{{ item.label || (item.id ? `#${item.id}` : "Unknown item") }}</strong>
              <small>
                {{ item.mfDrop ? "Magic find" : "Normal" }}
                <template v-if="item.amount > 1">&middot; x{{ item.amount }}</template>
                &middot; {{ formatTime(item.createdAt) }}
              </small>
            </div>
          </div>
          <p v-else-if="state.stats.itemTimeline.length" class="empty-copy">All recent items are hidden by the current filters.</p>
          <p v-else class="empty-copy">No tracked item drops in this session yet.</p>
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
            <div v-for="log in recentLogs" :key="log.id" :class="logClass(log)">
              <span>{{ formatTime(log.createdAt) }}</span>
              <p>{{ log.message }}</p>
            </div>
          </div>
        </article>
      </section>
    </div>
    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="settings-heading">
          <div>
            <p class="eyebrow">Preferences</p>
            <h2 id="settings-title">Settings</h2>
            <p class="settings-note">These preferences are saved on this device and restored between sessions.</p>
          </div>
          <button class="settings-close" type="button" @click="showSettings = false" title="Close settings" aria-label="Close settings">×</button>
        </div>

        <div class="settings-grid">
          <label class="settings-row">
            <span>Log history</span>
            <select v-model.number="logLimit" title="Visible log history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="settings-row">
            <span>Item timeline history</span>
            <select v-model.number="timelineLimit" title="Visible item timeline history">
              <option v-for="option in logLimitOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="settings-row">
            <span>Timeline type</span>
            <select v-model="timelineType" title="Filter item timeline by item type">
              <option value="all">All</option>
              <option v-for="option in itemTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="settings-check">
            <input v-model="showCaptureDetails" type="checkbox" />
            <span>Show capture details</span>
          </label>
          <label class="settings-check">
            <input v-model="hideSocketables" type="checkbox" />
            <span>Hide socketable items</span>
          </label>
          <label class="settings-check">
            <input v-model="hideKeys" type="checkbox" />
            <span>Hide key items</span>
          </label>
          <label class="settings-check">
            <input v-model="hideMaterials" type="checkbox" />
            <span>Hide material and collectible items</span>
          </label>
        </div>

        <div class="settings-actions">
          <button class="icon-button ghost" type="button" @click="resetPreferences">Reset Preferences</button>
          <button class="icon-button primary" type="button" @click="showSettings = false">Done</button>
        </div>
      </section>
    </div>
    <div class="resize-grip" aria-hidden="true"></div>
  </main>
</template>

