<script setup lang="ts">
import { ref } from "vue";
import { useModalFocus } from "../lib/modal-focus";

withDefaults(defineProps<{
  title: string;
  confirmLabel?: string;
  confirmTone?: "primary" | "warning" | "danger";
  dismissOnly?: boolean;
  busy?: boolean;
}>(), {
  confirmLabel: "Confirm",
  confirmTone: "primary",
  dismissOnly: false,
  busy: false,
});

defineEmits<{
  close: [];
  confirm: [];
}>();

const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const { handleModalFocusKeydown } = useModalFocus(dialog, {
  initialFocus: () => closeButton.value,
});
</script>

<template>
  <div
    class="settings-action-backdrop"
    @click.self="$emit('close')"
    @keydown="handleModalFocusKeydown"
    @keydown.esc.stop="$emit('close')"
  >
    <section
      ref="dialog"
      class="settings-action-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-action-dialog-title"
      tabindex="-1"
    >
      <div class="settings-action-dialog-heading">
        <h2 id="settings-action-dialog-title">{{ title }}</h2>
        <button
          ref="closeButton"
          class="settings-close"
          type="button"
          aria-label="Close dialog"
          @click="$emit('close')"
        >×</button>
      </div>
      <div class="settings-action-dialog-content">
        <slot />
      </div>
      <div class="settings-action-dialog-actions">
        <button v-if="!dismissOnly" class="icon-button ghost" type="button" :disabled="busy" @click="$emit('close')">Cancel</button>
        <button
          v-if="!dismissOnly"
          :class="['icon-button', confirmTone === 'primary' ? 'primary' : confirmTone]"
          type="button"
          :disabled="busy"
          @click="$emit('confirm')"
        >{{ busy ? "Working…" : confirmLabel }}</button>
        <button v-else class="icon-button primary" type="button" @click="$emit('close')">Close</button>
      </div>
    </section>
  </div>
</template>
