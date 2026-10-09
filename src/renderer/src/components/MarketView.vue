<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { MARKET_SEARCH_MAX_STAT_FILTERS, MARKET_SEARCH_LISTING_LIMIT, marketStatOption, marketStatMinimumIssue, type MarketListing } from "../../../shared/market-search";
import type { MarketReadiness } from "../../../shared/market-readiness";
import { marketItemSuggestions, type MarketItemOption, type SavedMarketItem } from "../lib/market-items";
import { marketStatSuggestions, type MarketSearchPhase, type MarketStatFilterDraft } from "../lib/market-search-runtime";
import { formatNumber } from "../lib/format";
import MarketReadinessStatus from "./MarketReadinessStatus.vue";
import { marketReadinessExplainsError } from "../lib/market-readiness-display";
import MarketListingDetails from "./MarketListingDetails.vue";
import UiButton from "./UiButton.vue";
import { itemStatDefinition } from "../../../shared/item-stat-ranges";
import { itemBaseSocketRange } from "../../../shared/item-socket-capacity";
import { ITEM_BASE_STAT_CATALOG, itemBaseStatDefinition } from "../../../shared/item-base-stat-catalog";
import { marketCatalogStatRows, marketTriggeredSkillDescription, marketTriggeredSkillStatIds } from "../lib/market-stat-display";

// Unit prices can be fractional. Preserve significant digits, including small
// nonzero prices, while using the same default locale as other app numbers.
const unitPriceFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 });

