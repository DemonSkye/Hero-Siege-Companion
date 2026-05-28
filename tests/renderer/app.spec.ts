import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";

import App from "../../src/renderer/src/App.vue";
import type { HeroSiegeCompanionApi } from "../../src/shared/ipc";
import { companionState } from "./fixtures";

describe("App orchestration", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  test("requests embedded sound installation only when the Sounds configuration scope is selected", async () => {
    const api = installHeroSiegeCompanionApi();
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppTitlebar: { template: "<div />" },
          CompactView: { template: "<div />" },
          LiveSessionHeader: {
            emits: ["open-settings"],
            template: '<button data-test="open-settings" type="button" @click="$emit(\'open-settings\')">Settings</button>',
          },
          LiveView: { template: "<div />" },
          SettingsModal: {
            props: ["configIncludeSounds"],
            emits: ["update:configIncludeSounds", "importConfiguration"],
            template: `
              <section data-test="settings-modal">
                <button data-test="disable-sounds" type="button" @click="$emit('update:configIncludeSounds', false)">Disable Sounds</button>
                <button data-test="import-configuration" type="button" @click="$emit('importConfiguration')">Import JSON</button>
              </section>
            `,
          },
          UpdateBanner: { template: "<div />" },
          WhatsNewPrompt: { template: "<div />" },
        },
      },
    });

    try {
      await flushPromises();
      await wrapper.get('[data-test="open-settings"]').trigger("click");
      await flushPromises();

      await wrapper.get('[data-test="import-configuration"]').trigger("click");
      await flushPromises();
      expect(api.importConfiguration).toHaveBeenCalledWith(true);

      await wrapper.get('[data-test="disable-sounds"]').trigger("click");
      await flushPromises();
      await wrapper.get('[data-test="import-configuration"]').trigger("click");
      await flushPromises();
      expect(api.importConfiguration).toHaveBeenLastCalledWith(false);
    } finally {
      wrapper.unmount();
    }
  });
});

function installHeroSiegeCompanionApi(): HeroSiegeCompanionApi {
  const state = companionState();
  const api: HeroSiegeCompanionApi = {
    getState: vi.fn().mockResolvedValue(state),
    startCapture: vi.fn().mockResolvedValue(state),
    launchGameOrCapture: vi.fn().mockResolvedValue(state),
    stopCapture: vi.fn().mockResolvedValue(state),
    chooseGameExecutable: vi.fn().mockResolvedValue(null),
    resetStats: vi.fn().mockResolvedValue(state),
    pauseRun: vi.fn().mockResolvedValue(state),
    resumeRun: vi.fn().mockResolvedValue(state),
    setPastRunTags: vi.fn().mockResolvedValue(state),
    setRunArchivePreferences: vi.fn().mockResolvedValue(state),
    setCapturePreferences: vi.fn().mockResolvedValue(state),
    exportConfiguration: vi.fn().mockResolvedValue(true),
    importConfiguration: vi.fn().mockResolvedValue(JSON.stringify({ app: "hero-siege-companion", kind: "configuration", version: 1, uiPreferences: {} })),
    exportItemResearch: vi.fn().mockResolvedValue(true),
    importSounds: vi.fn().mockResolvedValue([]),
    exportSoundPack: vi.fn().mockResolvedValue({ exported: false, canceled: true, filePath: null, includedFiles: [] }),
    removeSound: vi.fn().mockResolvedValue(true),
    exportPastRunsJson: vi.fn().mockResolvedValue(true),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    toggleMaximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    setCompactMode: vi.fn().mockResolvedValue(undefined),
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
    getSupportDiagnosticsInfo: vi.fn().mockResolvedValue({ userDataPath: "C:\\Users\\Tester", appVersion: "0.2.2", generatedFiles: [], logFiles: [] }),
    saveSupportDiagnostics: vi.fn().mockResolvedValue({ saved: false, canceled: true, filePath: null, includedFiles: [] }),
    checkForUpdate: vi.fn().mockResolvedValue(null),
    openRelease: vi.fn().mockResolvedValue(undefined),
    openNpcapGuide: vi.fn().mockResolvedValue(undefined),
    onStateUpdated: vi.fn(() => vi.fn()),
  };
  Object.defineProperty(window, "heroSiegeCompanion", { value: api, configurable: true });
  return api;
}
