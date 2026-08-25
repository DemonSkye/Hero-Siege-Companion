import { afterEach, describe, expect, test, vi } from "vitest";
import { SatanicZoneController } from "../../src/main/satanic-zone-controller";
import type {
  SatanicZoneObservationWaitOptions,
  SatanicZonePassiveObservationListener,
  SatanicZoneProviderWaitOutcome,
  SatanicZoneRefreshAvailability,
  SatanicZoneRefreshDispatchResult,
  SatanicZoneRefreshProvider,
  SatanicZoneRefreshRequestOptions,
} from "../../src/main/satanic-zone-refresh-provider";
import type { SatanicZoneInfo } from "../../src/shared/parser";
import { createInitialSatanicZoneState } from "../../src/shared/satanic-zone";

const WINDOW_TIME = new Date(2026, 7, 24, 10, 5, 0, 0).getTime();

afterEach(() => {
  vi.useRealTimers();
});

describe("SatanicZoneController", () => {
  test("keeps manual refresh main-authoritatively off until explicitly enabled", async () => {
    const refreshProvider = provider({ availability: { available: false, experimental: true, errorCode: "helper_not_ready" } });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      onStateChange: vi.fn(),
    });

    await expect(controller.refreshAvailability()).resolves.toEqual({
      available: false,
      experimental: false,
      errorCode: "refresh_disabled",
    });
    await expect(controller.refreshNow()).resolves.toEqual({ accepted: false, errorCode: "refresh_disabled" });
    expect(refreshProvider.getAvailability).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      refreshEnabled: false,
      refreshAvailable: false,
      refreshExperimental: false,
      errorCode: "refresh_disabled",
    });

    await expect(controller.setRefreshEnabled(true)).resolves.toMatchObject({
      available: false,
      errorCode: "helper_not_ready",
    });
    expect(controller.getState()).toMatchObject({
      refreshEnabled: true,
      refreshAvailable: false,
      refreshExperimental: true,
      errorCode: "helper_not_ready",
    });
    expect(refreshProvider.getAvailability).toHaveBeenCalledTimes(1);
  });

  test("tracks passive request, response, and timeout states without discarding the last good zone", () => {
    const states = vi.fn();
    const controller = new SatanicZoneController({ onStateChange: states });
    const observed = zone(WINDOW_TIME);

    controller.observePassiveRequest(WINDOW_TIME);
    expect(controller.getState()).toMatchObject({
      phase: "updating",
      lastAttemptAt: WINDOW_TIME,
      current: null,
    });

    controller.observePassiveResponse(observed, WINDOW_TIME + 100);
    expect(controller.getState()).toMatchObject({
      phase: "current",
      current: observed,
      source: "captured",
      lastSuccessAt: WINDOW_TIME + 100,
      errorCode: "refresh_disabled",
    });

    controller.observePassiveRequest(WINDOW_TIME + 200);
    controller.observePassiveTimeout(WINDOW_TIME + 500);
    expect(controller.getState()).toMatchObject({
      phase: "missed",
      current: observed,
      source: "captured",
      lastAttemptAt: WINDOW_TIME + 200,
      lastSuccessAt: WINDOW_TIME + 100,
      errorCode: "response_timeout",
    });
    expect(() => JSON.stringify(controller.getState())).not.toThrow();
    expect(states).toHaveBeenCalledTimes(4);
  });

  test("merges relay-owned passive observations through the captured response path and unsubscribes on dispose", () => {
    let passiveListener: SatanicZonePassiveObservationListener | null = null;
    const unsubscribe = vi.fn();
    const refreshProvider = provider({
      subscribeToPassiveObservations: (listener) => {
        passiveListener = listener;
        return unsubscribe;
      },
    });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME + 100,
    });
    const observed = zone(WINDOW_TIME);

    if (!passiveListener) throw new Error("expected passive observation subscription");
    passiveListener({ zone: observed, observedAt: WINDOW_TIME });

    expect(controller.getState()).toMatchObject({
      phase: "current",
      current: observed,
      source: "captured",
      lastSuccessAt: WINDOW_TIME,
      errorCode: null,
    });

    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("clears prior observation evidence for a new run while preserving refresh controls and cooldown", () => {
    const controller = new SatanicZoneController({
      initialState: {
        ...enabledState(),
        refreshAvailable: true,
        refreshExperimental: true,
        nextAllowedRefreshAt: WINDOW_TIME + 30_000,
      },
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });
    controller.observePassiveResponse(zone(WINDOW_TIME - 1000), WINDOW_TIME - 500);

    controller.resetObservation();

    expect(controller.getState()).toEqual({
      ...createInitialSatanicZoneState(),
      nextAllowedRefreshAt: WINDOW_TIME + 30_000,
      refreshEnabled: true,
      refreshAvailable: true,
      refreshExperimental: true,
    });
  });

  test("keeps an accepted refresh in progress when a new run clears the previous observation", async () => {
    const controller = new SatanicZoneController({
      provider: provider(),
      initialState: {
        ...enabledState(),
        refreshAvailable: true,
        current: zone(WINDOW_TIME - 60_000),
        phase: "current",
        source: "captured",
        lastSuccessAt: WINDOW_TIME - 60_000,
        validUntil: WINDOW_TIME + 25 * 60_000,
      },
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });

    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
    controller.resetObservation();

    expect(controller.getState()).toMatchObject({
      current: null,
      phase: "refreshing",
      source: null,
      lastAttemptAt: WINDOW_TIME,
      lastSuccessAt: null,
      validUntil: null,
      nextAllowedRefreshAt: WINDOW_TIME + 30_000,
      refreshEnabled: true,
      refreshAvailable: true,
    });

    const refreshed = zone(WINDOW_TIME + 100);
    controller.observePassiveResponse(refreshed, WINDOW_TIME + 200);
    expect(controller.getState()).toMatchObject({
      current: refreshed,
      phase: "current",
      source: "manual",
    });
  });

  test("allows one manual refresh and completes it only when the passive response arrives", async () => {
    const refreshProvider = provider();
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
      responseTimeoutMs: 1000,
    });

    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
    expect(controller.getState()).toMatchObject({
      phase: "refreshing",
      lastAttemptAt: WINDOW_TIME,
      refreshAvailable: true,
      refreshExperimental: true,
      errorCode: null,
    });
    await expect(controller.refreshNow()).resolves.toEqual({
      accepted: false,
      errorCode: "refresh_in_progress",
    });

    const observed = zone(WINDOW_TIME + 100);
    controller.observePassiveResponse(observed, WINDOW_TIME + 200);
    expect(controller.getState()).toMatchObject({
      phase: "current",
      current: observed,
      source: "manual",
      lastSuccessAt: WINDOW_TIME + 200,
      refreshAvailable: true,
      refreshExperimental: true,
      errorCode: null,
    });
    expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(1);
  });

  test("fails a manual refresh after the bounded passive-response timeout and never retries it", async () => {
    vi.useFakeTimers();
    let now = WINDOW_TIME;
    const refreshProvider = provider();
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => now,
      refreshCooldownMs: 5000,
      responseTimeoutMs: 250,
    });
    const previous = zone(WINDOW_TIME - 60_000);
    controller.observePassiveResponse(previous, WINDOW_TIME);

    await controller.refreshNow();
    now += 250;
    await vi.advanceTimersByTimeAsync(250);

    expect(controller.getState()).toMatchObject({
      phase: "failed",
      current: previous,
      errorCode: "response_timeout",
      nextAllowedRefreshAt: WINDOW_TIME + 5000,
    });
    await expect(controller.refreshNow()).resolves.toEqual({
      accepted: false,
      errorCode: "refresh_cooldown",
    });
    expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(1);
  });

  test("keeps the default cooldown closed until exactly 30 seconds after acceptance", async () => {
    let now = WINDOW_TIME;
    const refreshProvider = provider();
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => now,
    });

    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
    controller.observePassiveResponse(zone(now + 1), now + 1);

    now = WINDOW_TIME + 29_999;
    await expect(controller.refreshNow()).resolves.toEqual({ accepted: false, errorCode: "refresh_cooldown" });
    now = WINDOW_TIME + 30_000;
    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
    expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(2);
  });

  test("anchors the cooldown after delayed acceptance without extending it at settlement", async () => {
    let now = WINDOW_TIME;
    let resolveAvailability!: (availability: SatanicZoneRefreshAvailability) => void;
    const availability = new Promise<SatanicZoneRefreshAvailability>((resolve) => {
      resolveAvailability = resolve;
    });
    const refreshProvider = provider({ availability });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => now,
    });

    const refresh = controller.refreshNow();
    await vi.waitFor(() => expect(refreshProvider.getAvailability).toHaveBeenCalledTimes(1));
    now = WINDOW_TIME + 12_345;
    resolveAvailability({ available: true, experimental: true, errorCode: null });

    await expect(refresh).resolves.toEqual({ accepted: true, errorCode: null });
    expect(controller.getState().nextAllowedRefreshAt).toBe(WINDOW_TIME + 42_345);
    controller.observePassiveResponse(zone(now + 1), now + 1);

    now = WINDOW_TIME + 42_344;
    await expect(controller.refreshNow()).resolves.toEqual({ accepted: false, errorCode: "refresh_cooldown" });
    now = WINDOW_TIME + 42_345;
    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
    expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(2);
  });

  test("does not start cooldown for unavailable preflight or an uncommitted dispatch", async () => {
    const unavailableProvider = provider({
      availability: { available: false, experimental: false, errorCode: "helper_not_ready" },
    });
    const unavailableController = new SatanicZoneController({
      provider: unavailableProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });
    await expect(unavailableController.refreshNow()).resolves.toEqual({
      accepted: false,
      errorCode: "helper_not_ready",
    });
    expect(unavailableController.getState().nextAllowedRefreshAt).toBeNull();

    const rejectedProvider = provider({
      dispatch: Promise.resolve({ accepted: false, errorCode: "helper_rejected", correlationId: null }),
    });
    const rejectedController = new SatanicZoneController({
      provider: rejectedProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME + 5000,
    });
    await expect(rejectedController.refreshNow()).resolves.toEqual({
      accepted: false,
      errorCode: "helper_rejected",
    });
    expect(rejectedController.getState().nextAllowedRefreshAt).toBeNull();
  });

  test("honors a persisted cooldown across controller reconstruction", async () => {
    let now = WINDOW_TIME;
    const refreshProvider = provider();
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: {
        ...enabledState(),
        nextAllowedRefreshAt: WINDOW_TIME + 30_000,
      },
      onStateChange: vi.fn(),
      now: () => now,
    });

    await expect(controller.refreshNow()).resolves.toEqual({
      accepted: false,
      errorCode: "refresh_cooldown",
    });
    expect(refreshProvider.getAvailability).not.toHaveBeenCalled();

    now = WINDOW_TIME + 30_000;
    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
  });

  test("isolates overlapping passive timeouts from a correlated manual refresh", async () => {
    let now = WINDOW_TIME;
    let resolveAvailability!: (value: SatanicZoneRefreshAvailability) => void;
    let resolveDispatch!: (value: SatanicZoneRefreshDispatchResult) => void;
    let resolveObservation!: (value: SatanicZoneProviderWaitOutcome | null) => void;
    const availability = new Promise<SatanicZoneRefreshAvailability>((resolve) => {
      resolveAvailability = resolve;
    });
    const dispatch = new Promise<SatanicZoneRefreshDispatchResult>((resolve) => {
      resolveDispatch = resolve;
    });
    const observation = new Promise<SatanicZoneProviderWaitOutcome | null>((resolve) => {
      resolveObservation = resolve;
    });
    const waitForObservation = vi.fn(async () => observation);
    const refreshProvider = provider({ availability, dispatch, waitForObservation });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => now,
    });

    const refresh = controller.refreshNow();
    await vi.waitFor(() => expect(refreshProvider.getAvailability).toHaveBeenCalledTimes(1));
    controller.observePassiveTimeout(WINDOW_TIME + 100, WINDOW_TIME - 9900);
    expect(controller.getState().phase).toBe("refreshing");

    now = WINDOW_TIME + 200;
    resolveAvailability({ available: true, experimental: false, errorCode: null });
    await vi.waitFor(() => expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(1));
    controller.observePassiveTimeout(WINDOW_TIME + 300, WINDOW_TIME - 9700);
    expect(controller.getState().phase).toBe("refreshing");

    now = WINDOW_TIME + 400;
    resolveDispatch({
      accepted: true,
      errorCode: null,
      correlationId: "0123456789abcdef0123456789abcdef",
    });
    await expect(refresh).resolves.toEqual({ accepted: true, errorCode: null });
    await vi.waitFor(() => expect(waitForObservation).toHaveBeenCalledTimes(1));
    controller.observePassiveTimeout(WINDOW_TIME + 500, WINDOW_TIME - 9500);
    expect(controller.getState().phase).toBe("refreshing");

    const successfulAt = WINDOW_TIME + 1000;
    now = successfulAt;
    resolveObservation({
      kind: "observation",
      observation: { zone: zone(successfulAt), observedAt: successfulAt },
      availabilityConsumed: false,
    });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("current"));
    expect(controller.getState().nextAllowedRefreshAt).toBe(WINDOW_TIME + 30_400);

    controller.observePassiveTimeout(successfulAt + 500, WINDOW_TIME - 9500);
    expect(controller.getState()).toMatchObject({ phase: "current", errorCode: null });

    const laterRequestAt = successfulAt + 1000;
    controller.observePassiveRequest(laterRequestAt);
    controller.observePassiveTimeout(laterRequestAt + 10_000, laterRequestAt);
    expect(controller.getState()).toMatchObject({ phase: "missed", errorCode: "response_timeout" });
  });

  test("does not extend cooldown from a correlated terminal settlement", async () => {
    let now = WINDOW_TIME;
    let resolveObservation!: (value: SatanicZoneProviderWaitOutcome | null) => void;
    const observation = new Promise<SatanicZoneProviderWaitOutcome | null>((resolve) => {
      resolveObservation = resolve;
    });
    const controller = new SatanicZoneController({
      provider: provider({ waitForObservation: vi.fn(async () => observation) }),
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => now,
    });

    await controller.refreshNow();
    expect(controller.getState().nextAllowedRefreshAt).toBe(WINDOW_TIME + 30_000);
    now = WINDOW_TIME + 5000;
    resolveObservation({
      kind: "terminal",
      errorCode: "helper_failed",
      availabilityConsumed: false,
    });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("failed"));

    expect(controller.getState().nextAllowedRefreshAt).toBe(WINDOW_TIME + 30_000);
  });

  test("keeps a correlated terminal result authoritative when its injected request surfaces just afterward", async () => {
    let now = WINDOW_TIME;
    let resolveObservation!: (value: SatanicZoneProviderWaitOutcome | null) => void;
    const observation = new Promise<SatanicZoneProviderWaitOutcome | null>((resolve) => {
      resolveObservation = resolve;
    });
    const controller = new SatanicZoneController({
      provider: provider({ waitForObservation: vi.fn(async () => observation) }),
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => now,
    });

    await controller.refreshNow();
    now += 10_000;
    resolveObservation({
      kind: "terminal",
      errorCode: "response_timeout",
      availabilityConsumed: false,
    });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("failed"));

    const lateInjectedRequestAt = now + 467;
    controller.observePassiveRequest(lateInjectedRequestAt);
    controller.observePassiveTimeout(lateInjectedRequestAt + 15_000, lateInjectedRequestAt);
    expect(controller.getState()).toMatchObject({
      phase: "failed",
      errorCode: "response_timeout",
      lastAttemptAt: WINDOW_TIME,
    });

    const independentRequestAt = now + 2_001;
    controller.observePassiveRequest(independentRequestAt);
    controller.observePassiveTimeout(independentRequestAt + 15_000, independentRequestAt);
    expect(controller.getState()).toMatchObject({
      phase: "missed",
      errorCode: "response_timeout",
      lastAttemptAt: independentRequestAt,
    });
  });

  test.each(["disable", "dispose", "reset", "markUnavailable"] as const)(
    "preserves the accepted cooldown deadline when %s occurs later",
    async (action) => {
      vi.useFakeTimers();
      let now = WINDOW_TIME;
      const controller = new SatanicZoneController({
        provider: provider(),
        initialState: enabledState(),
        onStateChange: vi.fn(),
        now: () => now,
      });

      await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
      expect(controller.getState().nextAllowedRefreshAt).toBe(WINDOW_TIME + 30_000);

      now = WINDOW_TIME + 5000;
      if (action === "disable") await controller.setRefreshEnabled(false);
      else if (action === "dispose") controller.dispose();
      else if (action === "reset") controller.resetObservation();
      else controller.markUnavailable("capture_unavailable");

      expect(controller.getState().nextAllowedRefreshAt).toBe(WINDOW_TIME + 30_000);
      controller.dispose();
    },
  );

  test("does not let an older enable availability result overwrite a newer toggle cycle", async () => {
    let resolveFirst!: (availability: SatanicZoneRefreshAvailability) => void;
    let resolveSecond!: (availability: SatanicZoneRefreshAvailability) => void;
    const firstAvailability = new Promise<SatanicZoneRefreshAvailability>((resolve) => {
      resolveFirst = resolve;
    });
    const secondAvailability = new Promise<SatanicZoneRefreshAvailability>((resolve) => {
      resolveSecond = resolve;
    });
    const refreshProvider = provider();
    refreshProvider.getAvailability
      .mockImplementationOnce(async () => firstAvailability)
      .mockImplementationOnce(async () => secondAvailability);
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      onStateChange: vi.fn(),
    });

    const firstEnable = controller.setRefreshEnabled(true);
    await vi.waitFor(() => expect(refreshProvider.getAvailability).toHaveBeenCalledTimes(1));
    await controller.setRefreshEnabled(false);
    expect(controller.getState()).toMatchObject({
      refreshEnabled: false,
      refreshAvailable: false,
      errorCode: "refresh_disabled",
    });

    const secondEnable = controller.setRefreshEnabled(true);
    await vi.waitFor(() => expect(refreshProvider.getAvailability).toHaveBeenCalledTimes(2));
    resolveSecond({ available: true, experimental: true, errorCode: null });
    await expect(secondEnable).resolves.toEqual({ available: true, experimental: true, errorCode: null });
    expect(controller.getState()).toMatchObject({
      refreshEnabled: true,
      refreshAvailable: true,
      refreshExperimental: true,
      errorCode: null,
    });

    resolveFirst({ available: false, experimental: true, errorCode: "one_shot_consumed" });
    await expect(firstEnable).resolves.toEqual({
      available: false,
      experimental: true,
      errorCode: "one_shot_consumed",
    });
    expect(controller.getState()).toMatchObject({
      refreshEnabled: true,
      refreshAvailable: true,
      refreshExperimental: true,
      errorCode: null,
    });
  });

  test("does not dispatch when the persisted gate is disabled during preflight", async () => {
    let resolveAvailability!: (availability: SatanicZoneRefreshAvailability) => void;
    const availability = new Promise<SatanicZoneRefreshAvailability>((resolve) => {
      resolveAvailability = resolve;
    });
    const refreshProvider = provider({ availability });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });

    const refresh = controller.refreshNow();
    await vi.waitFor(() => expect(refreshProvider.getAvailability).toHaveBeenCalledTimes(1));
    await controller.setRefreshEnabled(false);
    resolveAvailability({ available: true, experimental: true, errorCode: null });

    await expect(refresh).resolves.toEqual({ accepted: false, errorCode: "refresh_disabled" });
    expect(refreshProvider.requestRefresh).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      phase: "waiting",
      refreshEnabled: false,
      refreshAvailable: false,
      errorCode: "refresh_disabled",
    });
  });

  test("cancels controller ownership of an active request when disabled and blocks every later request", async () => {
    const refreshProvider = provider();
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });

    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
    await controller.setRefreshEnabled(false);
    await expect(controller.refreshNow()).resolves.toEqual({ accepted: false, errorCode: "refresh_disabled" });

    const observed = zone(WINDOW_TIME + 100);
    controller.observePassiveResponse(observed, WINDOW_TIME + 200);
    expect(controller.getState()).toMatchObject({
      current: observed,
      phase: "current",
      source: "captured",
      refreshEnabled: false,
      refreshAvailable: false,
      errorCode: "refresh_disabled",
    });
    expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(1);
  });

  test("surfaces unavailable readiness as a sanitized state without invoking the provider", async () => {
    const refreshProvider = provider({
      availability: { available: false, experimental: true, errorCode: "one_shot_consumed" },
    });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });

    await expect(controller.refreshNow()).resolves.toEqual({
      accepted: false,
      errorCode: "one_shot_consumed",
    });
    expect(controller.getState()).toMatchObject({
      phase: "unavailable",
      refreshAvailable: false,
      refreshExperimental: true,
      errorCode: "one_shot_consumed",
    });
    expect(refreshProvider.requestRefresh).not.toHaveBeenCalled();
  });

  test("treats a passive response during helper handoff as completion and does not arm a later timeout", async () => {
    vi.useFakeTimers();
    let resolveDispatch!: (result: SatanicZoneRefreshDispatchResult) => void;
    const dispatch = new Promise<SatanicZoneRefreshDispatchResult>((resolve) => {
      resolveDispatch = resolve;
    });
    const refreshProvider = provider({ dispatch });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
      responseTimeoutMs: 100,
    });

    const refresh = controller.refreshNow();
    await vi.waitFor(() => expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(1));
    controller.observePassiveResponse(zone(WINDOW_TIME), WINDOW_TIME + 1);
    resolveDispatch({ accepted: true, errorCode: null, correlationId: null });
    await expect(refresh).resolves.toEqual({ accepted: true, errorCode: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(controller.getState()).toMatchObject({ phase: "current", errorCode: null });
  });

  test.each(["markUnavailable", "dispose"] as const)(
    "aborts an in-flight helper dispatch and gates a detached acceptance when %s clears the refresh",
    async (action) => {
      let now = WINDOW_TIME;
      let resolveDispatch!: (result: SatanicZoneRefreshDispatchResult) => void;
      let dispatchSignal: AbortSignal | undefined;
      const dispatch = new Promise<SatanicZoneRefreshDispatchResult>((resolve) => {
        resolveDispatch = resolve;
      });
      const waitForObservation = vi.fn(async () => null);
      const refreshProvider = provider({ waitForObservation });
      refreshProvider.requestRefresh.mockImplementation(
        async (options?: SatanicZoneRefreshRequestOptions) => {
          dispatchSignal = options?.signal;
          return dispatch;
        },
      );
      const controller = new SatanicZoneController({
        provider: refreshProvider,
        initialState: enabledState(),
        onStateChange: vi.fn(),
        now: () => now,
      });

      const refresh = controller.refreshNow();
      await vi.waitFor(() => expect(refreshProvider.requestRefresh).toHaveBeenCalledTimes(1));
      if (action === "markUnavailable") controller.markUnavailable("capture_unavailable");
      else controller.dispose();
      expect(dispatchSignal?.aborted).toBe(true);

      now = WINDOW_TIME + 5000;
      resolveDispatch({
        accepted: true,
        errorCode: null,
        correlationId: "0123456789abcdef0123456789abcdef",
      });
      await expect(refresh).resolves.toEqual({ accepted: false, errorCode: "helper_unavailable" });
      expect(waitForObservation).not.toHaveBeenCalled();
      expect(controller.getState().nextAllowedRefreshAt).toBe(WINDOW_TIME + 35_000);
      if (action === "markUnavailable") {
        expect(controller.getState()).toMatchObject({
          phase: "unavailable",
          errorCode: "capture_unavailable",
        });
      }
    },
  );

  test("keeps a passive response captured and leaves one-shot availability untouched during preflight", async () => {
    let resolveAvailability!: (availability: SatanicZoneRefreshAvailability) => void;
    const availability = new Promise<SatanicZoneRefreshAvailability>((resolve) => {
      resolveAvailability = resolve;
    });
    const refreshProvider = provider({ availability });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });

    const refresh = controller.refreshNow();
    const captured = zone(WINDOW_TIME + 1);
    controller.observePassiveResponse(captured, WINDOW_TIME + 2);
    resolveAvailability({ available: true, experimental: true, errorCode: null });

    await expect(refresh).resolves.toEqual({ accepted: true, errorCode: null });
    expect(controller.getState()).toMatchObject({
      current: captured,
      source: "captured",
      errorCode: null,
      refreshAvailable: false,
    });
    expect(refreshProvider.requestRefresh).not.toHaveBeenCalled();
  });

  test("accepts a correlated provider observation through the same state merge path", async () => {
    const observed = zone(WINDOW_TIME + 100);
    const waitForObservation = vi.fn(async () => ({
      kind: "observation" as const,
      observation: { zone: observed, observedAt: WINDOW_TIME + 200 },
      availabilityConsumed: true,
    }));
    const refreshProvider = provider({ waitForObservation });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
      responseTimeoutMs: 750,
    });

    await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("current"));

    expect(waitForObservation).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
      expect.objectContaining({ timeoutMs: 750, signal: expect.any(AbortSignal) }),
    );
    expect(controller.getState()).toMatchObject({
      current: observed,
      source: "manual",
      lastSuccessAt: WINDOW_TIME + 200,
      refreshAvailable: false,
      errorCode: "one_shot_consumed",
    });
  });

  test("lets an ordinary passive response win the race and aborts the provider observation", async () => {
    let resolveObservation!: (outcome: SatanicZoneProviderWaitOutcome | null) => void;
    const observationPromise = new Promise<SatanicZoneProviderWaitOutcome | null>((resolve) => {
      resolveObservation = resolve;
    });
    let observationSignal: AbortSignal | undefined;
    const waitForObservation = vi.fn(async (_id: string, options: SatanicZoneObservationWaitOptions) => {
      observationSignal = options.signal;
      return observationPromise;
    });
    const refreshProvider = provider({ waitForObservation });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });

    await controller.refreshNow();
    const captured = zone(WINDOW_TIME + 10);
    controller.observePassiveResponse(captured, WINDOW_TIME + 20);
    expect(observationSignal?.aborted).toBe(true);

    resolveObservation({
      kind: "observation",
      observation: { zone: zone(WINDOW_TIME + 1000), observedAt: WINDOW_TIME + 1000 },
      availabilityConsumed: true,
    });
    await Promise.resolve();
    expect(controller.getState().current).toBe(captured);
    expect(controller.getState().phase).toBe("current");
  });

  test("uses the provider's bounded observation wait instead of arming a second timeout", async () => {
    const scheduleTimeout = vi.fn(setTimeout);
    const refreshProvider = provider({ waitForObservation: vi.fn(async () => null) });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
      scheduleTimeout,
      responseTimeoutMs: 250,
    });

    await controller.refreshNow();
    await vi.waitFor(() => expect(controller.getState().phase).toBe("failed"));
    expect(controller.getState().errorCode).toBe("response_timeout");
    expect(scheduleTimeout).not.toHaveBeenCalled();
  });

  test.each([
    [false, "helper_rejected", true, "helper_rejected"],
    [true, "helper_failed", false, "one_shot_consumed"],
  ] as const)(
    "settles a sanitized terminal outcome (consumed=%s) without misreporting a timeout",
    async (availabilityConsumed, terminalError, refreshAvailable, stateError) => {
      const waitForObservation = vi.fn(async () => ({
        kind: "terminal" as const,
        errorCode: terminalError,
        availabilityConsumed,
      }));
      const controller = new SatanicZoneController({
        provider: provider({ waitForObservation }),
        initialState: enabledState(),
        onStateChange: vi.fn(),
        now: () => WINDOW_TIME,
      });

      await expect(controller.refreshNow()).resolves.toEqual({ accepted: true, errorCode: null });
      await vi.waitFor(() => expect(controller.getState().phase).toBe("failed"));
      expect(controller.getState()).toMatchObject({
        refreshAvailable,
        errorCode: stateError,
      });
      expect(waitForObservation).toHaveBeenCalledWith(
        "0123456789abcdef0123456789abcdef",
        expect.objectContaining({ timeoutMs: 30_000 }),
      );
    },
  );

  test("fails closed when an observation-capable provider accepts without a correlation id", async () => {
    const waitForObservation = vi.fn(async () => null);
    const refreshProvider = provider({
      dispatch: Promise.resolve({ accepted: true, errorCode: null, correlationId: null }),
      waitForObservation,
    });
    const controller = new SatanicZoneController({
      provider: refreshProvider,
      initialState: enabledState(),
      onStateChange: vi.fn(),
      now: () => WINDOW_TIME,
    });

    await expect(controller.refreshNow()).resolves.toEqual({ accepted: false, errorCode: "helper_failed" });
    expect(controller.getState()).toMatchObject({ phase: "failed", errorCode: "helper_failed" });
    expect(waitForObservation).not.toHaveBeenCalled();
  });
});

