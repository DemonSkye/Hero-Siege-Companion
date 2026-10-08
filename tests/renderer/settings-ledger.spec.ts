import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, test, vi } from "vitest";

// Retained active-feature UI research; release exclusion is verified separately
// with the real false capability and real main/preload/UI production wiring.
vi.mock("../../src/shared/release-features", () => ({ ACTIVE_SATANIC_ZONE_REFRESH_ENABLED: true }));
import type { CaptureDiagnosticsState } from "../../src/shared/app-state";
import CompactCustomizeModal from "../../src/renderer/src/components/CompactCustomizeModal.vue";
import SettingsModal from "../../src/renderer/src/components/SettingsModal.vue";
import { cloneCompactRunTiles, defaultCompactRunTiles } from "../../src/renderer/src/lib/compact-tiles";
import { THEME_OPTIONS } from "../../src/renderer/src/lib/themes";

const captureDiagnostics: CaptureDiagnosticsState = {
  enhanced: { mode: "off", timedUntil: null },
  deep: { mode: "off", timedUntil: null },
};

function settingsProps(overrides: Record<string, unknown> = {}) {
  return {
    launchThroughSteam: true,
    gameExecutablePath: "C:\\Games\\Hero Siege\\Hero_Siege.exe",
    themeId: "voidglass" as const,
    compactThemeId: "voidglass" as const,
    themeCustomMode: false,
    compactThemeCustomMode: false,
    compactThemeMatchesApp: true,
    satanicZoneRefreshEnabled: false,
    themeOptions: THEME_OPTIONS,
    captureDiagnostics,
    diagnosticsNow: 1_000,
    supportDiagnostics: "Capture: stopped",
    supportGeneratedFiles: [{ name: "diagnostics-summary.txt", description: "Current support summary" }],
    supportLogFiles: [],
    supportLogsPath: "C:\\Temp\\Hero Siege Companion\\logs",
    supportBundleBusy: false,
    whatsNew: {
      version: "0.2.8",
      title: "A quieter companion",
      intro: "The full-size interface has been reorganized.",
      items: ["New settings ledger"],
      sections: [],
    },
    ...overrides,
  };
}

