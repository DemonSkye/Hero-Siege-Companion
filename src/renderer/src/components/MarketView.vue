<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { MARKET_SEARCH_MAX_STAT_FILTERS, MARKET_SEARCH_LISTING_LIMIT, marketStatOption, marketStatMinimumIssue, type MarketListing } from "../../../shared/market-search";
import { marketStatFieldName, marketStatRole } from "../../../shared/market-stat-capabilities";
import type { MarketReadiness } from "../../../shared/market-readiness";
import { marketItemSuggestions, type MarketItemOption, type SavedMarketItem } from "../lib/market-items";
import { marketStatSuggestions, type MarketSearchPhase, type MarketStatFilterDraft } from "../lib/market-search-runtime";
import { formatNumber } from "../lib/format";
import MarketReadinessStatus from "./MarketReadinessStatus.vue";
import { marketReadinessExplainsError } from "../lib/market-readiness-display";
import MarketListingDetails from "./MarketListingDetails.vue";
import { itemStatDefinition } from "../../../shared/item-stat-ranges";
import { ITEM_BASE_STAT_CATALOG, itemBaseStatDefinition, itemBaseStatMetadata } from "../../../shared/item-base-stat-catalog";
import { marketBaseStatValue, marketTriggeredSkillDescription, marketTriggeredSkillStatIds } from "../lib/market-stat-display";

// Unit prices can be fractional. Preserve significant digits, including small
// nonzero prices, while using the same default locale as other app numbers.
const unitPriceFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 });

const props = defineProps<{
  readiness: MarketReadiness;
  item: { label: string; rarity: string } | null;
  itemKey: string | null;
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
const readinessExplainsError = computed(() => marketReadinessExplainsError(props.readiness, props.errorMessage));
const itemSuggestions = computed(() => marketItemSuggestions(itemQuery.value));
const statSuggestions = computed(() => marketStatSuggestions(statQuery.value,
  props.statFilters.flatMap((filter) => filter.statId === null ? [] : [filter.statId])));
const savedItems = computed(() => props.savedItems.filter((entry) => entry.name.toLowerCase().includes(savedQuery.value.trim().toLowerCase())));
const catalogDefinition = computed(() => itemBaseStatDefinition(props.itemKey));
const rollDefinition = computed(() => itemStatDefinition(props.itemKey));
const catalogSkill = computed(() => marketTriggeredSkillDescription(rollDefinition.value,
  rollDefinition.value?.stats.map(stat => ({ statId: stat.statId, value: stat.minimum })) ?? []));
const catalogStats = computed(() => catalogDefinition.value?.stats.filter(stat => !catalogSkill.value
  || !marketTriggeredSkillStatIds(rollDefinition.value).includes(stat.statId)) ?? []);
const showCatalog = computed(() => props.item !== null);
const blockedFilters = computed(() => props.statFilters.filter(filter => filter.statId !== null && marketStatMinimumIssue(filter.statId, props.itemKey)));
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
  if (marketStatMinimumIssue(statId, props.itemKey)) return;
  emit("addStatFilter", statId);
  statQuery.value = "";
  void nextTick(() => document.querySelector<HTMLInputElement>(".market-workspace .market-stat-row:last-child input")?.focus());
}
</script>

