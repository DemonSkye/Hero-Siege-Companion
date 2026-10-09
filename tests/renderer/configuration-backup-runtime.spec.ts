import { beforeEach, describe, expect, test, vi } from "vitest";
import { useConfigurationBackupRuntime } from "../../src/renderer/src/lib/configuration-backup-runtime";
import { defaultPreferences } from "../../src/renderer/src/lib/preferences";

describe("configuration backup runtime", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
  });
  test("a preference write failure retains the restore preview and retries without reinstalling sounds", async () => {
    const contents = JSON.stringify({ app: "hero-siege-companion", kind: "backup", version: 2, uiPreferences: { schemaVersion: 2, launchThroughSteam: false } });
    const installConfigurationSounds = vi.fn().mockResolvedValue(contents);
    Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: { importConfiguration: vi.fn().mockResolvedValue(contents), installConfigurationSounds } });
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => { throw new Error("synthetic quota failure"); });
    const applyPreferences = vi.fn();
    const showToast = vi.fn();
    const runtime = useConfigurationBackupRuntime({ currentPreferences: () => defaultPreferences, applyPreferences, showToast });
    await runtime.chooseBackup();
    await runtime.confirmRestoreBackup();
    expect(runtime.backupPreview.value).not.toBeNull();
    expect(applyPreferences).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith("Backup restored");
    setItem.mockRestore();
    await runtime.confirmRestoreBackup();
    expect(installConfigurationSounds).toHaveBeenCalledTimes(1);
    expect(runtime.backupPreview.value).toBeNull();
    expect(applyPreferences).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenLastCalledWith("Backup restored");
  });
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
