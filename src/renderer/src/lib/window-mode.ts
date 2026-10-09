import { ref, type Ref } from "vue";

interface UseWindowModeOptions {
  showSettings: Ref<boolean>;
  showCompactCustomization: Ref<boolean>;
}

export function useWindowMode({ showSettings, showCompactCustomization }: UseWindowModeOptions) {
  const compactMode = ref(false);
  const fullWindowPinned = ref(false);
  let pendingWindowMode: Promise<void> = Promise.resolve();

  function queueWindowMode(action: () => Promise<void>): Promise<void> {
    const transition = pendingWindowMode.then(action);
    // Each caller still receives its failure; the queue remains usable for retry.
    pendingWindowMode = transition.catch(() => undefined);
    return transition;
  }

  async function readWindowMode() {
    const snapshot = await window.heroSiegeCompanion.getWindowMode();
    compactMode.value = snapshot.compactMode;
    fullWindowPinned.value = snapshot.fullWindowPinned;
  }

  function syncWindowMode() {
    return queueWindowMode(readWindowMode);
  }

  function openCompactCustomization() {
    return queueWindowMode(async () => {
      await readWindowMode();
      await window.heroSiegeCompanion.setCompactMode(false);
      await readWindowMode();
      showCompactCustomization.value = true;
    });
  }

  function toggleCompactMode() {
    return queueWindowMode(async () => {
      await readWindowMode();
      await window.heroSiegeCompanion.setCompactMode(!compactMode.value);
      await readWindowMode();
      if (compactMode.value) {
        showSettings.value = false;
        showCompactCustomization.value = false;
      }
    });
  }

  function toggleFullWindowPinned() {
    return queueWindowMode(async () => {
      await readWindowMode();
      if (compactMode.value) return;
      await window.heroSiegeCompanion.setAlwaysOnTop(!fullWindowPinned.value);
      await readWindowMode();
    });
  }

  async function minimizeWindow() {
    await window.heroSiegeCompanion.minimizeWindow();
  }

  async function toggleMaximizeWindow() {
    await window.heroSiegeCompanion.toggleMaximizeWindow();
  }

  async function closeWindow() {
    await window.heroSiegeCompanion.closeWindow();
  }

  return {
    compactMode,
    fullWindowPinned,
    syncWindowMode,
    openCompactCustomization,
    toggleCompactMode,
    toggleFullWindowPinned,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
  };
}
