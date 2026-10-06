import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import CompactView from "../../src/renderer/src/components/CompactView.vue";
import { createInitialCompanionState } from "../../src/shared/initial-state";
import { satanicZonePreparationDetail } from "../../src/renderer/src/lib/satanic-zone-preparation-display";

describe("preparation guidance in the compact overlay", () => {
  test("Prepare opens zone details so connection and cancellation cues are visible", async () => {
    const state = createInitialCompanionState(); state.satanicZone.refreshEnabled = true;
    const wrapper = mount(CompactView, { props: { state, now: 1_000, showZone: false,
      compactRunTileDisplays: [{ id: "sz", kind: "sz", label: "SZ", value: "--" }],
      runPausedLabel: "Paused", canToggleRunPaused: true, satanicZoneRefreshSubmitting: false } });
    await wrapper.get(".compact-zone-refresh-button").trigger("click");
    expect(wrapper.emitted("refreshSatanicZone")).toHaveLength(1);
    expect(wrapper.emitted("update:showZone")?.[0]).toEqual([true]);
    state.satanicZone.refreshPreparation = { phase: "waiting_connection", expiresAt: 121_000 };
    await wrapper.setProps({ state: { ...state }, showZone: true });
    expect(wrapper.get('[data-preparation="waiting_connection"]').text()).toContain("You can keep playing");
    expect(wrapper.get(".compact-zone-refresh-button").attributes("aria-label")).toBe("Cancel Satanic Zone refresh preparation");
  });
  test("Ready has no countdown even with a legacy expiry and absent readiness leaves old displays compatible", () => {
    expect(satanicZonePreparationDetail(undefined, 1_000)).toBeNull();
    expect(satanicZonePreparationDetail({ phase: "ready", expiresAt: 0 }, 1_000)).toContain("for this game session");
    expect(satanicZonePreparationDetail({ phase: "ready", expiresAt: null }, 1_000)).not.toMatch(/\d+s|restart|reconnect/i);
  });
  test("suspended guidance distinguishes retained RAM from permission to replay and requests no restart", () => {
    const detail = satanicZonePreparationDetail({ phase: "suspended", expiresAt: null }, 1_000);
    expect(detail).toContain("retained in memory"); expect(detail).toContain("Matching process IDs or connections cannot verify it");
    expect(detail).toContain("complete fresh game API initialization"); expect(detail).not.toContain("restart is required");
  });
});
