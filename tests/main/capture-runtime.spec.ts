import { afterEach, describe, expect, test, vi } from "vitest";
import type { CaptureUpdate } from "../../src/main/capture-runtime";
import { DEFAULT_CAPTURE_PREFERENCES } from "../../src/shared/initial-state";

describe("capture runtime selection", () => {
  afterEach(() => {
    vi.doUnmock("../../src/main/capture");
    vi.resetModules();
    delete process.env.HERO_SIEGE_COMPANION_E2E;
  });

  test("falls back to a user-visible Npcap error when native capture cannot load", async () => {
    vi.doMock("../../src/main/capture", () => {
      throw new Error("cap.node missing");
    });
    const updates: CaptureUpdate[] = [];
    const { createCaptureRuntime, NATIVE_CAPTURE_UNAVAILABLE_MESSAGE } = await import("../../src/main/capture-runtime");

    const runtime = await createCaptureRuntime((update) => updates.push(update), "capture-debug.log", "capture-wide-debug.log", DEFAULT_CAPTURE_PREFERENCES);

    expect(updates).toContainEqual(
      expect.objectContaining({
        running: false,
        status: "error",
        error: NATIVE_CAPTURE_UNAVAILABLE_MESSAGE,
        connections: [],
        health: expect.objectContaining({
          npcapService: "Unavailable",
          winPcapCompatible: false,
          device: null,
        }),
        log: expect.objectContaining({
          level: "error",
          message: expect.stringContaining(NATIVE_CAPTURE_UNAVAILABLE_MESSAGE),
        }),
      }),
    );
    await expect(runtime.hasHeroSiegeProcess()).resolves.toBe(false);

    updates.length = 0;
    await runtime.start();

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "error",
        error: NATIVE_CAPTURE_UNAVAILABLE_MESSAGE,
      }),
    );
  });
});