<template>
  <section class="market-workspace" aria-labelledby="market-title">
    <header class="market-heading">
      <h2 id="market-title">Market</h2>
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
              <small>{{ entry.request || entry.criteria ? `${(entry.criteria ?? entry.request)?.minSockets ?? 'Any'} sockets · ${(entry.criteria ?? entry.request)?.statFilters.length} stat minimums` : 'Choose catalog item to repair' }}</small>
            </button>
            <button class="icon-button ghost" type="button" :aria-label="`Delete saved item ${entry.name}`" @click="emit('deleteSaved', entry.id)">×</button>
          </li>
        </ul>
        <button v-if="canUndo" class="icon-button ghost" type="button" @click="emit('undo')">Undo delete</button>
        <p>Loading a saved item only fills the form. Press Search to fetch prices.</p>
      </aside>
      <div class="market-detail">
        <form class="panel market-editor" :aria-busy="inFlight" @submit.prevent="emit('search')">
          <div v-if="item" class="market-chosen-item">
            <div><strong>{{ item.label }}</strong><small>{{ item.rarity }}</small></div>
            <button class="icon-button ghost" type="button" :aria-expanded="itemPickerOpen" @click="itemPickerOpen = !itemPickerOpen; nextTick(() => itemInput?.focus())">Change item</button>
          </div>
          <div v-if="!item || itemPickerOpen" class="market-item-picker">
            <label for="market-item-query">Choose catalog item</label>
            <input id="market-item-query" ref="itemInput" v-model="itemQuery" type="search" placeholder="Search by item name" autocomplete="off" @keydown.enter.prevent="itemSuggestions[0] && chooseItem(itemSuggestions[0])" />
            <ul class="market-options" aria-label="Catalog item suggestions">
              <li v-for="option in itemSuggestions" :key="option.key"><button type="button" @click="chooseItem(option)">{{ option.name }} <small>{{ option.typeLabel }} · {{ option.repository }}{{ option.searchUnavailable ? ' · Search encoding pending' : '' }}</small></button></li>
            </ul>
            <p v-if="!itemSuggestions.length">No supported catalog item matches. Try another name.</p>
          </div>
          <div class="market-filter-layout" :class="{ 'has-catalog': showCatalog }">
          <fieldset :disabled="!item" aria-labelledby="market-filters-title">
            <h3 id="market-filters-title">Search filters</h3>
            <label for="market-sockets">Minimum sockets</label>
            <input id="market-sockets" :value="minSockets ?? ''" type="number" min="1" max="6" step="1" placeholder="Any" @input="emit('updateMinSockets', numericValue($event))" />
            <div class="market-stat-list">
              <div v-for="filter in statFilters" :key="filter.key" class="market-stat-row">
                <label :for="filter.key">{{ marketStatOption(filter.statId ?? -1)?.name }} minimum <small v-if="marketStatMinimumIssue(filter.statId ?? -1, itemKey)">Unsupported saved criterion</small></label>
                <input :id="filter.key" :value="filter.minimum ?? ''" type="number" step="any" min="-1000000000" max="1000000000" required placeholder="Minimum" @input="emit('updateStatFilter', filter.key, { minimum: numericValue($event) })" />
                <button class="icon-button ghost" type="button" :aria-label="`Remove ${marketStatOption(filter.statId ?? -1)?.name}`" @click="emit('removeStatFilter', filter.key)">×</button>
              </div>
            </div>
            <label for="market-stat-query">Add stat minimum</label>
            <input id="market-stat-query" v-model="statQuery" type="search" :disabled="statFilters.length >= MARKET_SEARCH_MAX_STAT_FILTERS" placeholder="Type at least 3 characters" autocomplete="off" @keydown.enter.prevent="statSuggestions[0] && chooseStat(statSuggestions[0].statId)" />
            <ul v-if="statSuggestions.length" class="market-options" aria-label="Stat suggestions"><li v-for="option in statSuggestions" :key="option.statId"><button type="button" :disabled="Boolean(marketStatMinimumIssue(option.statId, itemKey))" @click="chooseStat(option.statId)">{{ option.name }}<small v-if="marketStatMinimumIssue(option.statId, itemKey)">{{ marketStatMinimumIssue(option.statId, itemKey) }}</small><small v-else-if="option.description">{{ option.description }}</small></button></li></ul>
            <p v-else-if="statQuery.trim().length >= 3">No additional supported stats match.</p>
            <p v-if="statFilters.length >= MARKET_SEARCH_MAX_STAT_FILTERS">All {{ MARKET_SEARCH_MAX_STAT_FILTERS }} stat slots are in use. Remove one to add another.</p>
          </fieldset>
          <section v-if="showCatalog" class="market-catalog-ranges" aria-labelledby="market-ranges-title">
            <header class="market-stat-card-heading"><h3 id="market-ranges-title">{{ item?.label }}</h3><small>{{ item?.rarity }} · Base stat ranges</small></header>
            <dl v-if="catalogStats.length" class="market-range-list">
              <div v-for="stat in catalogStats" :key="stat.statId">
                <dt :title="marketStatRole(stat.statId)?.detail">{{ marketStatFieldName(stat.statId, itemBaseStatMetadata(stat.statId)?.name ?? `Stat ${stat.statId}`) }}</dt>
                <dd>[{{ marketBaseStatValue(stat, itemKey) }}]</dd>
              </div>
            </dl>
            <p v-else class="empty-copy">No fixed base stat values retained for this definition.</p>
            <p v-if="catalogSkill" class="market-triggered-skill">{{ catalogSkill }}</p>
            <p v-if="itemKey === 'unique:10:0:92'" class="market-set-effect">Orbital Gravity set bonus: Orbital Damage increased by 30%</p>
            <footer><small>Build {{ ITEM_BASE_STAT_CATALOG.steamBuild }} · Base values, not listing rolls</small><small>Experimental: current-build parity unverified.</small><small v-if="!catalogDefinition?.complete">Some base values are dynamic or remain undecoded.</small></footer>
          </section>
          </div>
          <div v-if="item" class="market-filter-summary" aria-label="Active filters"><span v-for="text in summary" :key="text">{{ text }}</span></div>
          <p v-if="item && !canSave" role="status">Enter valid socket and stat minimums before saving or searching.</p>
          <p v-if="blockedFilters.length" class="market-search-error" role="status">These saved criteria are preserved, but cannot be sent as numeric minimums. Remove them to search.<span v-for="filter in blockedFilters" :key="filter.key"> {{ marketStatOption(filter.statId!)?.name }}: {{ marketStatMinimumIssue(filter.statId!, itemKey) }}</span></p>
          <div class="market-save-controls">
            <label for="market-saved-name">Saved name <small>Optional</small></label>
            <input id="market-saved-name" v-model="savedName" placeholder="Use the item name" />
            <div class="market-action-row"><button class="icon-button ghost" type="button" :disabled="!canSave" @click="emit('save', false)">{{ editingId ? 'Save changes' : 'Save item and filters' }}</button><button v-if="editingId" class="icon-button ghost" type="button" :disabled="!canSave" @click="emit('save', true)">Save as new</button></div>
          </div>
          <p v-if="message" role="status">{{ message }}</p>
          <p v-if="saveStatus === 'error'" class="market-search-error" role="alert">Local saving failed. Keep Companion open and retry.<button class="icon-button ghost" type="button" @click="emit('retrySave')">Retry save</button></p>
          <p v-else-if="saveStatus === 'saving'" role="status">Saving locally…</p>
          <footer class="market-action-row">
            <small v-if="inFlight || cooldown > 0">{{ inFlight ? 'Searching. Editing filters discards the pending result.' : `Next search available in ${cooldown}s.` }}</small>
            <button class="icon-button primary" type="submit" :disabled="!canSearch">{{ inFlight ? 'Searching…' : cooldown > 0 ? `Search in ${cooldown}s` : 'Search market' }}</button>
          </footer>
        </form>
        <section class="panel market-results" aria-labelledby="market-results-title" aria-live="polite">
          <div class="market-results-heading"><h3 id="market-results-title">Price results</h3><small>Price ascending · first page only</small></div>
          <p v-if="phase === 'searching'" role="status">Searching current listings…</p>
          <template v-else-if="phase === 'error'"><p v-if="!readinessExplainsError" class="market-search-error" role="alert">{{ errorMessage }}</p></template>
          <template v-else-if="phase === 'success'">
            <table v-if="listings.length" class="market-price-table">
              <thead><tr><th scope="col">Listing</th><th scope="col">Price</th><th scope="col">Price per unit</th><th scope="col">Variant and stats</th></tr></thead>
              <tbody>
                <tr v-for="(listing, index) in listings" :key="index">
                  <th scope="row" data-label="Listing">{{ index + 1 }}</th>
                  <td class="market-listing-price" data-label="Price">{{ formatNumber(listing.price) }} gold</td>
                  <td class="market-unit-price" data-label="Price per unit">{{ listing.unitPrice !== undefined ? `${unitPriceFormatter.format(listing.unitPrice)} gold per unit` : 'Unavailable' }}</td>
                  <td class="market-listing-item"><MarketListingDetails :item="listing.item" /></td>
                </tr>
              </tbody>
            </table>
            <p v-else class="empty-copy">{{ returnedCount !== null && returnedCount > 0 ? 'The returned page had no readable price listings.' : 'No matching price listings were returned.' }} Try fewer minimums, then press Search.</p>
            <footer class="market-results-footer">
              <details class="market-result-details">
                <summary>Result limits</summary>
                <p>Up to {{ MARKET_SEARCH_LISTING_LIMIT }} gold-price listings from the first page. Item-priced and unreadable rows are omitted. Matching relies on the server.</p>
                <p v-if="returnedCount !== null">{{ listings.length }} shown · {{ returnedCount }} returned rows<span v-if="totalMatches !== null"> · server count {{ totalMatches }}</span>.</p>
              </details>
              <small v-if="resultObservedAt !== null">{{ resultCached ? 'Cached' : 'Fetched' }} at {{ new Date(resultObservedAt).toLocaleTimeString() }}. Prices can change.</small>
            </footer>
          </template>
          <p v-else-if="!readiness.canSearch">Search is waiting for current session evidence. You can edit and save filters now; see readiness above for the next action.</p>
          <p v-else>Choose an item and press Search. Saved filters never fetch prices automatically.</p>
        </section>
      </div>
    </div>
  </section>
</template>
