<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { ItemFilterPackImportPreview } from "../lib/item-filters";
import { useModalFocus } from "../lib/modal-focus";

const props = defineProps<{
  groupCount: number;
  pendingImport: ItemFilterPackImportPreview | null;
  importBusy: boolean;
}>();

const emit = defineEmits<{
  importPack: [];
  exportPack: [];
  confirmImport: [];
  cancelImport: [];
}>();

const previewDialog = ref<HTMLElement | null>(null);
const {
  openModalFocus,
  closeModalFocus,
  handleModalFocusKeydown,
} = useModalFocus(previewDialog, { manual: true });

const previewRuleCount = computed(() => props.pendingImport?.groups.reduce(
  (total, group) => total + group.rarities.length + group.types.length + group.items.length,
  0,
) ?? 0);

watch(
  () => props.pendingImport,
  async (pending, previous) => {
    if (pending && !previous) {
      await nextTick();
      openModalFocus();
    }
  },
);

function cancelImport() {
  emit("cancelImport");
  closeModalFocus();
}

function confirmImport() {
  emit("confirmImport");
  closeModalFocus();
}
</script>

<template>
  <section class="filter-pack-bar" aria-label="Filter pack sharing">
    <div>
      <strong>Filter packs</strong>
      <small>Share filter groups with only the custom sounds they actually use.</small>
    </div>
    <div class="item-filter-actions">
      <button class="icon-button primary" type="button" :disabled="importBusy" @click="emit('importPack')">
        {{ importBusy ? "Reading pack…" : "Import pack" }}
      </button>
      <button class="icon-button ghost" type="button" :disabled="!groupCount" @click="emit('exportPack')">Export pack</button>
    </div>
  </section>

  <div v-if="pendingImport" class="modal-backdrop" @click.self="cancelImport" @keydown="handleModalFocusKeydown" @keydown.esc="cancelImport">
    <section ref="previewDialog" class="settings-panel item-filter-pack-modal" role="dialog" aria-modal="true" aria-labelledby="item-filter-pack-preview-title" tabindex="-1">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Review filter pack</p>
          <h2 id="item-filter-pack-preview-title">Add this pack?</h2>
        </div>
        <button class="settings-close" type="button" aria-label="Cancel filter pack import" @click="cancelImport">×</button>
      </div>
      <div class="item-filter-pack-preview">
        <div class="item-filter-pack-stats">
          <span><strong>{{ pendingImport.groups.length }}</strong><small>Filter groups</small></span>
          <span><strong>{{ previewRuleCount }}</strong><small>Configured rules</small></span>
          <span><strong>{{ pendingImport.sounds.length }}</strong><small>Custom sounds</small></span>
        </div>
        <p>The imported groups will be added to your current Filter Stack. Existing groups and sounds stay untouched.</p>
        <div class="item-filter-pack-group-list" aria-label="Groups in filter pack">
          <span v-for="group in pendingImport.groups" :key="group.id">
            <strong>{{ group.name }}</strong>
            <small>{{ group.items.length }} watched · {{ group.rarities.length }} rarities · {{ group.types.length }} types</small>
          </span>
        </div>
        <p v-if="pendingImport.missingCustomSoundIds.length" class="item-filter-pack-warning">
          {{ pendingImport.missingCustomSoundIds.length }} referenced custom sound{{ pendingImport.missingCustomSoundIds.length === 1 ? " is" : "s are" }} missing from this pack. Those rules will use the built-in fallback.
        </p>
      </div>
      <div class="settings-actions item-filter-confirm-actions">
        <button class="icon-button ghost" type="button" @click="cancelImport">Cancel</button>
        <button class="icon-button primary" type="button" @click="confirmImport">Add pack</button>
      </div>
    </section>
  </div>
</template>
