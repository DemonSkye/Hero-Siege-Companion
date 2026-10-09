import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";
import { useWindowMode } from "../../src/renderer/src/lib/window-mode";

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

  test("a late hydration snapshot cannot overwrite a newer acknowledged pin transition", async () => {
    let completeHydration!: (value: { compactMode: boolean; fullWindowPinned: boolean }) => void;
    Object.defineProperty(window, "heroSiegeCompanion", { configurable: true, value: {
      getWindowMode: vi.fn().mockReturnValueOnce(new Promise((resolve) => { completeHydration = resolve; }))
        .mockResolvedValue({ compactMode: false, fullWindowPinned: true }),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    } });
    const runtime = useWindowMode({ showSettings: ref(false), showCompactCustomization: ref(false) });
    const hydrating = runtime.syncWindowMode();
    await runtime.toggleFullWindowPinned();
    completeHydration({ compactMode: false, fullWindowPinned: false });
    await hydrating;
    expect(runtime.fullWindowPinned.value).toBe(true);
  });
});
