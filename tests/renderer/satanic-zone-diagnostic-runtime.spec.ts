import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { useSatanicZoneDiagnosticRuntime } from "../../src/renderer/src/lib/satanic-zone-diagnostic-runtime";
import SatanicZoneDiagnosticCard from "../../src/renderer/src/components/SatanicZoneDiagnosticCard.vue";
import { createInitialSatanicZoneDiagnosticState } from "../../src/shared/satanic-zone-diagnostic";
import { companionState } from "./fixtures";

function fixture() {
  const arm = vi.fn().mockResolvedValue({ ...createInitialSatanicZoneDiagnosticState(), phase: "arming" });
  const cancel = vi.fn().mockResolvedValue({ ...createInitialSatanicZoneDiagnosticState(), phase: "cancelled" });
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true,
    value: { armSatanicZoneDiagnostic: arm, cancelSatanicZoneDiagnostic: cancel } });
  const state = ref(companionState()); const showToast = vi.fn();
  return { arm, cancel, state, showToast, runtime: useSatanicZoneDiagnosticRuntime({ state, showToast }) };
}
describe("explicit SZ diagnostic renderer controls", () => {
  test("construction and component mount never arm automatically", async () => {
    const f = fixture(); const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic: f.state.value.satanicZoneDiagnostic, now: 1, busy: false, cancelBusy: false } });
    expect(f.arm).not.toHaveBeenCalled(); expect(card.emitted("arm")).toBeUndefined();
    await card.get('button').trigger("click"); expect(card.emitted("arm")).toHaveLength(1); card.unmount();
  });
  test("rapid arm repeats dispatch once and preserve other state", async () => {
    const f = fixture(); const before = f.state.value.stats;
    await Promise.all([f.runtime.armSatanicZoneDiagnostic(), f.runtime.armSatanicZoneDiagnostic()]);
    expect(f.arm).toHaveBeenCalledTimes(1); expect(f.state.value.stats).toBe(before);
    await f.runtime.armSatanicZoneDiagnostic(); expect(f.arm).toHaveBeenCalledTimes(1);
  });
  test("Cancel fences a late arm result and repeated cancels", async () => {
    const f = fixture(); let resolve!: (value: unknown) => void;
    f.arm.mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    const pending = f.runtime.armSatanicZoneDiagnostic();
    await Promise.all([f.runtime.cancelSatanicZoneDiagnostic(), f.runtime.cancelSatanicZoneDiagnostic()]);
    resolve({ ...createInitialSatanicZoneDiagnosticState(), phase: "arming" }); await pending;
    expect(f.cancel).toHaveBeenCalledTimes(1); expect(f.state.value.satanicZoneDiagnostic.phase).toBe("cancelled");
    expect(f.runtime.szDiagnosticBusy.value).toBe(false);
  });
  test("a terminal broadcast before the Arm reply cannot be overwritten or disable rearming", async () => {
    const f = fixture(); let resolve!: (value: unknown) => void;
    f.arm.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const pending = f.runtime.armSatanicZoneDiagnostic();
    f.state.value = { ...f.state.value, satanicZoneDiagnostic: { ...createInitialSatanicZoneDiagnosticState(), phase: "unavailable", reason: "game-not-ready", startedAt: 1000 } };
    resolve({ ...createInitialSatanicZoneDiagnosticState(), phase: "arming", startedAt: 1000 }); await pending;
    expect(f.state.value.satanicZoneDiagnostic.phase).toBe("unavailable"); expect(f.runtime.szDiagnosticBusy.value).toBe(false);
    await f.runtime.armSatanicZoneDiagnostic(); expect(f.arm).toHaveBeenCalledTimes(2);
  });
  test("IPC failures show fixed copy and remain retryable", async () => {
    const f = fixture(); f.arm.mockRejectedValueOnce(new Error("CANARY_SECRET"));
    await f.runtime.armSatanicZoneDiagnostic(); expect(f.showToast).toHaveBeenCalledWith("SZ diagnostic could not be armed");
    f.cancel.mockRejectedValueOnce(new Error("CANARY_SECRET")); await f.runtime.cancelSatanicZoneDiagnostic();
    expect(JSON.stringify(f.showToast.mock.calls)).not.toContain("CANARY"); await f.runtime.armSatanicZoneDiagnostic(); expect(f.arm).toHaveBeenCalledTimes(2);
  });
  test("active collection disables Arm and exposes a functioning Cancel event", async () => {
    const diagnostic = { ...createInitialSatanicZoneDiagnosticState(), phase: "collecting" as const, startedAt: 1, deadlineAt: 120001 };
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 1001, busy: false, cancelBusy: false } });
    expect(card.findAll("button")[0].attributes("disabled")).toBeDefined();
    await card.findAll("button")[1].trigger("click"); expect(card.emitted("cancel")).toHaveLength(1);
    expect(card.text()).toContain("119 seconds remaining"); expect(card.text()).toContain("Unknown protocol bytes cannot be reviewed afterward"); card.unmount();
  });
});
