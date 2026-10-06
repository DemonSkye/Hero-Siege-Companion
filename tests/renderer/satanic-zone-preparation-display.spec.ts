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
    expect(wrapper.get('[data-preparation="waiting_connection"]').text()).toContain("Reconnect or restart Hero Siege now");
    expect(wrapper.get(".compact-zone-refresh-button").attributes("aria-label")).toBe("Cancel Satanic Zone refresh preparation");
  });
  test("remaining lifetime never becomes negative and absent readiness leaves old state displays compatible", () => {
    expect(satanicZonePreparationDetail(undefined, 1_000)).toBeNull();
    expect(satanicZonePreparationDetail({ phase: "ready", expiresAt: 0 }, 1_000)).toContain("for 0s");
  });
});
