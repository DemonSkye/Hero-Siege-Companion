import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { expect, test } from "vitest";
import { ACTIVE_SATANIC_ZONE_REFRESH_ENABLED } from "../../src/shared/release-features";
import SettingsModal from "../../src/renderer/src/components/SettingsModal.vue";
import { THEME_OPTIONS } from "../../src/renderer/src/lib/themes";

function settingsProps(initialTab = "app") {
  return {
    initialTab,
    launchThroughSteam: true,
    gameExecutablePath: "",
    themeId: "voidglass" as const,
    compactThemeId: "voidglass" as const,
    themeCustomMode: false,
    compactThemeCustomMode: false,
    compactThemeMatchesApp: true,
    // Legacy saved state must not make a parked control visible or get rewritten.
    satanicZoneRefreshEnabled: true,
    satanicZoneLoginCache: { enabled: true, unlocked: true, automatic: true, status: "loaded" as const },
    themeOptions: THEME_OPTIONS,
    captureDiagnostics: { enhanced: { mode: "off" as const, timedUntil: null }, deep: { mode: "off" as const, timedUntil: null } },
    diagnosticsNow: 1_000,
    supportDiagnostics: "Capture: stopped",
    supportGeneratedFiles: [],
    supportLogFiles: [],
    supportLogsPath: "",
    supportBundleBusy: false,
    whatsNew: { version: "0.3.1", title: "Companion", intro: "", items: [], sections: [] },
  };
}

test("an empty Features section has neither navigation nor panel and preserves legacy preferences", () => {
  expect(ACTIVE_SATANIC_ZONE_REFRESH_ENABLED).toBe(false);
  const wrapper = mount(SettingsModal, { props: settingsProps() });
  try {
    expect(wrapper.findAll("[data-settings-section]").map(entry => entry.attributes("data-settings-section")))
      .toEqual(["app", "appearance", "support", "developers"]);
    expect(wrapper.find("#settings-section-features").exists()).toBe(false);
    expect(wrapper.props("satanicZoneRefreshEnabled")).toBe(true);
    expect(wrapper.props("satanicZoneLoginCache")).toEqual({ enabled: true, unlocked: true, automatic: true, status: "loaded" });
    expect(wrapper.emitted("update:satanicZoneRefreshEnabled")).toBeUndefined();
  } finally { wrapper.unmount(); }
});

test.each(["features", "capture"])("a hidden %s deep link selects the populated App default", async initialTab => {
  const wrapper = mount(SettingsModal, { props: settingsProps(initialTab) });
  try {
    await nextTick();
    expect(wrapper.get('[data-settings-section="app"]').attributes("aria-current")).toBe("page");
    expect(wrapper.get("#settings-section-app").text()).toContain("Game launch");
    expect(wrapper.find("#settings-section-features").exists()).toBe(false);
    expect(wrapper.emitted("settingsTabChange")).toEqual([["app"]]);
  } finally { wrapper.unmount(); }
});

test("navigation skips empty Features and a changed deep link restores focus to a valid section", async () => {
  const wrapper = mount(SettingsModal, { attachTo: document.body, props: settingsProps("appearance") });
  try {
    await nextTick();
    const appearance = wrapper.get('[data-settings-section="appearance"]');
    (appearance.element as HTMLButtonElement).focus();
    await appearance.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.get('[data-settings-section="support"]').attributes("aria-current")).toBe("page");
    expect(document.activeElement).toBe(wrapper.get('[data-settings-section="support"]').element);
    await wrapper.get('[data-settings-section="support"]').trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.get('[data-settings-section="appearance"]').attributes("aria-current")).toBe("page");

    await wrapper.setProps({ initialTab: "features" });
    await nextTick();
    expect(document.activeElement).toBe(wrapper.get('[data-settings-section="app"]').element);
    expect(wrapper.get("#settings-section-app").text()).toContain("Game launch");
    await wrapper.get('[data-settings-section="app"]').trigger("keydown", { key: "End" });
    expect(wrapper.get('[data-settings-section="developers"]').attributes("aria-current")).toBe("page");
    await wrapper.get('[data-settings-section="developers"]').trigger("keydown", { key: "Home" });
    expect(wrapper.get('[data-settings-section="app"]').attributes("aria-current")).toBe("page");
    expect(wrapper.emitted("update:satanicZoneRefreshEnabled")).toBeUndefined();
  } finally { wrapper.unmount(); }
});
