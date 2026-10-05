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
  test("terminal copy distinguishes captured framing, control byte shape, comparison target and local write completion", () => {
    const diagnostic = createInitialSatanicZoneDiagnosticState();
    Object.assign(diagnostic, { phase: "timed-out", startedAt: 1000, initializationComplete: true, naturalBaseline: true,
      nativeZoneInboundOrdinal: 3, directOutcome: "timeout", requestDispatched: true, bootstrapPong: true,
      nativeBootstrapControl: "same-as-pong", secondControl: "same-as-pong", secondControlMatchesNative: true, requestBodyMatchesNative: true });
    diagnostic.frames = [{ direction: "inbound", kind: "generic", bodyBytes: 2, counter: null, control: "same-as-pong",
      inboundOrdinal: 1, controlOrdinal: 1, zoneObserved: false },
    { direction: "inbound", kind: "generic", bodyBytes: 2, counter: null, control: "other-control",
      inboundOrdinal: 2, controlOrdinal: 2, zoneObserved: false }];
    diagnostic.directEvents = [{ kind: "bootstrap-pong", direction: "inbound", bytes: 10, control: "same-as-pong", controlOrdinal: 1 },
      { kind: "second-control", direction: "inbound", bytes: 10, control: "same-as-pong", controlOrdinal: 2 }];
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 120000 } });
    const text = card.text();
    expect(text).toContain("Captured fresh game flow: framed and attributed");
    expect(text).toContain("observed in inbound frame #3"); expect(text).toContain("SZ socket write completed: yes");
    expect(text).toContain("Direct control #2 body vs first native inbound frame body: equal");
    expect(text).toContain("native control #2"); expect(text).toContain("direct control #1");
    expect(text).toContain("First control body validated (01 00)");
    expect(text).not.toMatch(/Pong validated|Initialization: complete|Second control matches native/); card.unmount();
  });
  test("unknown operation/auth additions and missing comparisons never become displayed protocol names or acknowledgments", () => {
    const diagnostic = createInitialSatanicZoneDiagnosticState(); diagnostic.startedAt = 1000;
    diagnostic.frames = [{ direction: "outbound", kind: "other-api", bodyBytes: 126, counter: 0, control: "not-control",
      inboundOrdinal: null, controlOrdinal: null, zoneObserved: false }];
    Object.assign(diagnostic.frames[0], { operationName: "CANARY_AUTH_OPERATION", auth: "CANARY_PRIVATE" });
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 1001 } });
    expect(card.text()).toContain("API frame: 126 body bytes, counter 0");
    expect(card.text()).toContain("first native inbound frame body: not compared");
    expect(card.text()).not.toMatch(/CANARY|undefined|NaN|pong body/); card.unmount();
  });
});
