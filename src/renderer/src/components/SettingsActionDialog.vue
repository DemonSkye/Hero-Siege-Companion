<script setup lang="ts">
import { ref } from "vue";
import DialogShell from "./DialogShell.vue";
import UiButton from "./UiButton.vue";

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

const closeButton = ref<HTMLButtonElement | null>(null);
</script>

<template>
  <DialogShell
    backdrop-class="settings-action-backdrop"
    panel-class="settings-action-dialog"
    labelled-by="settings-action-dialog-title"
    :busy="busy"
    :initial-focus="() => closeButton"
    @close="$emit('close')"
  >
    <div class="settings-action-dialog-heading">
      <h2 id="settings-action-dialog-title">{{ title }}</h2>
      <button
        ref="closeButton"
        class="settings-close"
        type="button"
        aria-label="Close dialog"
        :disabled="busy"
        @click="$emit('close')"
      >×</button>
    </div>
    <div class="settings-action-dialog-content">
      <slot />
    </div>
    <div class="settings-action-dialog-actions">
      <UiButton v-if="!dismissOnly" :disabled="busy" @click="$emit('close')">Cancel</UiButton>
      <UiButton
        v-if="!dismissOnly"
        :tone="confirmTone"
        :disabled="busy"
        @click="$emit('confirm')"
      >{{ busy ? "Working…" : confirmLabel }}</UiButton>
      <UiButton v-else tone="primary" :disabled="busy" @click="$emit('close')">Close</UiButton>
    </div>
  </DialogShell>
</template>
