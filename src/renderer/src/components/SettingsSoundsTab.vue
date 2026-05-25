<script setup lang="ts">
import type { CustomItemFilterSound } from "../lib/item-filters";

defineProps<{
  customItemFilterSounds: CustomItemFilterSound[];
}>();

defineEmits<{
  importSounds: [];
  removeSound: [sound: CustomItemFilterSound];
}>();
</script>

<template>
  <div class="settings-grid settings-grid-single">
    <section class="settings-wide compact-settings-section">
      <div class="compact-settings-heading">
        <strong>Loot alert sounds</strong>
        <span>{{ customItemFilterSounds.length }} imported</span>
      </div>
      <p class="settings-note settings-wide-note">Import .wav, .mp3, .ogg, or a .zip soundpack. Imported sounds appear in the Item Filter sound menus.</p>
      <button class="icon-button ghost settings-import-sounds" type="button" @click="$emit('importSounds')">Import Sounds</button>
      <div v-if="customItemFilterSounds.length" class="settings-sound-list" aria-label="Imported sounds">
        <div v-for="sound in customItemFilterSounds" :key="sound.id" class="settings-sound-row">
          <div>
            <strong>{{ sound.name }}</strong>
            <span>{{ sound.fileName }}</span>
          </div>
          <button class="shopping-remove" type="button" :aria-label="`Remove ${sound.name}`" @click="$emit('removeSound', sound)">x</button>
        </div>
      </div>
      <p v-else class="empty-copy settings-sound-empty">No imported sounds yet.</p>
    </section>
  </div>
</template>
