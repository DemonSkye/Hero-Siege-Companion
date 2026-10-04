import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";
import { useWindowMode } from "../../src/renderer/src/lib/window-mode";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function windowModeFixture(initial = { compactMode: false, fullWindowPinned: false }) {
  const mainState = { ...initial };
  const api = {
    getWindowMode: vi.fn(async () => ({ ...mainState })),
    setCompactMode: vi.fn(async (enabled: boolean) => { mainState.compactMode = enabled; }),
    setAlwaysOnTop: vi.fn(async (enabled: boolean) => { mainState.fullWindowPinned = enabled; }),
  };
  Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: api });
  const showSettings = ref(true);
  const showCompactCustomization = ref(false);
  return { api, mainState, showSettings, showCompactCustomization, runtime: useWindowMode({ showSettings, showCompactCustomization }) };
}

describe("window mode runtime", () => {
  test("a recovered renderer hydrates compact and pin state without overwriting the main window", async () => {
    const setCompactMode = vi.fn();
    const setAlwaysOnTop = vi.fn();
    Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: {
      getWindowMode: vi.fn().mockResolvedValue({ compactMode: true, fullWindowPinned: true }),
      setCompactMode, setAlwaysOnTop,
    } });
    const runtime = useWindowMode({ showSettings: ref(false), showCompactCustomization: ref(false) });
    await runtime.syncWindowMode();
    expect(runtime.compactMode.value).toBe(true);
    expect(runtime.fullWindowPinned.value).toBe(true);
    expect(setCompactMode).not.toHaveBeenCalled();
    expect(setAlwaysOnTop).not.toHaveBeenCalled();
  });
  test("keeps compact pinning in main and exposes a session-only full-window pin", async () => {
    const mainState = { compactMode: false, fullWindowPinned: false };
    const setAlwaysOnTop = vi.fn(async (enabled: boolean) => { mainState.fullWindowPinned = enabled; });
    const setCompactMode = vi.fn(async (enabled: boolean) => { mainState.compactMode = enabled; });
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        setAlwaysOnTop,
        setCompactMode,
        getWindowMode: vi.fn(async () => ({ ...mainState })),
        minimizeWindow: vi.fn(),
        toggleMaximizeWindow: vi.fn(),
        closeWindow: vi.fn(),
      },
      configurable: true,
    });

    const showSettings = ref(true);
    const showCompactCustomization = ref(false);
    const runtime = useWindowMode({
      showSettings,
      showCompactCustomization,
    });

    await runtime.syncWindowMode();
    await runtime.toggleFullWindowPinned();
    await runtime.toggleCompactMode();
    await runtime.openCompactCustomization();

    expect(setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true);
    expect(setCompactMode).toHaveBeenNthCalledWith(1, true);
    expect(setCompactMode).toHaveBeenNthCalledWith(2, false);
    expect(runtime.fullWindowPinned.value).toBe(true);
    expect(showSettings.value).toBe(false);
    expect(showCompactCustomization.value).toBe(true);
  });

  test("an action waits for pending hydration before changing acknowledged pin state", async () => {
    const { api, runtime } = windowModeFixture();
    const initialRead = deferred<{ compactMode: boolean; fullWindowPinned: boolean }>();
    api.getWindowMode.mockImplementationOnce(() => initialRead.promise);
    const hydrating = runtime.syncWindowMode();
    const toggling = runtime.toggleFullWindowPinned();
    await flushPromises();
    expect(api.setAlwaysOnTop).not.toHaveBeenCalled();
    initialRead.resolve({ compactMode: false, fullWindowPinned: false });
    await Promise.all([hydrating, toggling]);
    expect(api.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true);
    expect(runtime.fullWindowPinned.value).toBe(true);
  });

  test.each(["compact", "pin"] as const)("two overlapping %s clicks preserve both toggles", async (mode) => {
    const { api, mainState, runtime } = windowModeFixture();
    const firstWrite = deferred<void>();
    const setter = mode === "compact" ? api.setCompactMode : api.setAlwaysOnTop;
    const key = mode === "compact" ? "compactMode" : "fullWindowPinned";
    const toggle = mode === "compact" ? runtime.toggleCompactMode : runtime.toggleFullWindowPinned;
    setter.mockImplementationOnce(async (enabled) => {
      await firstWrite.promise;
      mainState[key] = enabled;
    });
    const first = toggle();
    const second = toggle();
    await flushPromises();
    expect(setter.mock.calls).toEqual([[true]]);
    expect(runtime[key].value).toBe(false);
    firstWrite.resolve();
    await Promise.all([first, second]);
    expect(setter.mock.calls).toEqual([[true], [false]]);
    expect(runtime[key].value).toBe(false);
    expect(mainState[key]).toBe(false);
  });

  test("an early compact click waits for the recovered main state and exits compact", async () => {
    const { api, runtime } = windowModeFixture({ compactMode: true, fullWindowPinned: true });
    const initialRead = deferred<{ compactMode: boolean; fullWindowPinned: boolean }>();
    api.getWindowMode.mockImplementationOnce(() => initialRead.promise);
    const hydration = runtime.syncWindowMode();
    const toggling = runtime.toggleCompactMode();
    await flushPromises();
    expect(api.setCompactMode).not.toHaveBeenCalled();
    initialRead.resolve({ compactMode: true, fullWindowPinned: true });
    await Promise.all([hydration, toggling]);
    expect(api.setCompactMode).toHaveBeenCalledExactlyOnceWith(false);
    expect(runtime.compactMode.value).toBe(false);
    expect(runtime.fullWindowPinned.value).toBe(true);
  });

  test("a pin click before any hydration respects the main compact state", async () => {
    const { api, runtime } = windowModeFixture({ compactMode: true, fullWindowPinned: true });
    await runtime.toggleFullWindowPinned();
    expect(api.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(runtime.compactMode.value).toBe(true);
    expect(runtime.fullWindowPinned.value).toBe(true);
  });

  test("pin eligibility follows an overlapping compact transition", async () => {
    const { api, mainState, runtime } = windowModeFixture();
    const firstWrite = deferred<void>();
    api.setCompactMode.mockImplementationOnce(async (enabled) => {
      await firstWrite.promise;
      mainState.compactMode = enabled;
    });
    const enteringCompact = runtime.toggleCompactMode();
    const pinning = runtime.toggleFullWindowPinned();
    await flushPromises();
    expect(api.setAlwaysOnTop).not.toHaveBeenCalled();
    firstWrite.resolve();
    await Promise.all([enteringCompact, pinning]);
    expect(api.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(runtime.compactMode.value).toBe(true);
    expect(runtime.fullWindowPinned.value).toBe(false);
  });

  test("customization waits for a compact transition and acknowledges full mode", async () => {
    const { api, mainState, runtime, showCompactCustomization } = windowModeFixture();
    const firstWrite = deferred<void>();
    api.setCompactMode.mockImplementationOnce(async (enabled) => {
      await firstWrite.promise;
      mainState.compactMode = enabled;
    });
    const enteringCompact = runtime.toggleCompactMode();
    const customization = runtime.openCompactCustomization();
    await flushPromises();
    expect(api.setCompactMode.mock.calls).toEqual([[true]]);
    expect(showCompactCustomization.value).toBe(false);
    firstWrite.resolve();
    await Promise.all([enteringCompact, customization]);
    expect(api.setCompactMode.mock.calls).toEqual([[true], [false]]);
    expect(runtime.compactMode.value).toBe(false);
    expect(showCompactCustomization.value).toBe(true);
  });

  test.each(["initial-read", "setter", "acknowledgement"] as const)("a failed %s does not block a queued retry", async (failure) => {
    const { api, runtime } = windowModeFixture();
    const failedIpc = deferred<never>();
    if (failure === "initial-read") api.getWindowMode.mockImplementationOnce(() => failedIpc.promise);
    if (failure === "setter") api.setAlwaysOnTop.mockImplementationOnce(() => failedIpc.promise);
    if (failure === "acknowledgement") {
      api.getWindowMode.mockResolvedValueOnce({ compactMode: false, fullWindowPinned: false })
        .mockImplementationOnce(() => failedIpc.promise);
    }
    const first = runtime.toggleFullWindowPinned();
    const rejected = expect(first).rejects.toThrow("synthetic");
    const retry = runtime.toggleFullWindowPinned();
    const completed = Promise.all([rejected, expect(retry).resolves.toBeUndefined()]);
    await flushPromises();
    expect(api.setAlwaysOnTop.mock.calls).toEqual(failure === "initial-read" ? [] : [[true]]);
    failedIpc.reject(new Error(`synthetic ${failure} failure`));
    await completed;
    const expectedCalls = failure === "initial-read" ? [[true]] : failure === "setter" ? [[true], [true]] : [[true], [false]];
    expect(api.setAlwaysOnTop.mock.calls).toEqual(expectedCalls);
    expect(runtime.fullWindowPinned.value).toBe(failure !== "acknowledgement");
  });

  test("a newer pin transition waits for the older acknowledgement and a queued sync follows both", async () => {
    const { api, runtime } = windowModeFixture();
    const firstAcknowledgement = deferred<{ compactMode: boolean; fullWindowPinned: boolean }>();
    api.getWindowMode.mockResolvedValueOnce({ compactMode: false, fullWindowPinned: false })
      .mockImplementationOnce(() => firstAcknowledgement.promise);
    const first = runtime.toggleFullWindowPinned();
    await flushPromises();
    const second = runtime.toggleFullWindowPinned();
    const sync = runtime.syncWindowMode();
    await flushPromises();
    expect(api.setAlwaysOnTop.mock.calls).toEqual([[true]]);
    firstAcknowledgement.resolve({ compactMode: false, fullWindowPinned: true });
    await Promise.all([first, second, sync]);
    expect(api.setAlwaysOnTop.mock.calls).toEqual([[true], [false]]);
    expect(runtime.fullWindowPinned.value).toBe(false);
  });
});
