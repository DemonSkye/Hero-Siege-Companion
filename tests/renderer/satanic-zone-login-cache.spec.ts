import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import SatanicZoneLoginCacheSettings from "../../src/renderer/src/components/SatanicZoneLoginCacheSettings.vue";
import type { SatanicZoneLoginCacheState } from "../../src/shared/satanic-zone-login-cache";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); });
function api() {
  const methods = {
    setSatanicZoneLoginCacheEnabled: vi.fn(async (_enabled: boolean) => ({})),
    unlockSatanicZoneLoginCache: vi.fn(async (_passphrase: string) => ({})),
    lockSatanicZoneLoginCache: vi.fn(async () => ({})),
    clearSatanicZoneLoginCache: vi.fn(async () => ({})),
  };
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: methods });
  return methods;
}
function mountCache(state: SatanicZoneLoginCacheState = { enabled: false, unlocked: false, status: "disabled" }, refreshEnabled = true) {
  const wrapper = mount(SatanicZoneLoginCacheSettings, { props: { refreshEnabled, state } });
  wrappers.push(wrapper);
  return wrapper;
}
function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll("button").find(candidate => candidate.text() === label);
  if (!match) throw new Error("Missing button: " + label);
  return match;
}
const locked = (): SatanicZoneLoginCacheState => ({ enabled: true, unlocked: false, status: "locked" });

test("default-off explicit opt-in does not unlock, save or dispatch; exposes the portable storage tradeoffs", async () => {
  const methods = api();
  const wrapper = mountCache();
  expect(wrapper.text()).toContain("experimental");
  expect(wrapper.text()).toContain("encrypted with your passphrase");
  expect(wrapper.text()).toContain("lost passphrase cannot be recovered");
  expect(wrapper.text()).toContain("Anyone with the file and passphrase");
  expect(wrapper.text()).toContain("may not be accepted across game sessions");
  expect(wrapper.text()).toContain("Older Windows-encrypted files are left untouched");
  expect(wrapper.text()).not.toContain("Windows encryption");
  expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await flushPromises();
  expect(methods.setSatanicZoneLoginCacheEnabled).toHaveBeenCalledWith(true);
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  expect(methods.clearSatanicZoneLoginCache).not.toHaveBeenCalled();
  await wrapper.setProps({ state: locked() });
  expect(wrapper.find('input[type="password"]').exists()).toBe(true);
  expect(button(wrapper, "Unlock").attributes("disabled")).toBeDefined();
});

