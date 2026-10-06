import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { useSatanicZoneDiagnosticRuntime } from "../../src/renderer/src/lib/satanic-zone-diagnostic-runtime";
import SatanicZoneDiagnosticCard from "../../src/renderer/src/components/SatanicZoneDiagnosticCard.vue";
import { createInitialSatanicZoneDiagnosticState } from "../../src/shared/satanic-zone-diagnostic";
import { companionState } from "./fixtures";

function fixture() {
  const arm = vi.fn().mockResolvedValue({ ...createInitialSatanicZoneDiagnosticState(), phase: "arming" });
  const start = vi.fn().mockResolvedValue({ ...createInitialSatanicZoneDiagnosticState(), phase: "requesting" });
  const cancel = vi.fn().mockResolvedValue({ ...createInitialSatanicZoneDiagnosticState(), phase: "cancelled" });
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true,
    value: { armSatanicZoneDiagnostic: arm, startSatanicZoneDiagnostic: start, cancelSatanicZoneDiagnostic: cancel } });
  const state = ref(companionState()); const showToast = vi.fn();
  return { arm, start, cancel, state, showToast, runtime: useSatanicZoneDiagnosticRuntime({ state, showToast }) };
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
  test("collection disables Start and exposes Discard", async () => {
    const diagnostic = { ...createInitialSatanicZoneDiagnosticState(), phase: "collecting" as const, startedAt: 1, deadlineAt: 120001 };
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 1001 } });
    expect(card.findAll("button")[0].attributes("disabled")).toBeDefined();
    expect(card.findAll("button")[1].attributes("disabled")).toBeDefined();
    await card.findAll("button")[2].trigger("click"); expect(card.emitted("cancel")).toHaveLength(1);
    expect(card.text()).toContain("119 seconds remaining"); card.unmount();
  });
  test("the restart cue waits for capture open and exposes sanitized selection evidence", async () => {
    const diagnostic = { ...createInitialSatanicZoneDiagnosticState(), phase: "arming" as const, startedAt: 1,
      selectionStatus: "checking-capture" as const };
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 1001 } });
    expect(card.get(".settings-ledger-title").text()).toBe("Checking capture scope");
    expect(card.findAll("button")[1].attributes("disabled")).toBeDefined();
    await card.setProps({ diagnostic: { ...diagnostic, phase: "waiting-initialization", selectionStatus: "endpoint-changed-no-syn",
      capturePackets: 3, apiFlowCount: 1 } });
    expect(card.get(".settings-ledger-title").text()).toBe("Capture ready: restart Hero Siege once");
    expect(card.text()).toMatch(/wait for .Capture ready., then restart/);
    expect(card.text()).toContain("Selection: endpoint-changed-no-syn");
    expect(card.text()).toContain("Decoded capture packets: 3. Game API flows: 1. Fresh handshake: no. Owned flow: no.");
    expect(card.findAll("button")[1].attributes("disabled")).toBeDefined(); card.unmount();
  });
  test("Ready enables a separate explicit Start, and duplicate inputs dispatch once", async () => {
    const f = fixture(); await f.runtime.startSatanicZoneDiagnostic(); expect(f.start).not.toHaveBeenCalled();
    const diagnostic = { ...createInitialSatanicZoneDiagnosticState(), phase: "ready" as const, probeStage: "ready" as const };
    f.state.value = { ...f.state.value, satanicZoneDiagnostic: diagnostic };
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 1001 } });
    expect(card.emitted("start")).toBeUndefined(); await card.findAll("button")[1].trigger("click");
    expect(card.emitted("start")).toHaveLength(1);
    await Promise.all([f.runtime.startSatanicZoneDiagnostic(), f.runtime.startSatanicZoneDiagnostic()]);
    expect(f.start).toHaveBeenCalledTimes(1); card.unmount();
  });
  test("terminal display retains only stage/outcome/counts and distinguishes own-socket success", () => {
    const diagnostic = { ...createInitialSatanicZoneDiagnosticState(), phase: "timed-out" as const, startedAt: 1000,
      probeStage: "post-login" as const, directOutcome: "timeout" as const, outboundFrames: 3, inboundFrames: 2 };
    Object.assign(diagnostic, { auth: "CANARY_PRIVATE", endpoint: "CANARY_ENDPOINT" });
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 120000 } });
    expect(card.text()).toContain("Stage: post-login"); expect(card.text()).toContain("Own-connection outcome: timeout");
    expect(card.text()).toContain("A passive game update cannot complete this probe");
    expect(card.text()).not.toMatch(/CANARY|undefined|NaN/); card.unmount();
  });
  test("acknowledgment rejection displays only structural metadata", () => {
    const diagnostic = { ...createInitialSatanicZoneDiagnosticState(), phase: "incomplete" as const, startedAt: 1,
      reason: "native-ack-format" as const, connectAcknowledgment: { bodyBytes: 5, opcode: "0x1000" as const, trailingNul: false, embeddedNul: true } };
    Object.assign(diagnostic.connectAcknowledgment, { payload: "CANARY_PRIVATE" });
    const card = mount(SatanicZoneDiagnosticCard, { props: { diagnostic, now: 1001 } });
    expect(card.text()).toContain("Connect acknowledgment: 5 body bytes; opcode 0x1000; trailing NUL no; embedded NUL yes.");
    expect(card.text()).not.toContain("CANARY_PRIVATE"); card.unmount();
  });
});