const props = defineProps<{
  readiness: MarketReadiness;
  item: { label: string; rarity: string } | null;
  itemKey: string | null;
  minSockets: number | null;
  maxSockets?: number | null;
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
  updateMaxSockets: [value: number | null];
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
const catalogStats = computed(() => marketCatalogStatRows(catalogDefinition.value?.stats.filter(stat => !catalogSkill.value
  || !marketTriggeredSkillStatIds(rollDefinition.value).includes(stat.statId)) ?? [], props.itemKey));
const showCatalog = computed(() => props.item !== null);
const blockedFilters = computed(() => props.statFilters.filter(filter => filter.statId !== null && marketStatMinimumIssue(filter.statId, props.itemKey)));
const socketBaseRange = computed(() => itemBaseSocketRange(props.itemKey));
const optionalSocketsOpen = ref(false);
watch(() => props.itemKey, () => { optionalSocketsOpen.value = false; statQuery.value = ""; itemQuery.value = ""; });
const hasSocketCriteria = computed(() => props.minSockets !== null || props.maxSockets != null);
const showSocketControls = computed(() => socketBaseRange.value !== null || optionalSocketsOpen.value || hasSocketCriteria.value);
function socketSummary(minimum?: number | null, maximum?: number | null): string {
  if (Number.isNaN(minimum) || Number.isNaN(maximum)) return "Invalid sockets";
  if (minimum != null && maximum != null) return `${minimum}–${maximum} sockets`;
  if (minimum != null) return `${minimum}+ sockets`;
  return maximum != null ? `Up to ${maximum} sockets` : "Any sockets";
}
const summary = computed(() => [
  ...(showSocketControls.value ? [socketSummary(props.minSockets, props.maxSockets)] : []),
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
  statQuery.value = "";
  savedQuery.value = "";
  optionalSocketsOpen.value = false;
  await nextTick();
  (document.getElementById("market-sockets") ?? document.getElementById("market-stat-query"))?.focus();
}
async function load(id: string): Promise<void> {
  emit("loadSaved", id);
  itemPickerOpen.value = false;
  itemQuery.value = "";
  statQuery.value = "";
  await nextTick();
  (props.item ? document.getElementById("market-sockets") ?? document.getElementById("market-stat-query") : itemInput.value)?.focus();
}
async function newSearch(): Promise<void> {
  emit("newSearch");
  itemPickerOpen.value = false;
  itemQuery.value = "";
  statQuery.value = "";
  savedQuery.value = "";
  optionalSocketsOpen.value = false;
  await nextTick();
  itemInput.value?.focus();
}
function chooseStat(statId: number): void {
  if (marketStatMinimumIssue(statId, props.itemKey)) return;
  emit("addStatFilter", statId);
  statQuery.value = "";
  void nextTick(() => document.querySelector<HTMLInputElement>(".market-workspace .market-stat-row:last-child input")?.focus());
}
const itemQueryFocused = ref(false);
const showItemSuggestions = computed(() => itemQueryFocused.value || itemQuery.value.trim() !== "");
function escapeItemQuery(): void {
  if (itemQuery.value) itemQuery.value = "";
  else if (props.item) itemPickerOpen.value = false;
}
const filteredStatIds = computed(() => new Set(props.statFilters.flatMap((filter) => filter.statId === null ? [] : [filter.statId])));
// Catalog rows with a plain bracketed value describe exactly one stat ID.
const catalogRanges = computed(() => new Map(catalogStats.value.flatMap((row) =>
  row.value && /^\[[^\]]*\]$/.test(row.value) ? [[row.key, row.value.slice(1, -1)] as const] : [])));
function statRangeHint(statId: number | null): string {
  const range = statId === null ? undefined : catalogRanges.value.get(statId);
  return range && /\d/.test(range) ? `Base ${range}` : "";
}
function canAddFromCatalog(statId: number): boolean {
  return catalogRanges.value.has(statId) && !filteredStatIds.value.has(statId) && marketStatOption(statId) !== null
    && !marketStatMinimumIssue(statId, props.itemKey) && props.statFilters.length < MARKET_SEARCH_MAX_STAT_FILTERS;
}
</script>

<template>
  <section class="market-workspace" aria-labelledby="market-title">
    <header class="market-heading">
      <h2 id="market-title">Market</h2>
      <UiButton @click="newSearch">New search</UiButton>
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
              <small>{{ entry.request || entry.criteria ? `${socketSummary((entry.criteria ?? entry.request)?.minSockets, (entry.criteria ?? entry.request)?.maxSockets)} · ${(entry.criteria ?? entry.request)?.statFilters.length} stat minimums` : 'Catalog item unavailable' }}</small>
            </button>
            <UiButton :aria-label="`Delete saved item ${entry.name}`" @click="emit('deleteSaved', entry.id)">×</UiButton>
          </li>
        </ul>
        <UiButton v-if="canUndo" @click="emit('undo')">Undo delete</UiButton>
        <p>Loading a saved item only fills the form. Press Search to fetch prices.</p>
      </aside>
      <div class="market-detail">
        <form class="panel market-editor" :aria-busy="inFlight" @submit.prevent="emit('search')">
          <div v-if="item" class="market-chosen-item">
            <div><strong>{{ item.label }}</strong><small>{{ item.rarity }}</small></div>
            <UiButton :aria-expanded="itemPickerOpen" @click="itemPickerOpen = !itemPickerOpen; nextTick(() => itemInput?.focus())">Change item</UiButton>
          </div>
          <div v-if="!item || itemPickerOpen" class="market-item-picker">
            <label for="market-item-query">Choose catalog item</label>
            <div class="market-combobox">
              <input id="market-item-query" ref="itemInput" v-model="itemQuery" type="search" placeholder="Search by item name" autocomplete="off" @focus="itemQueryFocused = true" @blur="itemQueryFocused = false" @keydown.enter.prevent="itemSuggestions[0] && chooseItem(itemSuggestions[0])" @keydown.escape.prevent="escapeItemQuery" />
              <div v-if="showItemSuggestions" class="market-dropdown" @mousedown.prevent>
                <ul v-if="itemSuggestions.length" class="market-options" aria-label="Catalog item suggestions">
                  <li v-for="option in itemSuggestions" :key="option.key"><button type="button" @click="chooseItem(option)">{{ option.name }} <small>{{ option.typeLabel }} · {{ option.repository }}{{ option.searchUnavailable ? ' · Search encoding pending' : '' }}</small></button></li>
                </ul>
                <p v-else>No supported catalog item matches. Try another name.</p>
              </div>
            </div>
          </div>
          <div class="market-filter-layout">
          <fieldset class="market-filters" :disabled="!item" aria-labelledby="market-filters-title">
            <h3 id="market-filters-title">Filters</h3>
            <div v-if="item && !socketBaseRange && !hasSocketCriteria" class="market-socket-toggle">
              <UiButton :aria-expanded="showSocketControls" aria-controls="market-socket-controls" @click="optionalSocketsOpen = !optionalSocketsOpen">{{ optionalSocketsOpen ? 'Hide optional socket filters' : 'Add optional socket filters' }}</UiButton>
              <small>Capacity unverified</small>
            </div>
            <div v-if="showSocketControls" id="market-socket-controls">
              <div class="market-socket-bounds" role="group" aria-labelledby="market-sockets-group">
                <span id="market-sockets-group" class="market-filter-label">Sockets</span>
                <label class="sr-only" for="market-sockets">Minimum sockets</label>
                <input id="market-sockets" :value="minSockets ?? ''" type="number" min="0" max="6" step="1" placeholder="Any" @input="emit('updateMinSockets', numericValue($event))" />
                <span class="market-range-to" aria-hidden="true">to</span>
                <label class="sr-only" for="market-sockets-max">Maximum sockets</label>
                <input id="market-sockets-max" :value="maxSockets ?? ''" type="number" min="0" max="6" step="1" placeholder="Any" @input="emit('updateMaxSockets', numericValue($event))" />
                <small v-if="socketBaseRange" class="market-socket-hint">Base socket range: {{ socketBaseRange.minimum === socketBaseRange.maximum ? socketBaseRange.minimum : `${socketBaseRange.minimum}–${socketBaseRange.maximum}` }}. Final item capacity may differ.</small>
                <small v-else class="market-socket-hint">Socket capacity is unverified for this item. Socket filters are optional.</small>
              </div>
              <p v-if="minSockets !== null && maxSockets != null && minSockets > maxSockets" class="market-search-error" role="status">Minimum sockets must be less than or equal to maximum sockets.</p>
            </div>
            <div v-if="statFilters.length" class="market-stat-list">
              <div v-for="filter in statFilters" :key="filter.key" class="market-stat-row">
                <label :for="filter.key">{{ marketStatOption(filter.statId ?? -1)?.name }}<span class="sr-only"> minimum</span> <small v-if="marketStatMinimumIssue(filter.statId ?? -1, itemKey)" class="market-stat-issue">Unsupported saved criterion</small></label>
                <input :id="filter.key" :value="filter.minimum ?? ''" type="number" step="any" min="-1000000000" max="1000000000" required placeholder="Min" @input="emit('updateStatFilter', filter.key, { minimum: numericValue($event) })" />
                <small class="market-stat-hint">{{ statRangeHint(filter.statId) }}</small>
                <UiButton class="market-stat-remove" :aria-label="`Remove ${marketStatOption(filter.statId ?? -1)?.name}`" @click="emit('removeStatFilter', filter.key)">×</UiButton>
              </div>
            </div>
            <div class="market-stat-add">
              <label for="market-stat-query">Add stat filter</label>
              <div class="market-combobox">
                <input id="market-stat-query" v-model="statQuery" type="search" :disabled="statFilters.length >= MARKET_SEARCH_MAX_STAT_FILTERS" placeholder="Type at least 3 characters" autocomplete="off" @keydown.enter.prevent="statSuggestions[0] && chooseStat(statSuggestions[0].statId)" @keydown.escape.prevent="statQuery = ''" />
                <div v-if="statQuery.trim().length >= 3" class="market-dropdown" @mousedown.prevent>
                  <ul v-if="statSuggestions.length" class="market-options" aria-label="Stat suggestions"><li v-for="option in statSuggestions" :key="option.statId"><button type="button" :disabled="Boolean(marketStatMinimumIssue(option.statId, itemKey))" @click="chooseStat(option.statId)">{{ option.name }}<small v-if="marketStatMinimumIssue(option.statId, itemKey)">{{ marketStatMinimumIssue(option.statId, itemKey) }}</small><small v-else-if="option.description">{{ option.description }}</small></button></li></ul>
                  <p v-else>No additional supported stats match.</p>
                </div>
              </div>
            </div>
            <p v-if="statFilters.length >= MARKET_SEARCH_MAX_STAT_FILTERS" class="market-filter-note">All {{ MARKET_SEARCH_MAX_STAT_FILTERS }} stat slots are in use. Remove one to add another.</p>
          </fieldset>
          <section v-if="showCatalog" class="market-catalog-ranges" aria-labelledby="market-ranges-title">
            <header class="market-stat-card-heading"><h3 id="market-ranges-title">{{ item?.label }}</h3><small>{{ item?.rarity }} · Base stat ranges</small></header>
            <dl v-if="catalogStats.length" class="market-range-list">
              <div v-for="stat in catalogStats" :key="stat.key" :class="{ 'is-filtered': catalogRanges.has(stat.key) && filteredStatIds.has(stat.key) }">
                <dt :title="stat.detail">{{ stat.label }}</dt>
                <dd v-if="stat.value">{{ stat.value }}<button v-if="canAddFromCatalog(stat.key)" type="button" class="market-range-add" :aria-label="`Add ${marketStatOption(stat.key)?.name} minimum`" @click="chooseStat(stat.key)"></button></dd>
              </div>
            </dl>
            <p v-else class="empty-copy">No fixed base stat values retained for this definition.</p>
            <p v-if="catalogSkill" class="market-triggered-skill">{{ catalogSkill }}</p>
            <p v-if="itemKey === 'unique:10:0:92'" class="market-set-effect">Orbital Gravity set bonus: Orbital Damage increased by 30%</p>
            <footer>
              <small>Experimental base ranges.</small>
              <details class="market-catalog-details"><summary>Details</summary>
                <p>Build {{ ITEM_BASE_STAT_CATALOG.steamBuild }} · Base values, not listing rolls. Current-build parity is unverified.</p>
                <p v-if="!catalogDefinition?.complete">Some base values are dynamic or remain undecoded.</p>
                <p>Talent names appear only where the retained mapping or supplied item tooltip establishes them. Other talent names and proc chance units remain unavailable.</p>
              </details>
            </footer>
          </section>
          <div v-else class="market-catalog-ranges market-catalog-placeholder"><p class="empty-copy">Choose an item to see its stats.</p></div>
          </div>
          <div class="market-editor-status">
            <div v-if="item" class="market-filter-summary" aria-label="Active filters"><span v-for="text in summary" :key="text">{{ text }}</span></div>
            <p v-if="item && !canSave" role="status">Enter valid socket and stat minimums before saving or searching.</p>
            <p v-if="blockedFilters.length" class="market-search-error" role="status">These saved criteria are preserved, but cannot be sent as numeric minimums. Remove them to search.<span v-for="filter in blockedFilters" :key="filter.key"> {{ marketStatOption(filter.statId!)?.name }}: {{ marketStatMinimumIssue(filter.statId!, itemKey) }}</span></p>
            <p v-if="message" role="status">{{ message }}</p>
            <p v-if="saveStatus === 'error'" class="market-search-error" role="alert">Local saving failed. Keep Companion open and retry.<UiButton @click="emit('retrySave')">Retry save</UiButton></p>
            <p v-else-if="saveStatus === 'saving'" role="status">Saving locally…</p>
          </div>
          <footer class="market-form-actions">
            <div class="market-action-row market-primary-actions">
              <UiButton tone="primary" type="submit" :disabled="!canSearch">{{ inFlight ? 'Searching…' : cooldown > 0 ? `Search in ${cooldown}s` : 'Search market' }}</UiButton>
              <UiButton @click="newSearch">Clear</UiButton>
              <div class="market-save-controls">
                <label class="sr-only" for="market-saved-name">Saved name (optional)</label>
                <input id="market-saved-name" v-model="savedName" placeholder="Saved name (optional)" />
                <UiButton :disabled="!canSave" @click="emit('save', false)">{{ editingId ? 'Save changes' : 'Save item and filters' }}</UiButton>
                <UiButton v-if="editingId" :disabled="!canSave" @click="emit('save', true)">Save as new</UiButton>
              </div>
            </div>
            <small v-if="inFlight || cooldown > 0">{{ inFlight ? 'Searching. Editing filters discards the pending result.' : `Next search available in ${cooldown}s.` }}</small>
          </footer>
        </form>
        <section class="panel market-results" aria-labelledby="market-results-title" aria-live="polite">
          <div class="market-results-heading"><h3 id="market-results-title">Price results</h3><small>Price ascending · first page only</small></div>
          <p v-if="phase === 'searching'" role="status">Searching current listings…</p>
          <template v-else-if="phase === 'error'"><p v-if="!readinessExplainsError" class="market-search-error" role="alert">{{ errorMessage }}</p></template>
          <template v-else-if="phase === 'success'">
            <ol v-if="listings.length" class="market-listing-grid" aria-label="Price listings">
              <li v-for="(listing, index) in listings" :key="index" class="market-listing-card" :aria-label="`Listing ${index + 1}`">
                <div class="market-listing-item"><MarketListingDetails :item="listing.item" :rank="index + 1" /></div>
                <div class="market-listing-price"><strong class="market-total-price">{{ formatNumber(listing.price) }} gold</strong><small class="market-unit-price">{{ listing.unitPrice !== undefined ? `${unitPriceFormatter.format(listing.unitPrice)} gold per unit` : 'Unit price unavailable' }}</small></div>
              </li>
            </ol>
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
