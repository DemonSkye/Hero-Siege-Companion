<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, toRef } from "vue";
import type { CompanionState } from "../../../shared/app-state";
import { effectiveSatanicZonePhase } from "../../../shared/satanic-zone";
import type { CompactNavigationConfig, CompactPageDisplay } from "../lib/compact-pages";
import { useCompactPager } from "../lib/compact-pager";
import { satanicZoneRefreshControl } from "../lib/satanic-zone-display";
import { satanicZonePreparationDetail } from "../lib/satanic-zone-preparation-display";
import RefreshIcon from "./RefreshIcon.vue";
import { ACTIVE_SATANIC_ZONE_REFRESH_ENABLED } from "../../../shared/release-features";

const props = defineProps<{
  state: CompanionState;
  now: number;
  pages: CompactPageDisplay[];
  navigation: CompactNavigationConfig;
  sessionDuration: string;
  zoneCountdown: string;
  runPausedLabel: string;
  canToggleRunPaused: boolean;
  satanicZoneRefreshSubmitting: boolean;
}>();

const emit = defineEmits<{
  toggleRunPaused: [];
  endRun: [];
  refreshSatanicZone: [];
}>();

const pager = useCompactPager(computed(() => props.pages.length), toRef(props, "navigation"));
const page = computed(() => props.pages[pager.index.value] ?? null);
const zonePageIndex = computed(() => props.pages.findIndex((candidate) => candidate.kind === "zone"));
const paused = computed(() => props.state.runStatus === "paused");
const navigationHint = computed(() => {
  const { wheel, arrowKeys, pageKeys } = props.navigation;
  const ways = [wheel && "scroll", arrowKeys && "arrow keys", pageKeys && "Page Up/Down"].filter(Boolean);
  return ways.length ? `Switch pages with ${ways.join(", ")}` : "Switch pages with the page dots";
});

const zonePhaseLabel = computed(() => {
  const phase = effectiveSatanicZonePhase(props.state.satanicZone, props.now);
  if (phase === "current") return "Current";
  if (phase === "stale") return "Stale";
  if (phase === "refreshing" || phase === "updating") return "Updating";
  if (phase === "missed" || phase === "failed") return "Update missed";
  return "Waiting";
});
const refreshControl = computed(() =>
  satanicZoneRefreshControl(props.state.satanicZone, props.now, props.satanicZoneRefreshSubmitting),
);
const showRefresh = computed(() => ACTIVE_SATANIC_ZONE_REFRESH_ENABLED && refreshControl.value.visible);
const preparationDetail = computed(() => ACTIVE_SATANIC_ZONE_REFRESH_ENABLED && props.state.satanicZone.refreshEnabled
  ? satanicZonePreparationDetail(props.state.satanicZone.refreshPreparation, props.now) : null);

function linksToZone(tile: CompactPageDisplay["tiles"][number]): boolean {
  return tile.kind === "sz" && zonePageIndex.value >= 0 && !showRefresh.value;
}

