<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  isCustomSoundId,
  type CustomItemFilterSound,
  type ItemFilterGroup,
  type ItemFilterSoundOption,
} from "../lib/item-filters";
import { useModalFocus } from "../lib/modal-focus";

const props = defineProps<{
  open: boolean;
  sounds: ItemFilterSoundOption[];
  customSounds: CustomItemFilterSound[];
  groups: ItemFilterGroup[];
}>();

const emit = defineEmits<{
  toggle: [];
  importSounds: [];
  exportSoundpack: [];
  removeSound: [sound: CustomItemFilterSound];
  testSound: [soundId: string, volume: number];
}>();

const pendingRemoval = ref<CustomItemFilterSound | null>(null);
const removeDialog = ref<HTMLElement | null>(null);
const {
  openModalFocus,
  closeModalFocus,
  handleModalFocusKeydown,
} = useModalFocus(removeDialog, { manual: true });

const builtInSounds = computed(() => props.sounds.filter((sound) => !isCustomSoundId(sound.id)));
const usedCustomSoundIds = computed(() => {
  const ids = new Set<string>();
  for (const group of props.groups) {
    if (isCustomSoundId(group.soundId)) ids.add(group.soundId);
    for (const item of group.items) if (isCustomSoundId(item.soundId)) ids.add(item.soundId);
  }
  return ids;
});
const librarySummary = computed(() => `${builtInSounds.value.length} built in · ${props.customSounds.length} custom · ${usedCustomSoundIds.value.size} in use`);
const pendingRemovalUsage = computed(() => pendingRemoval.value ? soundUsageCount(pendingRemoval.value.id) : 0);

watch(
  () => props.customSounds.map((sound) => sound.id).join("\n"),
  () => {
    if (pendingRemoval.value && !props.customSounds.some((sound) => sound.id === pendingRemoval.value?.id)) pendingRemoval.value = null;
  },
);

function soundUsageCount(soundId: string): number {
  return props.groups.reduce((total, group) => {
    const groupUsage = group.soundId === soundId ? 1 : 0;
    return total + groupUsage + group.items.filter((item) => item.soundId === soundId).length;
  }, 0);
}

function requestRemove(sound: CustomItemFilterSound, event: MouseEvent) {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  pendingRemoval.value = sound;
  openModalFocus();
}

function cancelRemove() {
  pendingRemoval.value = null;
  closeModalFocus();
}

function confirmRemove() {
  if (!pendingRemoval.value) return;
  emit("removeSound", pendingRemoval.value);
  pendingRemoval.value = null;
  closeModalFocus();
}
</script>

<template>
  <section :class="['filter-stack-utility', { open }]">
    <button class="filter-stack-utility-toggle" type="button" :aria-expanded="open" aria-controls="item-filter-sound-library" @click="emit('toggle')">
      <span>
        <strong>Sound Library</strong>
        <small>{{ librarySummary }}</small>
      </span>
      <span class="filter-stack-chevron" aria-hidden="true">⌄</span>
    </button>

    <div v-if="open" id="item-filter-sound-library" class="sound-library-body">
      <div class="sound-library-toolbar">
        <div>
          <strong>Loot alert sounds</strong>
          <p>Import audio once, then choose it from any filter group or exact watched item.</p>
        </div>
        <div class="item-filter-actions">
          <button class="icon-button primary" type="button" @click="emit('importSounds')">Import sounds</button>
          <button class="icon-button ghost" type="button" :disabled="!customSounds.length" @click="emit('exportSoundpack')">Export soundpack</button>
        </div>
      </div>

      <section class="sound-library-section">
        <div class="item-filter-rule-heading">
          <div>
            <strong>Built-in sounds</strong>
            <small>Always available.</small>
          </div>
          <span>{{ builtInSounds.length }}</span>
        </div>
        <div class="sound-library-grid">
          <article v-for="sound in builtInSounds" :key="sound.id" class="sound-library-row">
            <span>
              <strong>{{ sound.name }}</strong>
              <small>Built in</small>
            </span>
            <button class="sound-test-button" type="button" :aria-label="`Preview ${sound.name}`" @click="emit('testSound', sound.id, 70)">Preview</button>
          </article>
        </div>
      </section>

      <section class="sound-library-section">
        <div class="item-filter-rule-heading">
          <div>
            <strong>Custom sounds</strong>
            <small>Stored locally on this computer.</small>
          </div>
          <span>{{ customSounds.length }}</span>
        </div>
        <div v-if="customSounds.length" class="sound-library-grid">
          <article v-for="sound in customSounds" :key="sound.id" class="sound-library-row custom">
            <span>
              <strong>{{ sound.name }}</strong>
              <small>{{ sound.fileName }} · {{ soundUsageCount(sound.id) }} use{{ soundUsageCount(sound.id) === 1 ? "" : "s" }}</small>
            </span>
            <div class="sound-library-row-actions">
              <button class="sound-test-button" type="button" :aria-label="`Preview ${sound.name}`" @click="emit('testSound', sound.id, 70)">Preview</button>
              <button class="shopping-remove" type="button" :aria-label="`Remove ${sound.name}`" @click="requestRemove(sound, $event)">×</button>
            </div>
          </article>
        </div>
        <p v-else class="empty-copy">No custom sounds imported.</p>
      </section>
    </div>
  </section>

  <div v-if="pendingRemoval" class="modal-backdrop" @click.self="cancelRemove" @keydown="handleModalFocusKeydown" @keydown.esc="cancelRemove">
    <section ref="removeDialog" class="settings-panel item-filter-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-filter-sound-title" tabindex="-1">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Remove custom sound</p>
          <h2 id="remove-filter-sound-title">Remove “{{ pendingRemoval.name }}”?</h2>
        </div>
        <button class="settings-close" type="button" aria-label="Cancel remove sound" @click="cancelRemove">×</button>
      </div>
      <div class="item-filter-confirm-body">
        <strong v-if="pendingRemovalUsage">Used by {{ pendingRemovalUsage }} filter rule{{ pendingRemovalUsage === 1 ? "" : "s" }}</strong>
        <strong v-else>Not currently used by a filter</strong>
        <p v-if="pendingRemovalUsage">Those rules stay intact and use the built-in fallback sound until you choose another sound.</p>
        <p v-else>The imported audio file will be removed from the Companion’s managed sound library.</p>
      </div>
      <div class="settings-actions item-filter-confirm-actions">
        <button class="icon-button ghost" type="button" @click="cancelRemove">Cancel</button>
        <button class="icon-button danger item-filter-confirm-remove" type="button" @click="confirmRemove">Remove sound</button>
      </div>
    </section>
  </div>
</template>
