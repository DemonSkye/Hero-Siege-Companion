import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import SatanicZoneLoginCacheSettings from "../../src/renderer/src/components/SatanicZoneLoginCacheSettings.vue";
import type { SatanicZoneLoginCacheState } from "../../src/shared/satanic-zone-login-cache";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); });
function api() {
  const methods = {
    setSatanicZoneLoginCacheEnabled: vi.fn(async (_enabled: boolean) => ({})),
    enableSatanicZoneLoginCacheAutomatic: vi.fn(async (_passphrase: string) => ({})),
    unlockSatanicZoneLoginCache: vi.fn(async (_passphrase: string) => ({})),
    lockSatanicZoneLoginCache: vi.fn(async () => ({})),
    clearSatanicZoneLoginCache: vi.fn(async () => ({})),
  };
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: methods });
  return methods;
}
function mountCache(state: SatanicZoneLoginCacheState = { enabled: false, unlocked: false, status: "disabled" }, refreshEnabled = true) {
  const wrapper = mount(SatanicZoneLoginCacheSettings, { props: { refreshEnabled, state } });
  wrappers.push(wrapper); return wrapper;
}
function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll("button").find(candidate => candidate.text() === label);
  if (!match) throw new Error("Missing button: " + label);
  return match;
}
const locked = (): SatanicZoneLoginCacheState => ({ enabled: true, unlocked: false, status: "locked" });
const consent = (wrapper: VueWrapper) => wrapper.get("#settings-sz-cache-consent");
const password = (wrapper: VueWrapper) => wrapper.get('input[type="password"]');
const checked = (wrapper: VueWrapper) => (consent(wrapper).element as HTMLInputElement).checked;
const passValue = (wrapper: VueWrapper) => (password(wrapper).element as HTMLInputElement).value;

