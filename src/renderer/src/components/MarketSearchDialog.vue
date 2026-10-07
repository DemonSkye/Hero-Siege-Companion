<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  MARKET_SEARCH_MAX_STAT_FILTERS,
  marketStatOption,
  type MarketListing,
} from "../../../shared/market-search";
import type { ItemTimelineEntry } from "../../../shared/stats";
import { eventValue } from "../lib/dom-events";
import { formatNumber } from "../lib/format";
import {
  marketStatSuggestions,
  type MarketSearchPhase,
  type MarketStatFilterDraft,
} from "../lib/market-search-runtime";
import { useModalFocus } from "../lib/modal-focus";
import type { MarketReadiness } from "../../../shared/market-readiness";
import MarketReadinessStatus from "./MarketReadinessStatus.vue";

const props = defineProps<{
  item: Pick<ItemTimelineEntry, "label" | "rarity">;
  readiness: MarketReadiness;
  minSockets: number | null;
  statFilters: MarketStatFilterDraft[];
  phase: MarketSearchPhase;
  listings: MarketListing[];
  totalMatches: number | null;
  errorMessage: string;
  resultObservedAt: number | null;
  resultCached: boolean;
  canSearch: boolean;
  cooldownRemainingSeconds: number;
}>();

const emit = defineEmits<{
  close: [];
  updateMinSockets: [value: number | null];
  addStatFilter: [statId: number];
  updateStatFilter: [key: string, patch: Partial<Pick<MarketStatFilterDraft, "statId" | "minimum">>];
  removeStatFilter: [key: string];
  search: [];
}>();

const dialog = ref<HTMLElement | null>(null);
const statSearchInput = ref<HTMLInputElement | null>(null);
const statPickerOpen = ref(false);
const statQuery = ref("");
const { handleModalFocusKeydown } = useModalFocus(dialog);
const statSuggestions = computed(() => marketStatSuggestions(
  statQuery.value,
  props.statFilters.flatMap((filter) => filter.statId === null ? [] : [filter.statId]),
));

function nullableNumber(event: Event): number | null {
  const value = eventValue(event);
  return value === "" ? null : Number(value);
}

function preventNonNumericStatKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  if (!/[0-9.-]/u.test(event.key)) event.preventDefault();
}

function preventNonNumericStatPaste(event: ClipboardEvent): void {
  const pasted = event.clipboardData?.getData("text").trim() ?? "";
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(pasted)) event.preventDefault();
}

async function toggleStatPicker(): Promise<void> {
  statPickerOpen.value = !statPickerOpen.value;
  if (!statPickerOpen.value) {
    statQuery.value = "";
    return;
  }
  await nextTick();
  statSearchInput.value?.focus();
}

function selectStat(statId: number): void {
  emit("addStatFilter", statId);
  statQuery.value = "";
  statPickerOpen.value = false;
}

function selectFirstStatSuggestion(): void {
  const [firstSuggestion] = statSuggestions.value;
  if (firstSuggestion) selectStat(firstSuggestion.statId);
}

function selectedStatName(statId: number | null): string {
  return statId === null ? "Unknown stat" : marketStatOption(statId)?.name ?? "Unknown stat";
}
</script>

