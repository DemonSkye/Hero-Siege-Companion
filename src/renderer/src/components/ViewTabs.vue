<script setup lang="ts">
import { nextTick, ref } from "vue";
import { COMPANION_VIEWS, nextCompanionView, type CompanionView } from "../lib/view-navigation";

const activeView = defineModel<CompanionView>({ required: true });
const tabs = ref<HTMLElement | null>(null);

async function navigate(event: KeyboardEvent): Promise<void> {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const next = nextCompanionView(activeView.value, event.key);
  if (!next) return;
  event.preventDefault();
  activeView.value = next;
  await nextTick();
  tabs.value?.querySelector<HTMLButtonElement>(`#view-tab-${next}`)?.focus();
}
</script>

<template>
  <nav ref="tabs" class="view-tabs" role="tablist" aria-label="Companion views" @keydown="navigate">
    <button v-for="view in COMPANION_VIEWS" :id="`view-tab-${view.id}`" :key="view.id" type="button" role="tab" :aria-controls="`view-panel-${view.id}`" :aria-selected="activeView === view.id" :tabindex="activeView === view.id ? 0 : -1" :class="{ active: activeView === view.id }" @click="activeView = view.id">
      {{ view.label }}
    </button>
  </nav>
</template>
