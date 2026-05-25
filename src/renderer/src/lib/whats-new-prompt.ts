import { ref } from "vue";

const WHATS_NEW_SEEN_STORAGE_KEY = "hero-siege-companion:whats-new-seen-version:v1";

export function useWhatsNewPrompt(version: string, openWhatsNewSettings: () => void) {
  const showWhatsNewPrompt = ref(false);

  function maybeShowWhatsNewPrompt(): void {
    try {
      if (window.localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY) === version) return;
    } catch {
      // A failed localStorage read should not block the prompt for this session.
    }
    showWhatsNewPrompt.value = true;
  }

  function markWhatsNewSeen(): void {
    try {
      window.localStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, version);
    } catch {
      // This prompt is informational; failing to persist it is harmless.
    }
  }

  function dismissWhatsNewPrompt(): void {
    markWhatsNewSeen();
    showWhatsNewPrompt.value = false;
  }

  function openWhatsNewFromPrompt(): void {
    markWhatsNewSeen();
    showWhatsNewPrompt.value = false;
    openWhatsNewSettings();
  }

  return { showWhatsNewPrompt, maybeShowWhatsNewPrompt, dismissWhatsNewPrompt, openWhatsNewFromPrompt };
}
