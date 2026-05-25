import { ref, type Ref } from "vue";

interface UseWindowModeOptions {
  alwaysOnTop: Ref<boolean>;
  lockCompactLocation: Ref<boolean>;
  showSettings: Ref<boolean>;
  openSettings: () => void;
}

export function useWindowMode({ alwaysOnTop, lockCompactLocation, showSettings, openSettings }: UseWindowModeOptions) {
  const compactMode = ref(false);

  async function syncWindowMode() {
    await window.heroSiegeCompanion.setAlwaysOnTop(alwaysOnTop.value);
    await window.heroSiegeCompanion.setCompactMode(compactMode.value, lockCompactLocation.value);
  }

  async function openCompactSettings() {
    compactMode.value = false;
    await syncWindowMode();
    openSettings();
  }

  async function toggleCompactMode() {
    compactMode.value = !compactMode.value;
    if (compactMode.value) showSettings.value = false;
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
    syncWindowMode,
    openCompactSettings,
    toggleCompactMode,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
  };
}