test("automatic setup starts off and requires explicit unchecked consent after displaying the local-key risk", async () => {
  const methods = api(), wrapper = mountCache();
  expect(wrapper.text()).toContain("experimental");
  expect(wrapper.text()).toContain("local unlocking key alongside the encrypted sign-in");
  expect(wrapper.text()).toContain("Anyone who can read both files can use the saved sign-in");
  expect(wrapper.text()).toContain("Refresh still sends only when you click it");
  expect(wrapper.text()).toContain("Reuse may not be accepted across game sessions");
  expect(wrapper.text()).toContain("Older Windows-encrypted files are left untouched");
  expect((wrapper.get('.settings-switch input').element as HTMLInputElement).checked).toBe(false);
  expect(checked(wrapper)).toBe(false);
  await password(wrapper).setValue("12345678");
  expect(button(wrapper, "Enable automatic save/load").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  await wrapper.get('.settings-switch input').setValue(true); await flushPromises();
  expect(methods.setSatanicZoneLoginCacheEnabled).toHaveBeenCalledWith(true);
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
});

test("eight-character automatic setup sends once only after consent and clears the entry before IPC settles", async () => {
  const methods = api(); let resolve!: (value: object) => void;
  methods.enableSatanicZoneLoginCacheAutomatic.mockImplementation(() => new Promise(done => { resolve = done; }));
  const wrapper = mountCache();
  await consent(wrapper).setValue(true);
  await password(wrapper).setValue("1234567");
  await wrapper.get("form").trigger("submit");
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
  await password(wrapper).setValue("12345678");
  expect(button(wrapper, "Enable automatic save/load").attributes("disabled")).toBeUndefined();
  await wrapper.get("form").trigger("submit");
  expect(methods.enableSatanicZoneLoginCacheAutomatic).toHaveBeenCalledWith("12345678");
  expect(passValue(wrapper)).toBe(""); expect(checked(wrapper)).toBe(false);
  expect(password(wrapper).attributes("disabled")).toBeDefined();
  expect(consent(wrapper).attributes("disabled")).toBeDefined();
  expect(wrapper.get('.settings-switch input').attributes("disabled")).toBeDefined();
  expect(button(wrapper, "Forget saved sign-in").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(methods.enableSatanicZoneLoginCacheAutomatic).toHaveBeenCalledTimes(1);
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  resolve({}); await flushPromises();
  await wrapper.setProps({ state: { enabled: true, unlocked: true, automatic: true, status: "unverified" } });
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  expect(wrapper.find("#settings-sz-cache-consent").exists()).toBe(false);
  expect(wrapper.text()).toContain("future launches do not require the passphrase");
  expect(wrapper.get('[role="status"]').text()).toContain("loaded automatically");
});

test("existing manually enabled settings do not become automatic consent; manual unlock remains separate", async () => {
  const methods = api(), wrapper = mountCache(locked());
  expect(checked(wrapper)).toBe(false);
  expect(wrapper.text()).toContain("enter its old passphrase once");
  expect(wrapper.text()).toContain("keeps its encrypted contents unchanged");
  expect(wrapper.get('[role="status"]').text()).toContain("Automatic save/load is off");
  const originalPassphrase = "old portable passphrase";
  await password(wrapper).setValue(originalPassphrase);
  await button(wrapper, "Unlock for this session").trigger("click"); await flushPromises();
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledWith(originalPassphrase);
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
  expect(passValue(wrapper)).toBe(""); expect(checked(wrapper)).toBe(false);
  await wrapper.setProps({ state: { enabled: true, unlocked: true, status: "unverified" } });
  expect(wrapper.get('[role="status"]').text()).toContain("unlocked for this session");
  expect(button(wrapper, "Enable automatic save/load").attributes("disabled")).toBeDefined();
  await password(wrapper).setValue(originalPassphrase); await consent(wrapper).setValue(true);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(methods.enableSatanicZoneLoginCacheAutomatic).toHaveBeenCalledWith(originalPassphrase);
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledTimes(1);
});

test("automatic and manual actions use eight Unicode code points and the UTF-8 byte bound", async () => {
  const methods = api(), wrapper = mountCache(locked());
  await consent(wrapper).setValue(true);
  // Six emoji have 12 UTF-16 units, but only six Unicode code points.
  await password(wrapper).setValue("😀".repeat(6));
  expect(button(wrapper, "Enable automatic save/load").attributes("disabled")).toBeDefined();
  expect(button(wrapper, "Unlock for this session").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit"); await button(wrapper, "Unlock for this session").trigger("click");
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  const eightCharacters = "猫".repeat(8);
  await password(wrapper).setValue(eightCharacters);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(methods.enableSatanicZoneLoginCacheAutomatic).toHaveBeenCalledWith(eightCharacters);
  // Each character occupies three bytes: 342 characters exceed 1,024 UTF-8 bytes.
  await password(wrapper).setValue("猫".repeat(342)); await consent(wrapper).setValue(true);
  expect(button(wrapper, "Enable automatic save/load").attributes("disabled")).toBeDefined();
  expect(button(wrapper, "Unlock for this session").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit"); await button(wrapper, "Unlock for this session").trigger("click");
  expect(methods.enableSatanicZoneLoginCacheAutomatic).toHaveBeenCalledTimes(1);
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  const exactByteLimit = "😀".repeat(256);
  await password(wrapper).setValue(exactByteLimit);
  await button(wrapper, "Unlock for this session").trigger("click"); await flushPromises();
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledWith(exactByteLimit);
  expect(password(wrapper).attributes("minlength")).toBe("8");
  expect(password(wrapper).attributes("autocomplete")).toBe("off");
});

test("cancel, disable, automatic transition and unmount clear transient passphrase and consent", async () => {
  const methods = api(), wrapper = mountCache(locked());
  let input = password(wrapper);
  await input.setValue("invented cancel secret"); await consent(wrapper).setValue(true);
  await button(wrapper, "Cancel").trigger("click");
  expect(passValue(wrapper)).toBe(""); expect(checked(wrapper)).toBe(false);
  await input.setValue("invented retained secret"); await consent(wrapper).setValue(true);
  await wrapper.setProps({ state: { ...locked(), automatic: false } });
  expect(passValue(wrapper)).toBe("invented retained secret"); expect(checked(wrapper)).toBe(true);
  await wrapper.setProps({ refreshEnabled: false });
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  await wrapper.setProps({ refreshEnabled: true }); input = password(wrapper);
  expect(checked(wrapper)).toBe(false);
  await input.setValue("invented automatic secret"); await consent(wrapper).setValue(true);
  await wrapper.setProps({ state: { enabled: true, unlocked: true, automatic: true, status: "unverified" } });
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  await wrapper.setProps({ state: locked() }); input = password(wrapper);
  await input.setValue("invented unmount secret"); await consent(wrapper).setValue(true);
  wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1);
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
});

test("automatic current-session Lock exposes manual recovery while next-launch reopening remains enabled", async () => {
  const methods = api(), wrapper = mountCache({ enabled: true, unlocked: true, automatic: true, status: "saved" });
  expect(wrapper.text()).toContain("automatically on future launches");
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  await button(wrapper, "Lock").trigger("click"); await flushPromises();
  expect(methods.lockSatanicZoneLoginCache).toHaveBeenCalledWith();
  await wrapper.setProps({ state: { ...locked(), automatic: true } });
  expect(wrapper.get('[role="status"]').text()).toContain("Automatic save/load remains on for the next Companion launch");
  expect(wrapper.find("#settings-sz-cache-consent").exists()).toBe(false);
  await password(wrapper).setValue("old portable passphrase");
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(methods.unlockSatanicZoneLoginCache).toHaveBeenCalledWith("old portable passphrase");
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
});

test("disable and Forget describe different retained-file outcomes and use narrow control IPC", async () => {
  const methods = api(), wrapper = mountCache({ enabled: true, unlocked: true, automatic: true, status: "validated" });
  expect(wrapper.get('[role="status"]').text()).toContain("current account and mode");
  expect(wrapper.text()).toContain("removes the local unlocking key and keeps the encrypted sign-in file");
  expect(wrapper.text()).toContain("Forget deletes both files");
  await wrapper.get('.settings-switch input').setValue(false); await flushPromises();
  expect(methods.setSatanicZoneLoginCacheEnabled).toHaveBeenCalledWith(false);
  await button(wrapper, "Forget saved sign-in").trigger("click"); await flushPromises();
  expect(methods.clearSatanicZoneLoginCache).toHaveBeenCalledWith();
  expect(methods.enableSatanicZoneLoginCacheAutomatic).not.toHaveBeenCalled();
  expect(methods.unlockSatanicZoneLoginCache).not.toHaveBeenCalled();
});

test("safe failure statuses keep manual migration recoverable without exposing errors or silently consenting", async () => {
  const methods = api(), wrapper = mountCache(locked());
  methods.enableSatanicZoneLoginCacheAutomatic.mockRejectedValue(new Error("invented private key detail"));
  await password(wrapper).setValue("invented failed passphrase"); await consent(wrapper).setValue(true);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe("Could not change saved sign-in. Try again.");
  expect(wrapper.text()).not.toContain("invented private key detail");
  expect(passValue(wrapper)).toBe(""); expect(checked(wrapper)).toBe(false);
  expect(button(wrapper, "Unlock for this session").exists()).toBe(true);
  const recovery = mountCache({ ...locked(), status: "unlock_failed" });
  expect(recovery.get('[role="status"]').text()).toContain("Check your passphrase");
  expect(checked(recovery)).toBe(false);
  expect(button(recovery, "Forget saved sign-in").attributes("disabled")).toBeUndefined();
});

test("external unlock disables setup fields and SZ disabled cannot consent or send a passphrase", () => {
  api();
  const pending = mountCache({ ...locked(), status: "unlocking" });
  expect(password(pending).attributes("disabled")).toBeDefined();
  expect(consent(pending).attributes("disabled")).toBeDefined();
  const disabled = mountCache(locked(), false);
  expect(disabled.get('.settings-switch input').attributes("disabled")).toBeDefined();
  expect(disabled.find('input[type="password"]').exists()).toBe(false);
  expect(disabled.find("#settings-sz-cache-consent").exists()).toBe(false);
  expect(button(disabled, "Forget saved sign-in").attributes("disabled")).toBeUndefined();
});

test("automatic pending evidence, mismatch and deletion failure explain the real cache state", async () => {
  const wrapper = mountCache({ enabled: true, unlocked: true, automatic: true, status: "unverified" });
  expect(wrapper.get('[role="status"]').text()).toContain("fresh account and mode evidence");
  expect(wrapper.get('[role="status"]').text()).toContain("no request has been sent");
  await wrapper.setProps({ state: { enabled: true, unlocked: true, automatic: true, status: "identity_mismatch" } });
  expect(wrapper.get('[role="status"]').text()).toContain("did not match");
  await wrapper.setProps({ state: { enabled: false, unlocked: false, automatic: false, status: "clear_failed" } });
  expect(wrapper.get('[role="status"]').text()).toContain("Could not remove all saved sign-in files");
});
