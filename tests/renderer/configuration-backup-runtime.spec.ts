import { describe, expect, test, vi } from "vitest";
import { useConfigurationBackupRuntime } from "../../src/renderer/src/lib/configuration-backup-runtime";
import { defaultPreferences } from "../../src/renderer/src/lib/preferences";

describe("configuration backup runtime", () => {
  test("keeps selection side-effect free and installs embedded sounds only after confirmation", async () => {
    const selectedPayload = {
      app: "hero-siege-companion",
      kind: "backup",
      version: 2,
      uiPreferences: {
        schemaVersion: 2,
        launchThroughSteam: false,
        itemFilterGroups: defaultPreferences.itemFilterGroups,
        customItemFilterSounds: [{
          id: "custom-sound:alert",
          name: "Alert",
          fileName: "alert.wav",
          src: "data:audio/wav;base64,UklGRg==",
        }],
      },
    };
    const installedPayload = {
      ...selectedPayload,
      uiPreferences: {
        ...selectedPayload.uiPreferences,
        customItemFilterSounds: [{
          ...selectedPayload.uiPreferences.customItemFilterSounds[0],
          src: "file:///managed/alert.wav",
        }],
      },
    };
    const importConfiguration = vi.fn().mockResolvedValue(JSON.stringify(selectedPayload));
    const installConfigurationSounds = vi.fn().mockResolvedValue(JSON.stringify(installedPayload));
    Object.defineProperty(window, "heroSiegeCompanion", {
      configurable: true,
      value: { importConfiguration, installConfigurationSounds },
    });
    const applyPreferences = vi.fn();
    const runtime = useConfigurationBackupRuntime({
      currentPreferences: () => defaultPreferences,
      applyPreferences,
      showToast: vi.fn(),
    });

    await runtime.chooseBackup();
    expect(runtime.backupPreview.value).toMatchObject({ sourceVersion: 2, sounds: 1 });
    expect(installConfigurationSounds).not.toHaveBeenCalled();
    expect(applyPreferences).not.toHaveBeenCalled();

    await runtime.confirmRestoreBackup();
    expect(installConfigurationSounds).toHaveBeenCalledWith(JSON.stringify(selectedPayload));
    expect(applyPreferences).toHaveBeenCalledWith(expect.objectContaining({
      launchThroughSteam: false,
      customItemFilterSounds: [expect.objectContaining({ src: "file:///managed/alert.wav" })],
    }));
    expect(runtime.backupPreview.value).toBeNull();
  });

  test("canceling a preview does not install or apply anything", async () => {
    const payload = JSON.stringify({
      app: "hero-siege-companion",
      kind: "backup",
      version: 2,
      uiPreferences: { schemaVersion: 2, launchThroughSteam: false },
    });
    const installConfigurationSounds = vi.fn();
    Object.defineProperty(window, "heroSiegeCompanion", {
      configurable: true,
      value: {
        importConfiguration: vi.fn().mockResolvedValue(payload),
        installConfigurationSounds,
      },
    });
    const applyPreferences = vi.fn();
    const runtime = useConfigurationBackupRuntime({
      currentPreferences: () => defaultPreferences,
      applyPreferences,
      showToast: vi.fn(),
    });

    await runtime.chooseBackup();
    runtime.cancelRestoreBackup();

    expect(runtime.backupPreview.value).toBeNull();
    expect(installConfigurationSounds).not.toHaveBeenCalled();
    expect(applyPreferences).not.toHaveBeenCalled();
  });
});
