import { onUnmounted, ref } from "vue";

export function useToast(timeoutMs = 1800) {
  const toastMessage = ref("");
  let toastTimer: number | null = null;

  function showToast(message: string): void {
    toastMessage.value = message;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastMessage.value = "";
      toastTimer = null;
    }, timeoutMs);
  }

  onUnmounted(() => {
    if (toastTimer) window.clearTimeout(toastTimer);
  });

  return { toastMessage, showToast };
}
