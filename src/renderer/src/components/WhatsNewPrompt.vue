<script setup lang="ts">
import { ref } from "vue";
import { useModalFocus } from "../lib/modal-focus";

defineProps<{
  version: string;
}>();

const emit = defineEmits<{
  open: [];
  dismiss: [];
}>();

const promptDialog = ref<HTMLElement | null>(null);
const { handleModalFocusKeydown } = useModalFocus(promptDialog);
</script>

<template>
  <div class="modal-backdrop" @keydown="handleModalFocusKeydown" @keydown.esc="emit('dismiss')">
    <section ref="promptDialog" class="settings-panel whats-new-prompt" role="dialog" aria-modal="true" aria-labelledby="whats-new-title" tabindex="-1">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">Updated</p>
          <h2 id="whats-new-title">See what's new?</h2>
          <p class="settings-note">Version {{ version }} is ready.</p>
        </div>
      </div>
      <div class="settings-actions whats-new-prompt-actions">
        <button class="icon-button primary" type="button" @click="emit('open')">Show me</button>
        <button class="icon-button ghost" type="button" @click="emit('dismiss')">No Thanks</button>
      </div>
    </section>
  </div>
</template>