<template>
  <div class="modal-backdrop market-search-backdrop" @click.self="emit('close')" @keydown="handleModalFocusKeydown" @keydown.esc="emit('close')">
    <section ref="dialog" class="settings-panel market-search-dialog" role="dialog" aria-modal="true" aria-labelledby="market-search-title" tabindex="-1">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Price check</p>
          <h2 id="market-search-title">{{ item.label }}</h2>
          <p>Current listings, lowest price first.</p>
        </div>
        <button class="settings-close" type="button" aria-label="Close market search" @click="emit('close')">×</button>
      </div>

      <form class="market-search-body" :aria-busy="phase === 'searching'" @submit.prevent="emit('search')">
        <MarketReadinessStatus :readiness="readiness" />
        <div class="market-search-base">
          <span>Base item</span>
          <strong>{{ item.label }}</strong>
          <small>{{ item.rarity }}</small>
        </div>

        <label class="market-search-field market-search-sockets">
          <span>Minimum sockets <small>Optional</small></span>
          <input
            :value="minSockets ?? ''"
            type="number"
            min="1"
            max="6"
            step="1"
            placeholder="Any"
            @input="emit('updateMinSockets', nullableNumber($event))"
          />
        </label>

        <section class="market-search-stats" aria-labelledby="market-search-stats-title">
          <div class="market-search-section-heading">
            <div>
              <strong id="market-search-stats-title">Comparable stats</strong>
              <small>Drops do not expose rolled values here. Add the minimums you want to compare.</small>
            </div>
            <button
              class="icon-button ghost"
              type="button"
              :aria-expanded="statPickerOpen"
              aria-controls="market-search-stat-picker"
              :disabled="statFilters.length >= MARKET_SEARCH_MAX_STAT_FILTERS"
              @click="toggleStatPicker"
            >{{ statPickerOpen ? "Cancel" : "Add stat" }}</button>
          </div>

          <div
            v-if="statPickerOpen && statFilters.length < MARKET_SEARCH_MAX_STAT_FILTERS"
            id="market-search-stat-picker"
            class="market-search-stat-picker item-filter-search-wrap"
          >
            <label class="sr-only" for="market-search-stat-query">Search market stats</label>
            <input
              id="market-search-stat-query"
              ref="statSearchInput"
              v-model="statQuery"
              type="search"
              placeholder="Search market stats"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter.prevent="selectFirstStatSuggestion"
            />
            <div v-if="statQuery.trim().length >= 3 && statSuggestions.length" class="item-filter-suggestions">
              <button v-for="option in statSuggestions" :key="option.statId" type="button" @click="selectStat(option.statId)">
                {{ option.name }}
              </button>
            </div>
            <p v-else-if="statQuery.trim().length > 0 && statQuery.trim().length < 3" class="item-filter-search-hint">
              Type at least 3 characters for suggestions.
            </p>
            <p v-else-if="statQuery.trim().length >= 3" class="item-filter-search-hint">No matching known stats.</p>
          </div>

          <div v-if="statFilters.length" class="market-search-stat-list">
            <div v-for="filter in statFilters" :key="filter.key" class="market-search-stat-row">
              <div class="market-search-stat-name">
                <span>Stat</span>
                <strong>{{ selectedStatName(filter.statId) }}</strong>
              </div>
              <label>
                <span>Minimum</span>
                <input
                  :value="filter.minimum ?? ''"
                  type="number"
                  inputmode="decimal"
                  step="any"
                  placeholder="Value"
                  @keydown="preventNonNumericStatKey"
                  @paste="preventNonNumericStatPaste"
                  @input="emit('updateStatFilter', filter.key, { minimum: nullableNumber($event) })"
                />
              </label>
              <button class="shopping-remove market-search-stat-remove" type="button" :aria-label="`Remove ${selectedStatName(filter.statId)}`" @click="emit('removeStatFilter', filter.key)">×</button>
            </div>
          </div>
          <p v-else class="empty-copy">No stat minimums. Search by base item only.</p>
        </section>

        <div v-if="phase === 'searching'" class="market-search-state" role="status">Searching the market…</div>
        <div v-else-if="phase === 'error'" class="market-search-state market-search-error" role="alert">{{ errorMessage }}</div>
        <section v-else-if="phase === 'success'" class="market-search-results" aria-live="polite">
          <div class="market-search-section-heading">
            <strong>Lowest prices</strong>
            <small v-if="totalMatches !== null">{{ totalMatches }} matching listing{{ totalMatches === 1 ? '' : 's' }}</small>
          </div>
          <p v-if="resultObservedAt !== null" class="market-search-cache-note">
            {{ resultCached ? "Cached result" : "Updated result" }} · observed {{ new Date(resultObservedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
          </p>
          <div v-if="listings.length" class="market-search-price-grid">
            <article v-for="(listing, index) in listings.slice(0, 2)" :key="`${listing.price}-${index}`">
              <span>{{ index === 0 ? "Lowest" : "Second-lowest" }}</span>
              <strong>{{ formatNumber(listing.price) }} gold</strong>
            </article>
          </div>
          <p v-else class="empty-copy">No matching listings found.</p>
        </section>

        <p v-if="phase === 'idle'" class="market-search-cache-note" role="note">
          Npcap capture supplies the current account and mode context. Market requests use a separate direct HTTPS connection and never modify the game’s traffic.
        </p>

        <footer class="market-search-actions">
          <small>Price ascending · up to 2 results</small>
          <button class="icon-button primary" type="submit" :disabled="!canSearch">
            {{ phase === "searching" ? "Searching…" : cooldownRemainingSeconds > 0 ? `Search in ${cooldownRemainingSeconds}s` : "Search market" }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>