function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll("button").find((candidate) => candidate.text().trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("settings ledger", () => {
  test("nonempty Features remains registered and legacy deep links reveal its enabled controls", async () => {
    const wrapper = mount(SettingsModal, { props: settingsProps({ initialTab: "capture" }) });
    try {
      await nextTick();
      expect(wrapper.get('[data-settings-section="features"]').attributes("aria-current")).toBe("page");
      expect(wrapper.get("#settings-section-features").text()).toContain("Enable SZ Refresh");
      expect(wrapper.find("#settings-section-app").exists()).toBe(false);
      expect(wrapper.emitted("update:satanicZoneRefreshEnabled")).toBeUndefined();
    } finally { wrapper.unmount(); }
  });

  test("offers the private Market recorder without a hidden access preference", async () => {
    const wrapper = mount(SettingsModal, { props: settingsProps({ initialTab: "support" }) });
    expect(wrapper.text()).toContain("Private Market request");
    for (let count = 0; count < 4; count++) await wrapper.get(".settings-ledger-panel-heading").trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.text()).toContain("Private Market request");
    expect(wrapper.emitted("update:marketSearchEnabled")).toBeUndefined();
    wrapper.unmount();
  });

  test("Help & Support no longer offers the one-shot initialized SZ probe", () => {
    const wrapper = mount(SettingsModal, { props: settingsProps({ initialTab: "support" }) });
    expect(wrapper.text()).not.toContain("One-shot initialized SZ probe");
    expect(wrapper.text()).not.toContain("Collect native initialization");
    expect(wrapper.text()).not.toContain("Start one initialized attempt");
    wrapper.unmount();
  });

  test("keeps launch method as the only App decision and reveals the standalone path conditionally", async () => {
    const wrapper = mount(SettingsModal, { props: settingsProps() });

    expect(wrapper.text()).toContain("A small set of app-wide choices");
    expect(wrapper.text()).not.toContain("Game executable");
    expect(wrapper.text()).not.toContain("Always on top");
    expect(wrapper.text()).not.toContain("Timeline filter");
    expect(wrapper.text()).not.toContain("Done");

    await wrapper.setProps({ launchThroughSteam: false });
    expect(wrapper.text()).toContain("Game executable");
    expect((wrapper.get("#settings-game-executable").element as HTMLInputElement).value).toBe("C:\\Games\\Hero Siege\\Hero_Siege.exe");
  });

  test("offers five quiet sections and shows Legacy Custom only when migration data exists", async () => {
    const wrapper = mount(SettingsModal, { props: settingsProps() });

    expect(wrapper.findAll("[data-settings-section]").map((entry) => entry.text())).toEqual([
      "App",
      "Appearance",
      "Features",
      "Help & Support",
      "DevelopersAdvanced",
    ]);

    await button(wrapper, "Appearance").trigger("click");
    expect(wrapper.get("#settings-compact-theme").find("option").text()).toBe("Match Full App");
    expect(wrapper.text()).not.toContain("Legacy Custom");
    expect(wrapper.text()).not.toContain("Foreground fill");
    expect(wrapper.text()).not.toContain("Accent");

    await wrapper.setProps({ legacyThemeAvailable: true, legacyCompactThemeAvailable: true });
    expect(wrapper.findAll("option").filter((option) => option.text().includes("Legacy Custom"))).toHaveLength(2);
  });

  test("Features keeps waiting controls quiet and exposes technical guidance only through Details", async () => {
    const wrapper = mount(SettingsModal, {
      props: settingsProps({
        satanicZoneRefreshEnabled: true,
        satanicZoneLoginCache: { enabled: true, unlocked: true, automatic: true, status: "empty" },
      }),
    });
    await button(wrapper, "Features").trigger("click");
    expect(wrapper.get('.settings-login-cache-notice [role="status"]').text()).toBe("Waiting for a complete sign-in to save.");
    expect(wrapper.text()).not.toMatch(/unlocking key|Anyone who can read|Windows-encrypted|matching sign-in|No certificate/);
    expect(wrapper.findAll("button").some(entry => entry.text() === "Lock")).toBe(false);
    await button(wrapper, "Details").trigger("click");
    const explanation = wrapper.get(".settings-action-dialog").text();
    expect(explanation).toContain("Npcap");
    expect(explanation).toContain("server may reject");
    expect(explanation).toContain("Forget saved sign-in");
    expect(explanation).not.toContain("Anyone who can read");
    wrapper.unmount();
  });

  test("SZ Refresh toggles directly and explains automatic readiness and missed sign-in", async () => {
    const wrapper = mount(SettingsModal, { props: settingsProps() });
    await button(wrapper, "Features").trigger("click");

    await wrapper.get(".settings-switch input").trigger("change");
    expect(wrapper.emitted("update:satanicZoneRefreshEnabled")?.[0]).toEqual([true]);
    expect(wrapper.find(".settings-action-dialog").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Existing saved Off settings are preserved");

    await button(wrapper, "Details").trigger("click");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("No certificate installation");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("gets ready automatically");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("after the game next signs in");
    expect(wrapper.get(".settings-action-dialog").text()).not.toMatch(/Prepare|two.minutes|API|protocol/i);
    expect(wrapper.get(".settings-action-dialog").text()).toContain("requires consent during setup");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("not your Hero Siege password");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("Existing saved Off settings are preserved");
    expect(wrapper.get(".settings-action-dialog").text()).not.toContain("Anyone who can read");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("local unlocking key");
    expect(wrapper.get(".settings-action-dialog").text()).not.toContain("enter the passphrase each Companion session");
    expect(wrapper.get(".settings-action-dialog").text()).not.toMatch(/Windows encryption|build matching/);
    expect(wrapper.find('a[href*="mitmproxy"]').exists()).toBe(false);
  });

  test("explains loaded saved Refresh after restart or stopped capture separately from live sign-in continuity", async () => {
    const wrapper = mount(SettingsModal, {
      props: settingsProps({
        satanicZoneRefreshEnabled: true,
        satanicZoneLoginCache: { enabled: true, unlocked: true, automatic: true, status: "loaded" },
      }),
    });
    await button(wrapper, "Features").trigger("click");
    const notice = wrapper.get(".settings-notice").text();
    expect(notice).not.toContain("With a loaded saved sign-in");
    expect(notice).not.toContain("Capture interruptions");
    expect(notice).not.toContain("without a validated saved sign-in");
    expect(notice).not.toContain("Capture interruptions pause Refresh until");

    await button(wrapper, "Details").trigger("click");
    const explanation = wrapper.get(".settings-action-dialog").text();
    expect(explanation).toContain("With a loaded saved sign-in and known server, you can try Refresh after restarting Companion or stopping capture");
    expect(explanation).toContain("The server may reject the saved sign-in");
    expect(explanation).toContain("Capture interruptions pause Refresh using live sign-in data");
    expect(explanation).toContain("Requests are sent only when you click Refresh");
    expect(explanation).not.toMatch(/Current account and mode must still match|validated saved sign-in/);
    wrapper.unmount();
  });

  test("explains that older saved sign-ins can obtain their server without a new login", async () => {
    const wrapper = mount(SettingsModal, {
      props: settingsProps({
        satanicZoneRefreshEnabled: true,
        satanicZoneLoginCache: { enabled: true, unlocked: true, status: "route_required" },
      }),
    });
    await button(wrapper, "Features").trigger("click");
    expect(wrapper.get(".settings-notice").text()).not.toContain("Older saved sign-ins");
    await button(wrapper, "Details").trigger("click");
    expect(wrapper.get(".settings-action-dialog").text()).toContain("Older saved sign-ins without a known server wait for the game's server connection to be observed; a new sign-in is not required");
    wrapper.unmount();
  });

  test("emits enhanced diagnostics directly but confirmation-gates every deep activation", async () => {
    const wrapper = mount(SettingsModal, { props: settingsProps() });
    await button(wrapper, "Help & Support").trigger("click");

    await button(wrapper, "Turn On").trigger("click");
    expect(wrapper.emitted("setDiagnosticsMode")?.[0]).toEqual(["enhanced", "manual"]);

    await button(wrapper, "Start 10 min…").trigger("click");
    expect(wrapper.emitted("setDiagnosticsMode")).toHaveLength(1);
    expect(wrapper.get(".settings-action-dialog").text()).toContain("may contain character, chat, or platform metadata");
    await button(wrapper, "Start 10 Minutes").trigger("click");
    expect(wrapper.emitted("setDiagnosticsMode")?.[1]).toEqual(["deep", "timed"]);
  });

  test("renders the main-owned timed-diagnostics deadline as a countdown", async () => {
    const wrapper = mount(SettingsModal, {
      props: settingsProps({
        diagnosticsNow: 1_000,
        captureDiagnostics: {
          enhanced: { mode: "timed", timedUntil: 601_000 },
          deep: { mode: "off", timedUntil: null },
        },
      }),
    });
    await button(wrapper, "Help & Support").trigger("click");

    expect(wrapper.text()).toContain("10:00 remaining");
    expect(button(wrapper, "Stop").attributes("aria-pressed")).toBe("true");
  });

  test("keeps Escape inside a nested confirmation and restores focus when the settings modal closes", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const wrapper = mount(SettingsModal, { attachTo: document.body, props: settingsProps() });
    await nextTick();

    expect(document.activeElement).toBe(wrapper.get('[role="dialog"]').element);
    await button(wrapper, "Features").trigger("click");
    await button(wrapper, "Details").trigger("click");
    await nextTick();
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("Close dialog");

    await wrapper.get(".settings-action-backdrop").trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".settings-action-dialog").exists()).toBe(false);
    expect(wrapper.emitted("close")).toBeUndefined();

    wrapper.unmount();
    await nextTick();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test("previews a backup before restore and preserves item filters by default during factory reset", async () => {
    const wrapper = mount(SettingsModal, { props: settingsProps() });
    await button(wrapper, "Help & Support").trigger("click");

    await wrapper.setProps({
      backupPreview: {
        sourceVersion: 2,
        settings: 4,
        filterGroups: 3,
        sounds: 7,
        customThemes: 1,
        compactTiles: 6,
        legacyFormat: false,
      },
    });
    await nextTick();
    expect(wrapper.get(".settings-action-dialog").text()).toContain("3 item filters");
    await button(wrapper, "Restore Backup").trigger("click");
    expect(wrapper.emitted("confirmRestoreBackup")).toHaveLength(1);

    await wrapper.setProps({ backupPreview: null });
    await button(wrapper, "Factory Reset…").trigger("click");
    expect((wrapper.get(".settings-dialog-option input").element as HTMLInputElement).checked).toBe(false);
    await button(wrapper, "Factory Reset").trigger("click");
    expect(wrapper.emitted("factoryReset")?.[0]).toEqual([false]);
  });
});

