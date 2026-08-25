import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import SatanicZonePanel from "../../src/renderer/src/components/SatanicZonePanel.vue";
import type { SatanicZoneState } from "../../src/shared/satanic-zone";

const NOW = new Date("2026-08-24T15:20:00.000Z").getTime();

describe("SatanicZonePanel", () => {
  test("shows current freshness and emits one manual refresh", async () => {
    const wrapper = mountPanel(currentZoneState());

    expect(wrapper.get('.zone-status[data-phase="current"]').text()).toContain("Current");
    expect(wrapper.text()).toContain("Observed from the game's own network traffic.");
    expect(wrapper.text()).toContain("Observed 2m ago");
    expect(wrapper.text()).toContain("Valid until");
    expect(wrapper.get(".info-bubble").attributes("data-tip")).toContain(
      "does not require a vote reset or leaving your zone.",
    );
    expect(wrapper.get(".info-bubble").attributes("data-tip")).toContain("VPN or proxy setups may interfere");

    const refreshButton = wrapper.get(".zone-refresh-button");
    expect(refreshButton.attributes("disabled")).toBeUndefined();
    expect(refreshButton.attributes("title")).toBe("Refresh Satanic Zone");
    expect(refreshButton.attributes("aria-label")).toBe("Refresh Satanic Zone");
    expect(refreshButton.get("svg").attributes("aria-hidden")).toBe("true");

    await refreshButton.trigger("click");

    expect(wrapper.emitted("refresh")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Manual refresh");
  });

  test("hides manual refresh completely when the opt-in is disabled", () => {
    const wrapper = mountPanel(currentZoneState({
      refreshEnabled: false,
      refreshAvailable: false,
      refreshExperimental: false,
      errorCode: "refresh_disabled",
    }));

    expect(wrapper.find(".zone-refresh-button").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Manual refresh");
    expect(wrapper.text()).not.toContain("Enable manual refresh");
    expect(wrapper.text()).not.toContain("Settings > Capture");
  });

  test("marks expired zone data stale instead of presenting it as current", () => {
    const state = currentZoneState({ validUntil: NOW - 1 });
    state.current = { ...state.current!, updatedAt: NOW - 31 * 60_000 };
    const wrapper = mountPanel(state);

    expect(wrapper.get('.zone-status[data-phase="stale"]').text()).toContain("Stale");
    expect(wrapper.text()).toContain("expired and is shown for reference");
    expect(wrapper.text()).toContain("Act 8: Forgotten Caves");
  });

  test("reports relay startup without inventing a world-entry requirement", () => {
    const wrapper = mountPanel(currentZoneState({
      current: null,
      phase: "unavailable",
      source: null,
      lastSuccessAt: null,
      validUntil: null,
      refreshAvailable: false,
      errorCode: "helper_not_ready",
    }));

    expect(wrapper.get('.zone-status[data-phase="unavailable"]').text()).toContain(
      "local refresh relay has not finished starting",
    );
    expect(wrapper.text()).not.toContain("world-entry");
  });

  test("disables refresh immediately while the renderer is submitting the request", async () => {
    const wrapper = mountPanel(currentZoneState(), true);
    const refreshButton = wrapper.get(".zone-refresh-button");

    expect(refreshButton.attributes("disabled")).toBeDefined();
    expect(refreshButton.attributes("title")).toBe("Submitting a manual refresh request.");
    expect(refreshButton.attributes("aria-label")).toBe("Refresh Satanic Zone: submitting request");

    await refreshButton.trigger("click");
    expect(wrapper.emitted("refresh")).toBeUndefined();
  });

  test("disables refresh only until the cooldown deadline passes", async () => {
    const wrapper = mountPanel(currentZoneState({ nextAllowedRefreshAt: NOW + 65_000 }));
    const refreshButton = wrapper.get(".zone-refresh-button");

    expect(refreshButton.attributes("disabled")).toBeDefined();
    expect(refreshButton.attributes("title")).toBe("Refresh available in 1m 5s.");
    expect(refreshButton.attributes("aria-label")).toBe(
      "Refresh Satanic Zone unavailable: Refresh available in 1m 5s.",
    );

    await wrapper.setProps({ now: NOW + 65_000 });
    expect(refreshButton.attributes("disabled")).toBeUndefined();
    await refreshButton.trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  test.each([
    {
      name: "a passive update and unavailable cached relay overlap",
      state: currentZoneState({
        phase: "updating",
        refreshAvailable: false,
        errorCode: "helper_unavailable",
      }),
    },
    {
      name: "the main lifecycle is refreshing",
      state: currentZoneState({ phase: "refreshing" }),
    },
    {
      name: "the cached relay availability is false with a terminal-looking error",
      state: currentZoneState({ refreshAvailable: false, errorCode: "one_shot_consumed" }),
    },
    {
      name: "the cached relay is not configured",
      state: currentZoneState({
        refreshAvailable: false,
        refreshExperimental: false,
        errorCode: "refresh_not_configured",
      }),
    },
  ])(
    "keeps opted-in refresh clickable when $name so main can perform the authoritative preflight",
    async ({ state }) => {
      const wrapper = mountPanel(state);
      const refreshButton = wrapper.get(".zone-refresh-button");

      expect(refreshButton.attributes("disabled")).toBeUndefined();
      expect(refreshButton.attributes("title")).toBe("Refresh Satanic Zone");
      expect(refreshButton.attributes("aria-label")).toBe("Refresh Satanic Zone");

      await refreshButton.trigger("click");

      expect(wrapper.emitted("refresh")).toHaveLength(1);
    },
  );
});

function mountPanel(
  zoneState: SatanicZoneState,
  refreshSubmitting = false,
) {
  return mount(SatanicZonePanel, {
    props: {
      zoneState,
      now: NOW,
      zoneCountdown: "10:00",
      zoneResetLabel: "11:30 AM",
      refreshSubmitting,
    },
  });
}

function currentZoneState(overrides: Partial<SatanicZoneState> = {}): SatanicZoneState {
  return {
    current: {
      rawZone: "Act_08_03",
      zone: "Act 8: Forgotten Caves",
      act: 8,
      area: 3,
      pros: [{ id: 1, name: "Treasure Goblin", description: "More loot." }],
      cons: [{ id: 2, name: "Lingering Evil", description: "More danger." }],
      buffs: [],
      updatedAt: NOW - 120_000,
    },
    phase: "current",
    source: "captured",
    lastAttemptAt: NOW - 121_000,
    lastSuccessAt: NOW - 120_000,
    validUntil: NOW + 600_000,
    nextAllowedRefreshAt: null,
    errorCode: null,
    refreshEnabled: true,
    refreshAvailable: true,
    refreshExperimental: true,
    ...overrides,
  };
}
