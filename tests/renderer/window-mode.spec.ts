import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";
import { useWindowMode } from "../../src/renderer/src/lib/window-mode";

describe("window mode runtime", () => {
  test("syncs compact and always-on-top state through the preload API", async () => {
    const setAlwaysOnTop = vi.fn().mockResolvedValue(undefined);
    const setCompactMode = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "heroSiegeCompanion", {
      value: {
        setAlwaysOnTop,
        setCompactMode,
        minimizeWindow: vi.fn(),
        toggleMaximizeWindow: vi.fn(),
        closeWindow: vi.fn(),
      },
      configurable: true,
    });

    const showSettings = ref(true);
    const openSettings = vi.fn();
    const runtime = useWindowMode({
      alwaysOnTop: ref(true),
      lockCompactLocation: ref(false),
      showSettings,
      openSettings,
    });

    await runtime.syncWindowMode();
    await runtime.toggleCompactMode();
    await runtime.openCompactSettings();

    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(setCompactMode).toHaveBeenNthCalledWith(1, false, false);
    expect(setCompactMode).toHaveBeenNthCalledWith(2, true, false);
    expect(setCompactMode).toHaveBeenNthCalledWith(3, false, false);
    expect(showSettings.value).toBe(false);
    expect(openSettings).toHaveBeenCalled();
  });
});
