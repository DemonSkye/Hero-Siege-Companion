import { ref } from "vue";
import type { ReleaseUpdateInfo } from "../../../shared/app-state";

const IGNORED_UPDATE_STORAGE_KEY = "hero-siege-companion:ignored-update:v1";

export function useUpdateNotice() {
  const availableUpdate = ref<ReleaseUpdateInfo | null>(null);

  async function checkForUpdateNotice(): Promise<void> {
    try {
      const update = await window.heroSiegeCompanion.checkForUpdate();
      if (!update) return;
      if (window.localStorage.getItem(IGNORED_UPDATE_STORAGE_KEY) === update.version) return;
      availableUpdate.value = update;
    } catch {
      // Update checks are opportunistic and should stay silent when offline.
    }
  }

  async function openAvailableUpdate(): Promise<void> {
    if (!availableUpdate.value) return;
    await window.heroSiegeCompanion.openRelease(availableUpdate.value.url);
  }

  function ignoreAvailableUpdate(): void {
    if (!availableUpdate.value) return;
    try {
      window.localStorage.setItem(IGNORED_UPDATE_STORAGE_KEY, availableUpdate.value.version);
    } catch {
      // Ignore state is cosmetic; failing to store it is harmless.
    }
    availableUpdate.value = null;
  }

  return { availableUpdate, checkForUpdateNotice, openAvailableUpdate, ignoreAvailableUpdate };
}
