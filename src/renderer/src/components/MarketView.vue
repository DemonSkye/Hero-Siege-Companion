<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { MARKET_SEARCH_MAX_STAT_FILTERS, MARKET_SEARCH_LISTING_LIMIT, marketStatOption, type MarketListing } from "../../../shared/market-search";
import type { MarketReadiness } from "../../../shared/market-readiness";
import { marketItemSuggestions, type MarketItemOption, type SavedMarketItem } from "../lib/market-items";
import { marketStatSuggestions, type MarketSearchPhase, type MarketStatFilterDraft } from "../lib/market-search-runtime";
import { formatNumber } from "../lib/format";
import MarketReadinessStatus from "./MarketReadinessStatus.vue";

const props = defineProps<{
  readiness: MarketReadiness;
  item: { label: string; rarity: string } | null;
  minSockets: number | null;
  statFilters: MarketStatFilterDraft[];
  phase: MarketSearchPhase;
  listings: MarketListing[];
  totalMatches: number | null;
  returnedCount: number | null;
  errorMessage: string;
  resultObservedAt: number | null;
  resultCached: boolean;
  canSearch: boolean;
  canSave: boolean;
  inFlight: boolean;
  cooldown: number;
  savedItems: SavedMarketItem[];
  editingId: string | null;
  message: string;
  canUndo: boolean;
  saveStatus: "saved" | "saving" | "error";
}>();
const savedName = defineModel<string>("savedName", { required: true });
const emit = defineEmits<{
  selectItem: [item: MarketItemOption];
  newSearch: [];
  loadSaved: [id: string];
  save: [asNew: boolean];
  deleteSaved: [id: string];
  undo: [];
  retrySave: [];
  updateMinSockets: [value: number | null];
  addStatFilter: [statId: number];
  updateStatFilter: [key: string, patch: { minimum: number | null }];
  removeStatFilter: [key: string];
  search: [];
}>();
const itemQuery = ref("");
const itemPickerOpen = ref(false);
const itemInput = ref<HTMLInputElement | null>(null);
const statQuery = ref("");
const savedQuery = ref("");
const itemSuggestions = computed(() => marketItemSuggestions(itemQuery.value));
const statSuggestions = computed(() => marketStatSuggestions(statQuery.value,
  props.statFilters.flatMap((filter) => filter.statId === null ? [] : [filter.statId])));
const savedItems = computed(() => props.savedItems.filter((entry) => entry.name.toLowerCase().includes(savedQuery.value.trim().toLowerCase())));
const summary = computed(() => [
  props.minSockets === null ? "Any sockets" : `${props.minSockets}+ sockets`,
  ...props.statFilters.map((filter) => `${marketStatOption(filter.statId ?? -1)?.name ?? "Choose stat"} ≥ ${filter.minimum ?? "…"}`),
]);
function numericValue(event: Event): number | null {
  const input = event.target as HTMLInputElement;
  return input.validity.badInput ? NaN : input.value === "" ? null : Number(input.value);
}
async function chooseItem(item: MarketItemOption): Promise<void> {
  emit("selectItem", item);
  itemPickerOpen.value = false;
  itemQuery.value = "";
  await nextTick();
  document.getElementById("market-sockets")?.focus();
}
async function load(id: string): Promise<void> {
  emit("loadSaved", id);
  itemPickerOpen.value = false;
  itemQuery.value = "";
  statQuery.value = "";
  await nextTick();
  (props.item ? document.getElementById("market-sockets") : itemInput.value)?.focus();
}
async function newSearch(): Promise<void> {
  emit("newSearch");
  itemPickerOpen.value = false;
  itemQuery.value = "";
  statQuery.value = "";
  await nextTick();
  itemInput.value?.focus();
}
function chooseStat(statId: number): void {
  emit("addStatFilter", statId);
  statQuery.value = "";
  void nextTick(() => document.querySelector<HTMLInputElement>(".market-workspace .market-stat-row:last-child input")?.focus());
}
</script>

