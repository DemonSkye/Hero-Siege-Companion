import { ref, type Ref } from "vue";

interface UseWindowModeOptions {
  showSettings: Ref<boolean>;
  showCompactCustomization: Ref<boolean>;
}

export function useWindowMode({ showSettings, showCompactCustomization }: UseWindowModeOptions) {
  const compactMode = ref(false);
  const fullWindowPinned = ref(false);

  async function syncWindowMode() {
    await window.heroSiegeCompanion.setCompactMode(compactMode.value);
    if (!compactMode.value) await window.heroSiegeCompanion.setAlwaysOnTop(fullWindowPinned.value);
  }

  async function openCompactCustomization() {
    compactMode.value = false;
    await syncWindowMode();
    showCompactCustomization.value = true;
  }

  async function toggleCompactMode() {
    compactMode.value = !compactMode.value;
    if (compactMode.value) {
      showSettings.value = false;
      showCompactCustomization.value = false;
    }
    await syncWindowMode();
  }

  async function toggleFullWindowPinned() {
    if (compactMode.value) return;
    fullWindowPinned.value = !fullWindowPinned.value;
    await window.heroSiegeCompanion.setAlwaysOnTop(fullWindowPinned.value);
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
