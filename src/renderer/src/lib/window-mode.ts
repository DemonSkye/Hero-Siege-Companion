import { ref, type Ref } from "vue";

interface UseWindowModeOptions {
  showSettings: Ref<boolean>;
  showCompactCustomization: Ref<boolean>;
}

export function useWindowMode({ showSettings, showCompactCustomization }: UseWindowModeOptions) {
  const compactMode = ref(false);
  const fullWindowPinned = ref(false);
  let generation = 0;

  async function syncWindowMode() {
    const currentGeneration = ++generation;
    const snapshot = await window.heroSiegeCompanion.getWindowMode();
    if (currentGeneration !== generation) return;
    compactMode.value = snapshot.compactMode;
    fullWindowPinned.value = snapshot.fullWindowPinned;
  }

  async function openCompactCustomization() {
    generation += 1;
    await window.heroSiegeCompanion.setCompactMode(false);
    await syncWindowMode();
    showCompactCustomization.value = true;
  }

  async function toggleCompactMode() {
    generation += 1;
    const enabled = !compactMode.value;
    await window.heroSiegeCompanion.setCompactMode(enabled);
    if (enabled) {
      showSettings.value = false;
      showCompactCustomization.value = false;
    }
    await syncWindowMode();
  }

  async function toggleFullWindowPinned() {
    if (compactMode.value) return;
    generation += 1;
    await window.heroSiegeCompanion.setAlwaysOnTop(!fullWindowPinned.value);
    await syncWindowMode();
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
