import { describe, expect, test } from "vitest";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
import { buildDirectSatanicZoneFrame, DirectSatanicZoneResponseDecoder } from "../../src/main/direct-satanic-zone-protocol";

describe("shared diagnostic raw buffer accounting", () => {
  test("charges native reservations and concurrent old/new copies before allocating", () => {
    const budget = new SatanicZoneDiagnosticBufferBudget(16); const releaseNative = budget.reserve(2);
    const old = budget.allocate(6); old.fill(9); const copy = budget.copy(old);
    expect(budget.usedBytes).toBe(14); expect(() => budget.concat([old, copy])).toThrow("byte-limit");
    expect(budget.usedBytes).toBe(14); expect(budget.peakBytes).toBe(14); expect(budget.exceeded).toBe(true);
    budget.dispose(); expect(old).toEqual(Buffer.alloc(6)); expect(copy).toEqual(Buffer.alloc(6));
    releaseNative(); releaseNative(); expect(budget.usedBytes).toBe(0); expect(() => budget.allocate(1)).toThrow("byte-limit");
  });
  test("constructs the same frame while releasing temporary body and counter storage", () => {
    const context = { generation: 1, revision: 1, updatedAt: 1, uniqueAccountId: "7", crossregionIdentifier: "9", beta: "0",
      endpoint: { address: "198.51.100.20", port: 6669 }, scopeKey: "invented" };
    const budget = new SatanicZoneDiagnosticBufferBudget(); const frame = buildDirectSatanicZoneFrame(context, 1, budget);
    expect(frame.subarray(0, 12).toString("ascii")).toBe("a69d434de2f1"); expect(frame.readUInt32LE(12)).toBe(75);
    expect(frame).toEqual(buildDirectSatanicZoneFrame(context, 1)); expect(budget.usedBytes).toBe(frame.length);
    budget.release(frame); expect(budget.usedBytes).toBe(0); expect(frame).toEqual(Buffer.alloc(frame.length));
  });
  test("response concatenation shares the cap and disposal releases retained bytes", () => {
    const budget = new SatanicZoneDiagnosticBufferBudget(10); const decoder = new DirectSatanicZoneResponseDecoder(budget);
    decoder.push(Buffer.alloc(6), 1); expect(() => decoder.push(Buffer.alloc(1), 1)).toThrow("byte-limit");
    expect(budget.usedBytes).toBe(6); decoder.dispose(); expect(budget.usedBytes).toBe(0); expect(budget.peakBytes).toBeLessThanOrEqual(10);
  });
});
