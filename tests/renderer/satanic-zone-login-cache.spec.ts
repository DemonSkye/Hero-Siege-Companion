import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import SatanicZoneLoginCacheSettings from "../../src/renderer/src/components/SatanicZoneLoginCacheSettings.vue";
afterEach(() => vi.unstubAllGlobals());
test("cache is visibly experimental and off; explicit toggle/clear call only narrow control IPC", async () => {
  const enable = vi.fn(async () => ({})), clear = vi.fn(async () => ({}));
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: { setSatanicZoneLoginCacheEnabled: enable, clearSatanicZoneLoginCache: clear } });
  const wrapper = mount(SatanicZoneLoginCacheSettings, { props: { refreshEnabled: true, state: { enabled: false, status: "disabled" } } });
  expect(wrapper.text()).toContain("experimental"); expect(wrapper.text()).toContain("Windows encryption");
  expect((wrapper.get("input").element as HTMLInputElement).checked).toBe(false);
  await wrapper.get("input").setValue(true); await flushPromises(); expect(enable).toHaveBeenCalledWith(true);
  await wrapper.get("button").trigger("click"); await flushPromises(); expect(clear).toHaveBeenCalledWith();
  expect(enable).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledTimes(1); wrapper.unmount();
});
test("unverified and mismatch show concrete reasons; Refresh disabled cannot enable cache", async () => {
  const wrapper = mount(SatanicZoneLoginCacheSettings, { props: { refreshEnabled: false, state: { enabled: true, status: "unverified" } } });
  expect(wrapper.get("input").attributes("disabled")).toBeDefined(); expect(wrapper.text()).toContain("fresh account and mode evidence");
  await wrapper.setProps({ state: { enabled: true, status: "identity_mismatch" } }); expect(wrapper.text()).toContain("did not match");
  await wrapper.setProps({ state: { enabled: false, status: "clear_failed" } }); expect(wrapper.text()).toContain("Could not delete"); wrapper.unmount();
});