describe("compact customization", () => {
  test("uses presets, an Add Tile menu, a selected list, and an Advanced custom-tile editor", async () => {
    const wrapper = mount(CompactCustomizeModal, {
      props: {
        compactRunTiles: cloneCompactRunTiles(defaultCompactRunTiles),
        itemFilterGroups: [{ id: "merc", name: "Merc Items", enabled: true, soundId: "none", volume: 1, cooldownMs: 0, rarities: [], types: [], items: [] }],
        itemSuggestions: ["Mystic Soles"],
      },
    });

    expect(wrapper.findAll(".compact-selected-list > li")).toHaveLength(defaultCompactRunTiles.length);
    expect(wrapper.text()).not.toContain("Run dashboard tiles");
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);

    await button(wrapper, "Add Tile").trigger("click");
    await button(wrapper, "Keys").trigger("click");
    const addedTiles = wrapper.emitted("update:compactRunTiles")?.[0]?.[0] as Array<{ kind: string }>;
    expect(addedTiles.at(-1)?.kind).toBe("keys");

    const customWrapper = mount(CompactCustomizeModal, {
      props: {
        compactRunTiles: cloneCompactRunTiles(defaultCompactRunTiles),
        itemFilterGroups: [],
        itemSuggestions: ["Mystic Soles"],
      },
    });
    const advanced = customWrapper.get(".compact-advanced-tiles");
    await advanced.get("summary").trigger("click");
    await button(customWrapper, "Add Custom Tile").trigger("click");
    const customTiles = customWrapper.emitted("update:compactRunTiles")?.at(-1)?.[0] as Array<{ kind: string }>;
    expect(customTiles.at(-1)?.kind).toBe("custom");

    await button(wrapper, "Reset Layout…").trigger("click");
    await button(wrapper, "Reset Layout").trigger("click");
    expect(wrapper.emitted("reset")).toHaveLength(1);
  });
});
