<script setup lang="ts">
import { ref } from "vue";
import { useModalFocus } from "../lib/modal-focus";

const props = withDefaults(defineProps<{
  labelledBy: string;
  panelClass?: string;
  backdropClass?: string;
  busy?: boolean;
  initialFocus?: () => HTMLElement | null;
}>(), { panelClass: "settings-panel", backdropClass: "modal-backdrop", busy: false });
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const { handleModalFocusKeydown } = useModalFocus(dialog, { initialFocus: () => props.initialFocus?.() ?? dialog.value });

function requestClose(): void {
  if (!props.busy) emit("close");
}
</script>

<template>
  <div :class="backdropClass" @click.self="requestClose" @keydown="handleModalFocusKeydown" @keydown.esc.stop="requestClose">
    <section ref="dialog" :class="panelClass" role="dialog" aria-modal="true" :aria-labelledby="labelledBy" :aria-busy="busy || undefined" tabindex="-1">
      <slot />
    </section>
  </div>
</template>
