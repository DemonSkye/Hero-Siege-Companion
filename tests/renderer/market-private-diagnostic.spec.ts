import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import MarketPrivateDiagnosticSettings from "../../src/renderer/src/components/MarketPrivateDiagnosticSettings.vue";
import type { MarketPrivateDiagnosticState } from "../../src/shared/market-private-diagnostic";
afterEach(() => vi.unstubAllGlobals());
test("private recording explains raw sign-in risk and remains off until its own explicit action", async () => {
  let changed!: (state: MarketPrivateDiagnosticState) => void;
  const unsubscribe = vi.fn(), api = {
    getMarketPrivateDiagnosticState: vi.fn(async () => ({ phase: "off" })),
    setMarketPrivateDiagnosticEnabled: vi.fn(async (enabled: boolean) => ({ phase: enabled ? "armed" : "off", filePath: "C:/Temp/private-market-test.jsonl" })),
    onMarketPrivateDiagnosticUpdated: vi.fn(callback => { changed = callback; return unsubscribe; }),
    openMarketPrivateDiagnosticDirectory: vi.fn(async () => true), searchMarket: vi.fn(),
  };
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: api });
  const wrapper = mount(MarketPrivateDiagnosticSettings); await flushPromises();
  expect(api.setMarketPrivateDiagnosticEnabled).not.toHaveBeenCalled(); expect(api.searchMarket).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("reusable sign-in values"); expect(wrapper.text()).toContain("kept until you delete");
  expect(wrapper.text()).toContain("outside support logs"); expect(wrapper.get('[role="status"]').text()).toBe("Off.");
  await wrapper.findAll("button").find(button => button.text() === "Save next Market request locally")!.trigger("click"); await flushPromises();
  expect(api.setMarketPrivateDiagnosticEnabled).toHaveBeenCalledWith(true); expect(api.searchMarket).not.toHaveBeenCalled();
  expect(wrapper.get('[role="status"]').text()).toContain("next Market search you run");
  changed({ phase: "recording" }); await flushPromises(); expect(wrapper.findAll("button")).toHaveLength(0);
  changed({ phase: "saved", completeResponse: false, filePath: "C:/Temp/private-market-test.jsonl" }); await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain("partial evidence");
  await wrapper.findAll("button").find(button => button.text() === "Open private folder")!.trigger("click");
  expect(api.openMarketPrivateDiagnosticDirectory).toHaveBeenCalledOnce();
  wrapper.unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
});
