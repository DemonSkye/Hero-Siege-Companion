import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from "vue";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
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
    if (event.key !== "Tab") return;
    const dialog = dialogRef.value;
    if (!dialog) return;
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
    return tabIndex !== "-1" && element.getAttribute("aria-hidden") !== "true";
  });
}
