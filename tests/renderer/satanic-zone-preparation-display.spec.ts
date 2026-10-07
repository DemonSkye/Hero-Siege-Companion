import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import CompactView from "../../src/renderer/src/components/CompactView.vue";
import { createInitialCompanionState } from "../../src/shared/initial-state";
import { satanicZonePreparationDetail } from "../../src/renderer/src/lib/satanic-zone-preparation-display";

describe("preparation guidance in the compact overlay", () => {
  test("Refresh opens zone details when ready; waiting shows the reason and cannot dispatch", async () => {
    const state = createInitialCompanionState(); state.satanicZone.refreshEnabled = true;
    state.satanicZone.refreshPreparation = { phase: "ready", expiresAt: null };
    const wrapper = mount(CompactView, { props: { state, now: 1_000, showZone: false,
      compactRunTileDisplays: [{ id: "sz", kind: "sz", label: "SZ", value: "--" }],
      runPausedLabel: "Paused", canToggleRunPaused: true, satanicZoneRefreshSubmitting: false } });
    await wrapper.get(".compact-zone-refresh-button").trigger("click");
    expect(wrapper.emitted("refreshSatanicZone")).toHaveLength(1);
    expect(wrapper.emitted("update:showZone")?.[0]).toEqual([true]);
    state.satanicZone.refreshPreparation = { phase: "waiting_connection", expiresAt: 121_000 };
    await wrapper.setProps({ state: { ...state }, showZone: true });
    expect(wrapper.get('[data-preparation="waiting_connection"]').text()).toContain("You can keep playing");
    expect(wrapper.get(".compact-zone-refresh-button").attributes("aria-label")).toContain("Refresh Satanic Zone unavailable");
    expect(wrapper.get(".compact-zone-refresh-button").attributes("disabled")).toBeDefined();
  });
  test("Ready has no countdown even with a legacy expiry and absent readiness leaves old displays compatible", () => {
    expect(satanicZonePreparationDetail(undefined, 1_000)).toBeNull();
    expect(satanicZonePreparationDetail({ phase: "ready", expiresAt: 0 }, 1_000)).toBe("Ready to refresh.");
    expect(satanicZonePreparationDetail({ phase: "ready", expiresAt: null }, 1_000)).not.toMatch(/\d+s|restart|reconnect/i);
  });
  test("suspended guidance explains capture and new sign-in without requesting a restart", () => {
    const detail = satanicZonePreparationDetail({ phase: "suspended", expiresAt: null }, 1_000);
    expect(detail).toContain("Resume capture"); expect(detail).toContain("sign in again");
    expect(detail).not.toMatch(/Prepare|restart|API|protocol|two.minutes/i);
  });
  test("missed login is honest about availability and allows continued play", () => {
    const detail = satanicZonePreparationDetail({ phase: "waiting_connection", expiresAt: null, reason: "login_missed" }, 1_000);
    expect(detail).toContain("was not observed"); expect(detail).toContain("unavailable"); expect(detail).toContain("keep playing");
    expect(detail).not.toContain("already completed");
  });
  test("an enabled empty cache identifies missing saved sign-in instead of promising restore", () => {
    const detail = satanicZonePreparationDetail({ phase: "waiting_connection", expiresAt: null, reason: "cache_empty" }, 1_000);
    expect(detail).toContain("No saved sign-in"); expect(detail).toContain("complete sign-in");
  });
  test("locked cache guidance names unlock and lets native Ready remain available", () => {
    expect(satanicZonePreparationDetail({ phase: "waiting_connection", expiresAt: null, reason: "cache_locked" }, 1_000))
      .toContain("Unlock Remember sign-in in Features");
    expect(satanicZonePreparationDetail({ phase: "waiting_connection", expiresAt: null, reason: "cache_unlock_failed" }, 1_000))
      .toContain("Check the passphrase");
    expect(satanicZonePreparationDetail({ phase: "ready", expiresAt: null, reason: "cache_locked" }, 1_000))
      .toBe("Ready to refresh.");
    expect(satanicZonePreparationDetail({ phase: "ready", expiresAt: null, reason: "cache_unlock_failed" }, 1_000))
      .toBe("Ready to refresh.");
  });
  test("cached Ready names loaded inputs without requiring game identity or claiming executable validation", () => {
    const detail = satanicZonePreparationDetail({ phase: "ready", origin: "cached", expiresAt: null }, 1_000);
    expect(detail).toContain("Saved sign-in loaded");
    expect(detail).toContain("Ready to refresh");
    expect(detail).not.toMatch(/build|Windows|Prepare|countdown/);
  });
});