<template>
  <section class="market-workspace" aria-labelledby="market-title">
    <header class="market-heading">
      <div><p class="eyebrow">Saved item searches</p><h2 id="market-title">Market</h2><p>Choose an item, set your minimums, and search when you need to.</p></div>
      <button class="icon-button ghost" type="button" @click="newSearch">New search</button>
    </header>
    <MarketReadinessStatus :readiness="readiness" />
    <div class="market-layout">
      <aside class="panel market-saved" aria-labelledby="market-saved-title">
        <h3 id="market-saved-title">Saved items <small>{{ savedItems.length }}</small></h3>
        <label for="market-saved-query">Find saved item</label>
        <input id="market-saved-query" v-model="savedQuery" type="search" placeholder="Filter saved names" />
        <p v-if="!savedItems.length" class="empty-copy">{{ savedQuery ? 'No saved names match.' : 'Save an item with filters to return to it here.' }}</p>
        <ul class="market-saved-list">
          <li v-for="entry in savedItems" :key="entry.id" :class="{ selected: editingId === entry.id }">
            <button class="market-saved-load" type="button" :aria-pressed="editingId === entry.id" @click="load(entry.id)">
              <strong>{{ entry.name || 'Untitled legacy entry' }}</strong>
              <small>{{ entry.request ? `${entry.request.minSockets ?? 'Any'} sockets · ${entry.request.statFilters.length} stat minimums` : 'Choose catalog item to repair' }}</small>
            </button>
            <button class="icon-button ghost" type="button" :aria-label="`Delete saved item ${entry.name}`" @click="emit('deleteSaved', entry.id)">×</button>
          </li>
        </ul>
        <button v-if="canUndo" class="icon-button ghost" type="button" @click="emit('undo')">Undo delete</button>
        <p>Loading a saved item only fills the form. Press Search to fetch prices.</p>
      </aside>
      <div class="market-detail">
        <form class="panel market-editor" :aria-busy="inFlight" @submit.prevent="emit('search')">
          <h3>{{ editingId ? 'Edit saved filters' : 'Item and filters' }}</h3>
          <div v-if="item" class="market-chosen-item"><strong>{{ item.label }}</strong><small>{{ item.rarity }}</small><button class="icon-button ghost" type="button" :aria-expanded="itemPickerOpen" @click="itemPickerOpen = !itemPickerOpen; nextTick(() => itemInput?.focus())">Change item</button></div>
          <div v-if="!item || itemPickerOpen" class="market-item-picker">
            <label for="market-item-query">Choose catalog item</label>
            <input id="market-item-query" ref="itemInput" v-model="itemQuery" type="search" placeholder="Search by item name" autocomplete="off" @keydown.enter.prevent="itemSuggestions[0] && chooseItem(itemSuggestions[0])" />
            <ul class="market-options" aria-label="Catalog item suggestions">
              <li v-for="option in itemSuggestions" :key="option.key"><button type="button" @click="chooseItem(option)">{{ option.name }} <small>{{ option.typeLabel }} · {{ option.key.startsWith('unique:') ? 'Unique' : 'Normal' }}</small></button></li>
            </ul>
            <p v-if="!itemSuggestions.length">No supported catalog item matches. Try another name.</p>
          </div>
          <fieldset :disabled="!item">
            <legend>Search filters</legend>
            <p>Item, minimum sockets, and stat minimums are supported. Other game filters are not available yet.</p>
            <label for="market-sockets">Minimum sockets</label>
            <input id="market-sockets" :value="minSockets ?? ''" type="number" min="1" max="6" step="1" placeholder="Any" @input="emit('updateMinSockets', numericValue($event))" />
            <div class="market-stat-list">
              <div v-for="filter in statFilters" :key="filter.key" class="market-stat-row">
                <label :for="filter.key">{{ marketStatOption(filter.statId ?? -1)?.name }} minimum</label>
                <input :id="filter.key" :value="filter.minimum ?? ''" type="number" step="any" min="-1000000000" max="1000000000" required placeholder="Minimum" @input="emit('updateStatFilter', filter.key, { minimum: numericValue($event) })" />
                <button class="icon-button ghost" type="button" :aria-label="`Remove ${marketStatOption(filter.statId ?? -1)?.name}`" @click="emit('removeStatFilter', filter.key)">×</button>
              </div>
            </div>
            <label for="market-stat-query">Add stat minimum</label>
            <input id="market-stat-query" v-model="statQuery" type="search" :disabled="statFilters.length >= MARKET_SEARCH_MAX_STAT_FILTERS" placeholder="Type at least 3 characters" autocomplete="off" @keydown.enter.prevent="statSuggestions[0] && chooseStat(statSuggestions[0].statId)" />
            <ul v-if="statSuggestions.length" class="market-options" aria-label="Stat suggestions"><li v-for="option in statSuggestions" :key="option.statId"><button type="button" @click="chooseStat(option.statId)">{{ option.name }}</button></li></ul>
            <p v-else-if="statQuery.trim().length >= 3">No additional supported stats match.</p>
            <p v-if="statFilters.length >= MARKET_SEARCH_MAX_STAT_FILTERS">All {{ MARKET_SEARCH_MAX_STAT_FILTERS }} stat slots are in use. Remove one to add another.</p>
          </fieldset>
          <div v-if="item" class="market-filter-summary" aria-label="Active filters"><span v-for="text in summary" :key="text">{{ text }}</span></div>
          <p v-if="item && !canSave" role="status">Enter valid socket and stat minimums before saving or searching.</p>
          <div class="market-save-controls">
            <label for="market-saved-name">Saved name <small>Optional</small></label>
            <input id="market-saved-name" v-model="savedName" placeholder="Use the item name" />
            <div class="market-action-row"><button class="icon-button ghost" type="button" :disabled="!canSave" @click="emit('save', false)">{{ editingId ? 'Save changes' : 'Save item and filters' }}</button><button v-if="editingId" class="icon-button ghost" type="button" :disabled="!canSave" @click="emit('save', true)">Save as new</button></div>
          </div>
          <p v-if="message" role="status">{{ message }}</p>
          <p v-if="saveStatus === 'error'" class="market-search-error" role="alert">Local saving failed. Keep Companion open and retry.<button class="icon-button ghost" type="button" @click="emit('retrySave')">Retry save</button></p>
          <p v-else-if="saveStatus === 'saving'" role="status">Saving locally…</p>
          <footer class="market-action-row">
            <small>{{ inFlight ? 'One request is in flight. Filter edits discard its result; wait for it to finish before searching again.' : cooldown > 0 ? `Next search available in ${cooldown}s.` : 'Price ascending · first page only' }}</small>
            <button class="icon-button primary" type="submit" :disabled="!canSearch">{{ inFlight ? 'Searching…' : cooldown > 0 ? `Search in ${cooldown}s` : 'Search market' }}</button>
          </footer>
        </form>
        <section class="panel market-results" aria-labelledby="market-results-title" aria-live="polite">
          <h3 id="market-results-title">Price results</h3>
          <p v-if="phase === 'searching'" role="status">Searching current listings…</p>
          <p v-else-if="phase === 'error'" class="market-search-error" role="alert">{{ errorMessage }}</p>
          <template v-else-if="phase === 'success'">
            <p v-if="resultObservedAt !== null">{{ resultCached ? 'Cached' : 'Fetched' }} at {{ new Date(resultObservedAt).toLocaleTimeString() }}. Prices can change.</p>
            <p v-if="totalMatches !== null">Server returned count: {{ totalMatches }}. This may describe a bounded page.</p>
            <p v-if="returnedCount !== null">Showing {{ listings.length }} price listings from {{ returnedCount }} returned page rows. Unreadable and item-priced listings may be omitted.</p>
            <table v-if="listings.length" class="market-price-table">
              <caption>{{ item?.label }} · returned page, lowest price first</caption>
              <thead><tr><th scope="col">Listing</th><th scope="col">Price</th><th scope="col">Price per unit</th></tr></thead>
              <tbody><tr v-for="(listing, index) in listings" :key="index"><th scope="row">{{ index + 1 }}</th><td>{{ formatNumber(listing.price) }} gold</td><td>{{ listing.unitPrice !== undefined ? `${formatNumber(listing.unitPrice)} gold per unit` : 'Unavailable' }}</td></tr></tbody>
            </table>
            <p v-else class="empty-copy">{{ returnedCount !== null && returnedCount > 0 ? 'The returned page had no readable price listings.' : 'No matching price listings were returned.' }} Try fewer minimums, then press Search.</p>
            <p>Up to {{ MARKET_SEARCH_LISTING_LIMIT }} gold-price listings from the first page. Matching relies on the server; rolled stats and socket capacity are not reconstructed.</p>
          </template>
          <p v-else-if="!readiness.canSearch">Search is waiting for current session evidence. You can edit and save filters now; see readiness above for the next action.</p>
          <p v-else>Choose an item and press Search. Saved filters never fetch prices automatically.</p>
        </section>
      </div>
    </div>
  </section>
</template>
