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

  test("reopens settings on the last selected settings tab", async () => {
    installHeroSiegeCompanionApi();
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
            props: ["initialTab"],
            emits: ["settingsTabChange", "close"],
            template: `
              <section data-test="settings-modal">
                <span data-test="settings-initial-tab">{{ initialTab }}</span>
                <button data-test="appearance-tab" type="button" @click="$emit('settingsTabChange', 'appearance')">Appearance</button>
                <button data-test="close-settings" type="button" @click="$emit('close')">Close</button>
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
      expect(wrapper.get('[data-test="settings-initial-tab"]').text()).toBe("general");

      await wrapper.get('[data-test="appearance-tab"]').trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-test="settings-initial-tab"]').text()).toBe("appearance");

      await wrapper.get('[data-test="close-settings"]').trigger("click");
      await flushPromises();
      await wrapper.get('[data-test="open-settings"]').trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-test="settings-initial-tab"]').text()).toBe("appearance");
    } finally {
      wrapper.unmount();
    }
  });

  test("exports the starter theme template through the settings bridge", async () => {
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
            emits: ["exportThemeTemplate"],
            template: '<section data-test="settings-modal"><button data-test="export-theme-template" type="button" @click="$emit(\'exportThemeTemplate\')">Export Starter Theme</button></section>',
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
      await wrapper.get('[data-test="export-theme-template"]').trigger("click");
      await flushPromises();

      expect(api.exportConfiguration).toHaveBeenCalledWith(
        expect.stringContaining('"template": true'),
        { title: "Export Hero Siege starter theme", defaultPath: "hero-siege-theme-template.json" },
      );
      expect(JSON.parse(vi.mocked(api.exportConfiguration).mock.calls[0][0])).toMatchObject({
        kind: "theme",
        template: true,
        themeId: "dark",
      });
    } finally {
      wrapper.unmount();
    }
  });

  test("updates the full-window header title for the active view", async () => {
    installHeroSiegeCompanionApi();
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppTitlebar: { template: "<div />" },
          CompactView: { template: "<div />" },
          ItemFilterView: { template: '<section data-test="item-filter-view" />' },
          LiveSessionHeader: {
            props: ["title"],
            template: '<h1 data-test="view-title">{{ title }}</h1>',
          },
          LiveView: { template: '<section data-test="live-view" />' },
          PastRunsView: { template: '<section data-test="past-runs-view" />' },
          SettingsModal: { template: "<section />" },
          UpdateBanner: { template: "<div />" },
          WhatsNewPrompt: { template: "<div />" },
        },
      },
    });

    try {
      await flushPromises();
      expect(wrapper.get('[data-test="view-title"]').text()).toBe("Live Session");

      await buttonByText(wrapper, "Item Filter").trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-test="view-title"]').text()).toBe("Item Filter");

      await buttonByText(wrapper, "Past Runs").trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-test="view-title"]').text()).toBe("Past Runs");
    } finally {
      wrapper.unmount();
    }
  });

  test("routes Past Runs CSV export and summary copy through preload", async () => {
    const api = installHeroSiegeCompanionApi();
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppTitlebar: { template: "<div />" },
          CompactView: { template: "<div />" },
          ItemFilterView: { template: "<section />" },
          LiveSessionHeader: { template: "<section />" },
          LiveView: { template: "<section />" },
          PastRunsView: {
            emits: ["export-runs-csv", "copy-summary"],
            template: `
              <section data-test="past-runs-view">
                <button data-test="export-csv" type="button" @click="$emit('export-runs-csv', 'section,label\\nsummary,All Runs')">Export CSV</button>
                <button data-test="copy-summary" type="button" @click="$emit('copy-summary', '**Hero Siege Past Runs**')">Copy Summary</button>
              </section>
            `,
          },
          SettingsModal: { template: "<section />" },
          UpdateBanner: { template: "<div />" },
          WhatsNewPrompt: { template: "<div />" },
        },
      },
    });

    try {
      await flushPromises();
      await buttonByText(wrapper, "Past Runs").trigger("click");
      await flushPromises();
      await wrapper.get('[data-test="export-csv"]').trigger("click");
      await wrapper.get('[data-test="copy-summary"]').trigger("click");
      await flushPromises();

      expect(api.exportPastRunsCsv).toHaveBeenCalledWith("section,label\nsummary,All Runs");
      expect(api.writeClipboardText).toHaveBeenCalledWith("**Hero Siege Past Runs**");
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
    exportPastRunsCsv: vi.fn().mockResolvedValue(true),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    toggleMaximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    setCompactMode: vi.fn().mockResolvedValue(undefined),
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
    getSupportDiagnosticsInfo: vi.fn().mockResolvedValue({ userDataPath: "C:\\Users\\Tester", appVersion: "0.2.5", generatedFiles: [], logFiles: [] }),
    saveSupportDiagnostics: vi.fn().mockResolvedValue({ saved: false, canceled: true, filePath: null, includedFiles: [] }),
    checkForUpdate: vi.fn().mockResolvedValue(null),
    openRelease: vi.fn().mockResolvedValue(undefined),
    openNpcapGuide: vi.fn().mockResolvedValue(undefined),
    onStateUpdated: vi.fn(() => vi.fn()),
  };
  Object.defineProperty(window, "heroSiegeCompanion", { value: api, configurable: true });
  return api;
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`Unable to find button containing text: ${text}`);
  return button;
}