function onKeydown(event: KeyboardEvent) {
  if (document.querySelector("[aria-modal='true']")) return;
  pager.onKeydown(event);
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <section class="compact-view" aria-label="Compact tracker" @wheel="pager.onWheel">
    <section class="compact-cover compact-run-cover compact-pager">
      <header class="compact-cover-head compact-pager-bar">
        <div class="compact-pager-title" :title="pages.length > 1 ? navigationHint : undefined">
          <strong>{{ page?.name || "Untitled page" }}</strong>
          <span v-if="pages.length > 1" class="compact-pager-count">{{ pager.index.value + 1 }}/{{ pages.length }}</span>
        </div>
        <div class="compact-run-cover-controls">
          <span :class="['compact-run-state', { paused }]" :title="paused ? runPausedLabel : 'Recording'">
            <i class="compact-run-light" aria-hidden="true"></i>
            <b class="compact-run-time">{{ sessionDuration }}</b>
            <span class="compact-run-state-label">{{ paused ? runPausedLabel : "Recording" }}</span>
          </span>
          <button
            type="button"
            :disabled="!canToggleRunPaused"
            :title="!canToggleRunPaused ? 'Run resumes when capture starts' : paused ? 'Resume this run' : 'Pause this run'"
            :aria-label="paused ? 'Resume Run' : 'Pause Run'"
            @click="emit('toggleRunPaused')"
          >{{ paused ? "Resume" : "Pause" }}</button>
          <button type="button" title="End run" aria-label="End Run" @click="emit('endRun')">End</button>
        </div>
      </header>

      <div class="compact-page-frame">
        <Transition :name="pager.direction.value > 0 ? 'compact-page-next' : 'compact-page-prev'" mode="out-in">
          <section v-if="page?.kind === 'zone'" :key="page.id" class="compact-page compact-zone-page" :aria-label="page.name">
            <header class="compact-zone-summary">
              <div>
                <span>{{ zonePhaseLabel }}</span>
                <strong>{{ state.satanicZone.current?.zone || "Waiting for zone update" }}</strong>
              </div>
              <div class="compact-zone-reset">
                <span>Resets in</span>
                <strong>{{ zoneCountdown }}</strong>
              </div>
              <button
                v-if="showRefresh"
                class="compact-zone-refresh-button"
                type="button"
                :disabled="refreshControl.disabled"
                :title="refreshControl.title"
                :aria-label="refreshControl.ariaLabel"
                @click="emit('refreshSatanicZone')"
              >
                <RefreshIcon />
              </button>
            </header>
            <p v-if="preparationDetail" class="compact-zone-empty" :data-preparation="state.satanicZone.refreshPreparation?.phase">{{ preparationDetail }}</p>
            <div v-if="state.satanicZone.current" class="compact-zone-effects">
              <div class="compact-zone-pros">
                <span>Pros</span>
                <p v-if="!state.satanicZone.current.pros.length">None found</p>
                <p v-for="effect in state.satanicZone.current.pros" :key="`pro-${effect.id}`"><strong>{{ effect.name }}</strong></p>
              </div>
              <div class="compact-zone-cons">
                <span>Cons</span>
                <p v-if="!state.satanicZone.current.cons.length">None found</p>
                <p v-for="effect in state.satanicZone.current.cons" :key="`con-${effect.id}`"><strong>{{ effect.name }}</strong></p>
              </div>
            </div>
            <p v-else class="compact-zone-empty">Zone details appear after the next update.</p>
          </section>
          <section
            v-else-if="page"
            :key="page.id"
            class="compact-page compact-cover-grid compact-tile-page"
            :data-tile-count="page.tiles.length"
            :aria-label="page.name"
          >
            <p v-if="!page.tiles.length" class="compact-page-empty">No tiles on this page yet. Add some in Customize compact mode.</p>
            <div
              v-for="tile in page.tiles"
              :key="tile.id"
              :class="['compact-tile', `compact-tile-${tile.kind}`, { 'compact-tile-link': linksToZone(tile) }]"
              :title="linksToZone(tile) ? 'Show Satanic Zone details' : tile.title"
              :role="linksToZone(tile) ? 'button' : undefined"
              :tabindex="linksToZone(tile) ? 0 : undefined"
              @click="linksToZone(tile) && pager.go(zonePageIndex)"
              @keydown.enter="linksToZone(tile) && pager.go(zonePageIndex)"
            >
              <span class="compact-tile-label">{{ tile.kind === "duration" ? "Duration" : tile.label }}</span>
              <strong class="compact-tile-value">{{ tile.value }}</strong>
              <small v-if="tile.detail" class="compact-tile-detail">{{ tile.detail }}</small>
              <button
                v-if="tile.kind === 'sz' && showRefresh"
                class="compact-zone-refresh-button"
                type="button"
                :disabled="refreshControl.disabled"
                :title="refreshControl.title"
                :aria-label="refreshControl.ariaLabel"
                @click="emit('refreshSatanicZone'); zonePageIndex >= 0 && pager.go(zonePageIndex)"
              >
                <RefreshIcon />
              </button>
            </div>
          </section>
        </Transition>

        <nav v-if="pages.length > 1" class="compact-page-dots" aria-label="Compact pages">
          <button
            v-for="(candidate, index) in pages"
            :key="candidate.id"
            type="button"
            :class="{ active: index === pager.index.value }"
            :aria-label="`Show ${candidate.name} page`"
            :aria-current="index === pager.index.value ? 'page' : undefined"
            :title="candidate.name"
            @click="pager.go(index)"
          ></button>
        </nav>
      </div>
    </section>
  </section>
</template>
