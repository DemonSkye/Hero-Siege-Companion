<script setup lang="ts">
import { computed } from "vue";
import { eventChecked, eventValue } from "../lib/dom-events";
import {
  ITEM_FILTER_RARITIES,
  itemFilterGroupedItems,
  resolveItemFilterSound,
  toggledNumberList,
  toggledStringList,
  type ItemFilterGroup,
  type ItemFilterSoundOption,
  type ItemFilterSpecificItem,
} from "../lib/item-filters";

interface ItemTypeOption {
  value: string;
  label: string;
}

const props = defineProps<{
  group: ItemFilterGroup;
  open: boolean;
  sounds: ItemFilterSoundOption[];
  itemTypeOptions: ItemTypeOption[];
  draftItem: string;
  suggestions: string[];
}>();

const emit = defineEmits<{
  toggle: [group: ItemFilterGroup];
  updateGroup: [group: ItemFilterGroup];
  requestRemove: [group: ItemFilterGroup, event: MouseEvent];
  "update:draftItem": [value: string];
  addItem: [group: ItemFilterGroup, value?: string];
  removeItem: [group: ItemFilterGroup, item: ItemFilterSpecificItem];
  testSound: [soundId: string, volume: number];
}>();

const groupedItems = computed(() => itemFilterGroupedItems(props.group));
const soundResolution = computed(() => resolveItemFilterSound(props.group.soundId, props.sounds));
const summary = computed(() => {
  const raritySummary = props.group.rarities.length ? `${props.group.rarities.length} rarit${props.group.rarities.length === 1 ? "y" : "ies"}` : "any rarity";
  const typeSummary = props.group.types.length ? `${props.group.types.length} type${props.group.types.length === 1 ? "" : "s"}` : "any type";
  const watchedSummary = `${props.group.items.length} watched`;
  const soundSummary = soundResolution.value.missingCustomSound
    ? `${soundResolution.value.fallbackName} fallback`
    : soundResolution.value.name;
  return `${props.group.enabled ? "On" : "Off"} · ${raritySummary} · ${typeSummary} · ${watchedSummary} · ${soundSummary}`;
});

function updateGroup(patch: Partial<ItemFilterGroup>) {
  emit("updateGroup", { ...props.group, ...patch });
}

function updateNumber(field: "volume" | "cooldownMs", event: Event) {
  const value = Number(eventValue(event));
  if (Number.isFinite(value)) updateGroup({ [field]: value });
}

function updateSpecificItemSound(item: ItemFilterSpecificItem, soundId: string) {
  updateGroup({
    items: props.group.items.map((candidate) => candidate.name === item.name ? { ...candidate, soundId } : candidate),
  });
}

function soundIsMissing(soundId: string): boolean {
  return resolveItemFilterSound(soundId, props.sounds).missingCustomSound;
}

function fallbackSoundName(soundId: string): string {
  return resolveItemFilterSound(soundId, props.sounds).fallbackName;
}
</script>