test("unlock sends the exact explicit passphrase once, clears it before IPC settles and disables pending controls", async () => {
  const methods = api();
  let resolve!: (value: object) => void;
  methods.unlockSatanicZoneLoginCache.mockImplementation(() => new Promise(done => { resolve = done; }));
  const wrapper = mountCache(locked());
  const input = wrapper.get('input[type="password"]');
  expect(input.attributes("autocomplete")).toBe("off");
  expect(input.attributes("aria-describedby")).toBe("settings-sz-cache-passphrase-help");
  await input.setValue("short");
  await wrapper.get("form").trigger("submit");
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  const secret = "  invented passphrase  ";
  await input.setValue(secret);
  await wrapper.get("form").trigger("submit");
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledWith(secret);
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(wrapper.html()).not.toContain(secret);
  expect(input.attributes("disabled")).toBeDefined();
  expect(wrapper.get('input[type="checkbox"]').attributes("disabled")).toBeDefined();
  expect(button(wrapper, "Forget saved sign-in").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledTimes(1);
  resolve({}); await flushPromises();
  expect(input.attributes("disabled")).toBeUndefined();
});

test("unlock mirrors Unicode character and UTF-8 byte limits before sending", async () => {
  const methods = api();
  const wrapper = mountCache(locked());
  const input = wrapper.get('input[type="password"]');
  // Six emoji contain 12 UTF-16 units, but only six Unicode code points.
  await input.setValue("\u{1F600}".repeat(6));
  expect(button(wrapper, "Unlock").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();

  const twelveCharacters = "\u732B".repeat(12);
  await input.setValue(twelveCharacters);
  expect(button(wrapper, "Unlock").attributes("disabled")).toBeUndefined();
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledWith(twelveCharacters);

  // Each character occupies three UTF-8 bytes: 342 characters exceed 1,024 bytes.
  await input.setValue("\u732B".repeat(342));
  expect(button(wrapper, "Unlock").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledTimes(1);

  const exactByteLimit = "\u{1F600}".repeat(256);
  await input.setValue(exactByteLimit);
  expect(button(wrapper, "Unlock").attributes("disabled")).toBeUndefined();
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenLastCalledWith(exactByteLimit);
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledTimes(2);
});

test("cancel, disable, successful unlock and unmount clear transient input without dispatching it", async () => {
  const methods = api();
  const wrapper = mountCache(locked());
  let input = wrapper.get('input[type="password"]');
  await input.setValue("invented cancel secret");
  await button(wrapper, "Cancel").trigger("click");
  expect((input.element as HTMLInputElement).value).toBe("");
  await input.setValue("invented retained secret");
  // Main publishes unrelated state often; unchanged lock state must not erase an unfinished entry.
  await wrapper.setProps({ state: { ...locked() } });
  expect((input.element as HTMLInputElement).value).toBe("invented retained secret");
  await wrapper.setProps({ refreshEnabled: false });
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  await wrapper.setProps({ refreshEnabled: true });
  input = wrapper.get('input[type="password"]');
  await input.setValue("invented unlock secret");
  await wrapper.setProps({ state: { enabled: true, unlocked: true, status: "unverified" } });
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  await wrapper.setProps({ state: locked() });
  input = wrapper.get('input[type="password"]');
  await input.setValue("invented unmount secret");
  wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1);
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
});

test("Lock, disable and Forget use distinct controls and never send a passphrase", async () => {
  const methods = api();
  const wrapper = mountCache({ enabled: true, unlocked: true, status: "validated" });
  expect(wrapper.text()).toContain("current account and mode");
  expect(wrapper.text()).not.toContain("game build");
  await button(wrapper, "Lock").trigger("click"); await flushPromises();
  expect(methods.lockSatanicZoneLoginCache).toHaveBeenCalledWith();
  await wrapper.setProps({ state: locked() });
  expect(wrapper.findAll("button").map(entry => entry.text())).not.toContain("Lock");
  await wrapper.get('input[type="checkbox"]').setValue(false); await flushPromises();
  expect(methods.setSatanicZoneLoginCacheEnabled).toHaveBeenCalledWith(false);
  await button(wrapper, "Forget saved sign-in").trigger("click"); await flushPromises();
  expect(methods.clearSatanicZoneLoginCache).toHaveBeenCalledWith();
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("keeps the encrypted file");
  expect(wrapper.text()).toContain("Forget deletes the portable file");
});

test("safe failure categories do not expose an IPC error or entered secret; wrong-passphrase recovery stays available", async () => {
  const methods = api();
  methods.unlockSatanicZoneLoginCache.mockRejectedValue(new Error("invented secret details"));
  const wrapper = mountCache(locked());
  await wrapper.get('input[type="password"]').setValue("invented failure secret");
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe("Could not change saved sign-in. Try again.");
  expect(wrapper.text()).not.toContain("invented secret");
  await wrapper.setProps({ state: { enabled: true, unlocked: false, status: "unlock_failed" } });
  // A normal resolved IPC failure is reported by the main-owned safe status.
  const resolved = mountCache({ enabled: true, unlocked: false, status: "unlock_failed" });
  expect(resolved.get('[role="status"]').text()).toContain("Check your passphrase");
  expect(resolved.find('input[type="password"]').exists()).toBe(true);
  expect(button(resolved, "Forget saved sign-in").attributes("disabled")).toBeUndefined();
});

test("external unlocking disables fields; SZ disabled cannot enable cache or enter a passphrase", () => {
  api();
  const pending = mountCache({ enabled: true, unlocked: false, status: "unlocking" });
  expect(pending.get('input[type="password"]').attributes("disabled")).toBeDefined();
  const disabled = mountCache(locked(), false);
  expect(disabled.get('input[type="checkbox"]').attributes("disabled")).toBeDefined();
  expect(disabled.find('input[type="password"]').exists()).toBe(false);
  expect(button(disabled, "Forget saved sign-in").attributes("disabled")).toBeUndefined();
});

test("unverified, mismatch and deletion failure explain the actual cache state", async () => {
  const wrapper = mountCache({ enabled: true, unlocked: true, status: "unverified" });
  expect(wrapper.get('[role="status"]').text()).toContain("fresh account and mode evidence");
  await wrapper.setProps({ state: { enabled: true, unlocked: true, status: "identity_mismatch" } });
  expect(wrapper.get('[role="status"]').text()).toContain("did not match");
  await wrapper.setProps({ state: { enabled: false, unlocked: false, status: "clear_failed" } });
  expect(wrapper.get('[role="status"]').text()).toContain("Could not delete");
});
