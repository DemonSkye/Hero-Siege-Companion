import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";
import { useWindowMode } from "../../src/renderer/src/lib/window-mode";

describe("window mode runtime", () => {
  test("keeps compact pinning in main and exposes a session-only full-window pin", async () => {
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
    const showCompactCustomization = ref(false);
    const runtime = useWindowMode({
      showSettings,
      showCompactCustomization,
    });

    await runtime.syncWindowMode();
    await runtime.toggleFullWindowPinned();
    await runtime.toggleCompactMode();
    await runtime.openCompactCustomization();

    expect(setAlwaysOnTop).toHaveBeenNthCalledWith(1, false);
    expect(setAlwaysOnTop).toHaveBeenNthCalledWith(2, true);
    expect(setAlwaysOnTop).toHaveBeenNthCalledWith(3, true);
    expect(setCompactMode).toHaveBeenNthCalledWith(1, false);
    expect(setCompactMode).toHaveBeenNthCalledWith(2, true);
    expect(setCompactMode).toHaveBeenNthCalledWith(3, false);
    expect(showSettings.value).toBe(false);
    expect(showCompactCustomization.value).toBe(true);
  });
});
