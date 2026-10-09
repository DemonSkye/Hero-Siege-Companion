import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import { ACTIVE_SATANIC_ZONE_REFRESH_ENABLED } from "../../src/shared/release-features";
import SatanicZonePanel from "../../src/renderer/src/components/SatanicZonePanel.vue";
import CompactView from "../../src/renderer/src/components/CompactView.vue";
import SettingsCaptureTab from "../../src/renderer/src/components/SettingsCaptureTab.vue";
import { companionState } from "./fixtures";

test("release hides full and compact active controls even with forged legacy Ready; passive freshness and effects survive", async () => {
  expect(ACTIVE_SATANIC_ZONE_REFRESH_ENABLED).toBe(false);
  const now = new Date("2026-10-07T20:05:00Z").getTime();
  const state = companionState();
  state.satanicZone = { ...state.satanicZone, refreshEnabled: true, refreshAvailable: true,
    refreshPreparation: { phase: "ready", expiresAt: null }, phase: "current", source: "captured", lastSuccessAt: now,
    validUntil: new Date("2026-10-07T20:30:00Z").getTime(),
    current: { rawZone: "Act_01_01", zone: "Act 1: Fields", act: 1, area: 1, updatedAt: now,
      buffs: [], pros: [{ id: 1, name: "Passive benefit", description: "Observed effect" }], cons: [] } };
  const panel = mount(SatanicZonePanel, { props: { zoneState: state.satanicZone, now, zoneCountdown: "25m", zoneResetLabel: "20:30", refreshSubmitting: false } });
  const compact = mount(CompactView, { props: { state, now,
    pages: [{ id: "zone", name: "Satanic Zone", kind: "zone", tiles: [] }, { id: "run", name: "Run", kind: "tiles", tiles: [{ id: "sz", kind: "sz", label: "SZ", value: "25m" }] }],
    navigation: { wheel: true, arrowKeys: true, pageKeys: true, wrap: true }, sessionDuration: "0:00", zoneCountdown: "25m",
    runPausedLabel: "Pause", canToggleRunPaused: true, satanicZoneRefreshSubmitting: false } });
  try {
    expect(panel.find(".zone-refresh-button").exists()).toBe(false);
    expect(compact.find(".compact-zone-refresh-button").exists()).toBe(false);
    expect(panel.find(".zone-preparation").exists()).toBe(false);
    expect(panel.get(".info-bubble").attributes("data-tip")).toContain("game’s own traffic");
    expect(panel.text()).toContain("Observed from the game's own network traffic");
    expect(panel.text()).toContain("Passive benefit");
    expect(compact.text()).toContain("Passive benefit");
    await panel.setProps({ now: now + 31 * 60_000 });
    await compact.setProps({ now: now + 31 * 60_000 });
    expect(panel.get(".zone-status").text()).toContain("Stale");
    expect(compact.text()).toContain("Stale");
    expect(panel.emitted("refresh")).toBeUndefined();
    expect(compact.emitted("refreshSatanicZone")).toBeUndefined();
  } finally { panel.unmount(); compact.unmount(); }
});

test("release exposes no enable, cache, passphrase or technical-details controls for legacy enabled settings", () => {
  const wrapper = mount(SettingsCaptureTab, { props: { satanicZoneRefreshEnabled: true,
    satanicZoneLoginCache: { enabled: true, unlocked: true, automatic: true, status: "loaded" } } });
  expect(wrapper.find("input").exists()).toBe(false);
  expect(wrapper.find("button").exists()).toBe(false);
  expect(wrapper.text()).toContain("Manual Refresh is temporarily unavailable");
  expect(wrapper.text()).not.toMatch(/Remember sign-in|passphrase|ready automatically/);
  wrapper.unmount();
});
