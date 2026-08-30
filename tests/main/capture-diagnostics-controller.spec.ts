import { describe, expect, test, vi } from "vitest";
import {
  CaptureDiagnosticsController,
  TIMED_CAPTURE_DIAGNOSTICS_MS,
} from "../../src/main/capture-diagnostics-controller";

describe("capture diagnostics controller", () => {
  test("keeps automatic logging on while mapping enhanced and deep modes to bounded detail", () => {
    const onChange = vi.fn();
    const controller = new CaptureDiagnosticsController({ onChange });

    expect(controller.capturePreferences()).toEqual({
      captureDebugLogging: true,
      capturePayloadLogging: false,
      captureWideLogging: false,
      satanicZoneDebugLogging: true,
    });

    controller.setMode("enhanced", "manual");
    expect(controller.capturePreferences()).toMatchObject({
      captureDebugLogging: true,
      capturePayloadLogging: true,
      captureWideLogging: false,
      satanicZoneDebugLogging: true,
    });

    controller.setMode("deep", "manual");
    expect(controller.capturePreferences()).toMatchObject({
      capturePayloadLogging: true,
      captureWideLogging: true,
    });

    controller.setMode("enhanced", "off");
    expect(controller.capturePreferences()).toMatchObject({
      capturePayloadLogging: true,
      captureWideLogging: true,
    });

    controller.setMode("deep", "off");
    expect(controller.capturePreferences()).toMatchObject({
      capturePayloadLogging: false,
      captureWideLogging: false,
    });
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  test("expires a timed mode after exactly ten minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:00:00Z"));
    const onChange = vi.fn();
    const controller = new CaptureDiagnosticsController({ onChange });

    const state = controller.setMode("enhanced", "timed");
    expect(state.enhanced).toEqual({
      mode: "timed",
      timedUntil: Date.now() + TIMED_CAPTURE_DIAGNOSTICS_MS,
    });

    vi.advanceTimersByTime(TIMED_CAPTURE_DIAGNOSTICS_MS - 1);
    expect(controller.snapshot().enhanced.mode).toBe("timed");

    vi.advanceTimersByTime(1);
    expect(controller.snapshot().enhanced).toEqual({ mode: "off", timedUntil: null });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ enhanced: { mode: "off", timedUntil: null } }),
      expect.objectContaining({ capturePayloadLogging: false }),
    );
    vi.useRealTimers();
  });

  test("switching between timed and manual modes cancels the stale expiry", () => {
    vi.useFakeTimers();
    const controller = new CaptureDiagnosticsController({ onChange: vi.fn() });

    controller.setMode("deep", "timed");
    controller.setMode("deep", "manual");
    vi.advanceTimersByTime(TIMED_CAPTURE_DIAGNOSTICS_MS);

    expect(controller.snapshot().deep).toEqual({ mode: "manual", timedUntil: null });
    controller.dispose();
    vi.useRealTimers();
  });

  test("a queued stale timeout cannot stop a restarted timed session", () => {
    let now = 1_000;
    const callbacks: Array<() => void> = [];
    const timers: NodeJS.Timeout[] = [];
    const clearTimer = vi.fn();
    const controller = new CaptureDiagnosticsController({
      onChange: vi.fn(),
      now: () => now,
      setTimer: (callback) => {
        callbacks.push(callback);
        const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
        timers.push(timer);
        return timer;
      },
      clearTimer,
    });

    const first = controller.setMode("enhanced", "timed").enhanced.timedUntil;
    now += 5_000;
    const second = controller.setMode("enhanced", "timed").enhanced.timedUntil;
    expect(second).not.toBe(first);

    callbacks[0]();

    expect(controller.snapshot().enhanced).toEqual({ mode: "timed", timedUntil: second });
    controller.dispose();
    expect(clearTimer).toHaveBeenLastCalledWith(timers[1]);
  });

  test("publishes expired sibling modes consistently with effective preferences", () => {
    let now = 1_000;
    const onChange = vi.fn();
    const controller = new CaptureDiagnosticsController({
      onChange,
      now: () => now,
      setTimer: () => ({ unref: vi.fn() }) as unknown as NodeJS.Timeout,
      clearTimer: vi.fn(),
    });
    controller.setMode("enhanced", "timed");
    now += TIMED_CAPTURE_DIAGNOSTICS_MS;

    controller.setMode("deep", "manual");

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enhanced: { mode: "off", timedUntil: null },
        deep: { mode: "manual", timedUntil: null },
      }),
      expect.objectContaining({ capturePayloadLogging: true, captureWideLogging: true }),
    );
  });
});
