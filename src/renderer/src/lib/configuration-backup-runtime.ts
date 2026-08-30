import { ref } from "vue";
import {
  createConfigurationExportPayload,
  createConfigurationImportPreview,
  importConfigurationPayload,
  savePreferences,
  type ConfigurationImportPreview,
  type UiPreferences,
} from "./preferences";

interface UseConfigurationBackupRuntimeOptions {
  currentPreferences: () => UiPreferences;
  applyPreferences: (preferences: UiPreferences) => void;
  showToast: (message: string) => void;
}

export function useConfigurationBackupRuntime(options: UseConfigurationBackupRuntimeOptions) {
  const backupPreview = ref<ConfigurationImportPreview | null>(null);
  const backupBusy = ref(false);
  let pendingBackupSource = "";

  async function exportBackup(): Promise<void> {
    if (backupBusy.value) return;
    backupBusy.value = true;
    try {
      const payload = createConfigurationExportPayload(options.currentPreferences());
      const exported = await window.heroSiegeCompanion.exportConfiguration(JSON.stringify(payload, null, 2), {
        title: "Export Hero Siege Companion backup",
        defaultPath: "hero-siege-companion-backup.json",
      });
      if (exported) options.showToast("Backup exported");
    } catch {
      options.showToast("Backup export failed. Check imported sounds and try again.");
    } finally {
      backupBusy.value = false;
    }
  }

  async function chooseBackup(): Promise<void> {
    if (backupBusy.value) return;
    backupBusy.value = true;
    try {
      const contents = await window.heroSiegeCompanion.importConfiguration();
      if (!contents) return;
      const preview = createConfigurationImportPreview(contents);
      pendingBackupSource = contents;
      backupPreview.value = preview;
    } catch {
      pendingBackupSource = "";
      backupPreview.value = null;
      options.showToast("Backup could not be read");
    } finally {
      backupBusy.value = false;
    }
  }

  async function confirmRestoreBackup(): Promise<void> {
    if (!pendingBackupSource || backupBusy.value) return;
    backupBusy.value = true;
    try {
      const installedContents = await window.heroSiegeCompanion.installConfigurationSounds(pendingBackupSource);
      const restored = importConfigurationPayload(installedContents, options.currentPreferences()).uiPreferences;
      options.applyPreferences(restored);
      savePreferences(restored);
      pendingBackupSource = "";
      backupPreview.value = null;
      options.showToast("Backup restored");
    } catch {
      options.showToast("Backup restore failed");
    } finally {
      backupBusy.value = false;
    }
  }

  function cancelRestoreBackup(): void {
    pendingBackupSource = "";
    backupPreview.value = null;
  }

  return {
    backupPreview,
    backupBusy,
    exportBackup,
    chooseBackup,
    confirmRestoreBackup,
    cancelRestoreBackup,
  };
}
