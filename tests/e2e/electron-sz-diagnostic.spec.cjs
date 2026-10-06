const { test, expect } = require("@playwright/test");
const { withCompanionApp, getRendererState } = require("./support/companion-app.cjs");

test("diagnostic preload stays idle until explicit Arm and cannot open native capture in mock mode", async () => {
  await withCompanionApp(async ({ page }) => {
    expect((await getRendererState(page)).satanicZoneDiagnostic.phase).toBe("idle");
    await page.evaluate(() => window.heroSiegeCompanion.setSatanicZoneRefreshEnabled(false));
    const result = await page.evaluate(() => window.heroSiegeCompanion.armSatanicZoneDiagnostic());
    expect(["arming", "unavailable"]).toContain(result.phase);
    await expect.poll(async () => (await getRendererState(page)).satanicZoneDiagnostic.phase).toBe("unavailable");
    const diagnostic = (await getRendererState(page)).satanicZoneDiagnostic;
    expect(diagnostic).toMatchObject({ reason: "game-not-ready", requestDispatched: false, frames: [], bytesObserved: 0 });
    expect(Object.keys(diagnostic).sort()).toEqual(["connectAcknowledgment", "selectionStatus", "capturePackets", "apiFlowCount", "probeStage", "outboundFrames", "inboundFrames", "controlFrames", "phase", "reason", "startedAt", "deadlineAt", "bytesObserved", "freshSyn", "attributed",
      "initializationComplete", "naturalBaseline", "nativeZoneInboundOrdinal", "frames", "frameSummaryLimited", "requestDispatched", "directOutcome", "bootstrapPong",
      "secondControl", "requestBodyMatchesNative", "peakOwnedBufferBytes", "directEvents", "nativeBootstrapControl", "secondControlMatchesNative"].sort());
    const cancelled = await page.evaluate(() => window.heroSiegeCompanion.cancelSatanicZoneDiagnostic());
    const notStarted = await page.evaluate(() => window.heroSiegeCompanion.startSatanicZoneDiagnostic());
    expect(notStarted.directOutcome).toBe("not-attempted");
    expect(cancelled.phase).toBe("unavailable");
    expect((await getRendererState(page)).captureStatus).toBe("running");
  });
});