function provider(options: {
  availability?: SatanicZoneRefreshAvailability | Promise<SatanicZoneRefreshAvailability>;
  dispatch?: Promise<SatanicZoneRefreshDispatchResult>;
  waitForObservation?: (
    correlationId: string,
    options: SatanicZoneObservationWaitOptions,
  ) => Promise<SatanicZoneProviderWaitOutcome | null>;
  subscribeToPassiveObservations?: (
    listener: SatanicZonePassiveObservationListener,
  ) => () => void;
} = {}): SatanicZoneRefreshProvider & {
  getAvailability: ReturnType<typeof vi.fn>;
  requestRefresh: ReturnType<typeof vi.fn>;
} {
  const refreshProvider: SatanicZoneRefreshProvider & {
    getAvailability: ReturnType<typeof vi.fn>;
    requestRefresh: ReturnType<typeof vi.fn>;
  } = {
    experimental: true,
    getAvailability: vi.fn(async () => options.availability ?? {
      available: true,
      experimental: true,
      errorCode: null,
    }),
    requestRefresh: vi.fn(async () => options.dispatch ?? {
      accepted: true,
      errorCode: null,
      correlationId: "0123456789abcdef0123456789abcdef",
    }),
  };
  if (options.waitForObservation) refreshProvider.waitForObservation = options.waitForObservation;
  if (options.subscribeToPassiveObservations) {
    refreshProvider.subscribeToPassiveObservations = options.subscribeToPassiveObservations;
  }
  return refreshProvider;
}

function zone(updatedAt: number): SatanicZoneInfo {
  return {
    rawZone: "Act_08_03",
    zone: "Act 8: Forgotten Caves",
    act: 8,
    area: 3,
    pros: [],
    cons: [],
    buffs: [],
    updatedAt,
  };
}

function enabledState() {
  return { ...createInitialSatanicZoneState(), refreshEnabled: true };
}
