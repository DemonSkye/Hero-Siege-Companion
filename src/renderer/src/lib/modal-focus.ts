import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from "vue";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalFocusOptions {
  active?: Ref<boolean>;
  initialFocus?: () => HTMLElement | null;
  manual?: boolean;
}

export function useModalFocus(dialogRef: Ref<HTMLElement | null>, options: ModalFocusOptions = {}) {
  let previouslyFocused: HTMLElement | null = null;

  function rememberFocusedElement() {
    const activeElement = document.activeElement;
    previouslyFocused = activeElement instanceof HTMLElement ? activeElement : null;
  }

  function focusInitialElement() {
    void nextTick(() => {
      const dialog = dialogRef.value;
      if (!dialog) return;
      const focusTarget = options.initialFocus?.() ?? dialog;
      focusTarget.focus();
    });
  }

  function restoreFocusedElement() {
    const restoreTarget = previouslyFocused;
    previouslyFocused = null;
    if (!restoreTarget?.isConnected) return;
    restoreTarget.focus();
  }

  function openModalFocus() {
    rememberFocusedElement();
    focusInitialElement();
  }

  function closeModalFocus() {
    void nextTick(restoreFocusedElement);
  }

  if (options.active) {
    watch(
      options.active,
      (active) => {
        if (active) openModalFocus();
        else closeModalFocus();
      },
      { flush: "sync" },
    );
  } else if (!options.manual) {
    onMounted(openModalFocus);
    onBeforeUnmount(restoreFocusedElement);
  }

  function handleModalFocusKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab" || event.defaultPrevented) return;
    const dialog = dialogRef.value;
    if (!dialog) return;
    // Only the innermost modal owns Tab while a confirmation is open.
    const focusedDialog = document.activeElement?.closest('[aria-modal="true"]');
    if (focusedDialog && focusedDialog !== dialog) return;
    const focusableElements = modalFocusableElements(dialog);
    if (!focusableElements.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    const activeInsideDialog = activeElement instanceof Node && dialog.contains(activeElement);

    if (event.shiftKey && (!activeInsideDialog || activeElement === dialog || activeElement === firstElement)) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && (!activeInsideDialog || activeElement === dialog || activeElement === lastElement)) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return {
    openModalFocus,
    closeModalFocus,
    handleModalFocusKeydown,
  };
}

function modalFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const tabIndex = element.getAttribute("tabindex");
    if (tabIndex === "-1" || element.matches(":disabled")) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.hasAttribute("inert") || ancestor.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
        const summary = ancestor.querySelector(":scope > summary");
        if (!summary?.contains(element)) return false;
      }
      if (ancestor === dialog) break;
    }
    return true;
  });
}