<template>
  <article :class="['filter-stack-card', { open, disabled: !group.enabled, 'missing-sound': soundResolution.missingCustomSound }]">
    <header class="filter-stack-card-header">
      <label class="filter-stack-enable" @click.stop>
        <input :checked="group.enabled" type="checkbox" :aria-label="`${group.enabled ? 'Disable' : 'Enable'} ${group.name}`" @change="updateGroup({ enabled: eventChecked($event) })" />
        <span aria-hidden="true"></span>
      </label>
      <button class="filter-stack-toggle" type="button" :aria-expanded="open" :aria-controls="`filter-stack-body-${group.id}`" @click="emit('toggle', group)">
        <span class="filter-stack-title">
          <strong>{{ group.name }}</strong>
          <small>{{ summary }}</small>
        </span>
        <span class="filter-stack-chevron" aria-hidden="true">⌄</span>
      </button>
    </header>

    <div v-if="open" :id="`filter-stack-body-${group.id}`" class="filter-stack-card-body">
      <section class="filter-stack-basics" aria-label="Filter behavior">
        <label class="filter-stack-field">
          <span>Group name</span>
          <input :value="group.name" type="text" spellcheck="false" @input="updateGroup({ name: eventValue($event) })" />
        </label>
        <label class="filter-stack-field">
          <span>Alert sound</span>
          <div class="sound-picker">
            <select :value="group.soundId" @change="updateGroup({ soundId: eventValue($event) })">
              <option v-if="soundResolution.missingCustomSound" :value="group.soundId" disabled>Missing custom sound</option>
              <option v-for="sound in sounds" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
            </select>
            <button class="sound-test-button" type="button" :aria-label="`Preview ${group.name} sound`" @click="emit('testSound', group.soundId, group.volume)">Preview</button>
          </div>
          <small v-if="soundResolution.missingCustomSound" class="item-filter-sound-warning">
            The original custom sound is missing. Alerts use {{ soundResolution.fallbackName }} until you choose another.
          </small>
        </label>
        <label class="filter-stack-field">
          <span>Volume · {{ group.volume }}%</span>
          <input :value="group.volume" type="range" min="0" max="100" @input="updateNumber('volume', $event)" />
        </label>
        <label class="filter-stack-field">
          <span>Cooldown</span>
          <span class="number-setting">
            <input :value="group.cooldownMs" type="number" min="0" max="30000" step="100" @input="updateNumber('cooldownMs', $event)" />
            <small>ms</small>
          </span>
        </label>
      </section>

      <section class="filter-stack-rule-section">
        <div class="item-filter-rule-heading">
          <div>
            <strong>Rarities</strong>
            <small>Leave empty to match every rarity.</small>
          </div>
          <span>{{ group.rarities.length || "Any" }}</span>
        </div>
        <div class="item-filter-chip-grid">
          <label v-for="rarity in ITEM_FILTER_RARITIES" :key="rarity" class="filter-box">
            <input :checked="group.rarities.includes(rarity)" type="checkbox" @change="updateGroup({ rarities: toggledStringList(group.rarities, rarity, eventChecked($event)) })" />
            <span>{{ rarity }}</span>
          </label>
        </div>
      </section>

      <section class="filter-stack-rule-section">
        <div class="item-filter-rule-heading">
          <div>
            <strong>Item types</strong>
            <small>Leave empty to match every item type.</small>
          </div>
          <span>{{ group.types.length || "Any" }}</span>
        </div>
        <div class="item-filter-type-grid">
          <label v-for="option in itemTypeOptions" :key="option.value" class="filter-box">
            <input :checked="group.types.includes(Number(option.value))" type="checkbox" @change="updateGroup({ types: toggledNumberList(group.types, Number(option.value), eventChecked($event)) })" />
            <span>{{ option.label }}</span>
          </label>
        </div>
      </section>

      <section class="filter-stack-rule-section">
        <div class="item-filter-rule-heading">
          <div>
            <strong>Watched items</strong>
            <small>Exact item names can override the group sound.</small>
          </div>
          <span>{{ group.items.length }}</span>
        </div>
        <div class="item-filter-search-wrap">
          <form class="item-filter-add-item" @submit.prevent="emit('addItem', group)">
            <input :value="draftItem" type="search" placeholder="Search known item name" autocomplete="off" spellcheck="false" @input="emit('update:draftItem', eventValue($event))" />
            <button class="icon-button primary" type="submit">Add item</button>
          </form>
          <div v-if="draftItem.trim().length >= 3 && suggestions.length" class="item-filter-suggestions">
            <button v-for="name in suggestions" :key="name" type="button" @click="emit('addItem', group, name)">{{ name }}</button>
          </div>
          <p v-else-if="draftItem.trim().length > 0 && draftItem.trim().length < 3" class="item-filter-search-hint">Type at least 3 characters for suggestions.</p>
          <p v-else-if="draftItem.trim().length >= 3" class="item-filter-search-hint">No matching known items.</p>
        </div>

        <div v-if="groupedItems.length" class="item-filter-specific-list">
          <section v-for="itemGroup in groupedItems" :key="itemGroup.typeLabel" class="item-filter-specific-type">
            <h4>{{ itemGroup.typeLabel }}</h4>
            <div v-for="item in itemGroup.items" :key="`${itemGroup.typeLabel}-${item.name}`" class="item-filter-specific-row">
              <span>{{ item.name }}</span>
              <div class="sound-picker-stack">
                <div class="sound-picker">
                  <select :value="item.soundId" @change="updateSpecificItemSound(item, eventValue($event))">
                    <option value="">Group sound</option>
                    <option v-if="soundIsMissing(item.soundId)" :value="item.soundId" disabled>Missing custom sound</option>
                    <option v-for="sound in sounds" :key="sound.id" :value="sound.id">{{ sound.name }}</option>
                  </select>
                  <button class="sound-test-button" type="button" :aria-label="`Preview sound for ${item.name}`" @click="emit('testSound', item.soundId || group.soundId, group.volume)">Preview</button>
                </div>
                <small v-if="soundIsMissing(item.soundId)" class="item-filter-sound-warning">Uses {{ fallbackSoundName(item.soundId) }} until another sound is selected.</small>
              </div>
              <button class="shopping-remove" type="button" :aria-label="`Remove ${item.name}`" @click="emit('removeItem', group, item)">×</button>
            </div>
          </section>
        </div>
        <p v-else class="empty-copy">No exact items yet. Rarity and type rules still apply.</p>
      </section>

      <footer class="filter-stack-card-actions">
        <button class="icon-button danger" type="button" @click="emit('requestRemove', group, $event)">Remove group</button>
      </footer>
    </div>
  </article>
</template>
