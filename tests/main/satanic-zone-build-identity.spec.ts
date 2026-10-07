import { describe, expect, test, vi } from "vitest";
const native = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ ...native, default: native }));
import { getHeroSiegeBuildIdentity } from "../../src/main/capture-network";
describe("cache game build identity with every OS boundary mocked", () => {
  test("normalizes one SHA256; query uses current validated PID, no retained path or version guess", async () => {
    native.execFile.mockImplementationOnce((_exe, _args, _options, callback) => callback(null, JSON.stringify({ stage: "ready", hash: "E".repeat(64) }), ""));
    expect(await getHeroSiegeBuildIdentity(42)).toBe("e".repeat(64));
    expect(native.execFile.mock.calls[0][1].at(-1)).toContain("Get-Process -Id 42");
    expect(native.execFile.mock.calls[0][1].at(-1)).toContain("Get-FileHash -LiteralPath $buildPath -Algorithm SHA256");
  });
  test("uses the ordinary process executable path fallback and returns only a valid build hash", async () => {
    native.execFile.mockImplementation((_exe, args, _options, callback) => {
      const fallback = args.at(-1).includes("Get-CimInstance") && args.at(-1).includes("ExecutablePath");
      callback(null, fallback ? JSON.stringify({ stage: "ready", hash: "E".repeat(64) }) : "", "");
    });
    const stages: string[] = [];
    expect(await getHeroSiegeBuildIdentity(42, stage => stages.push(stage))).toBe("e".repeat(64));
    expect(stages).toEqual(["ready"]); expect(native.execFile.mock.calls.at(-1)[2].windowsHide).toBe(true);
  });
  test.each(["process_unavailable", "path_unavailable", "hash_unavailable"])("%s remains unavailable with a fixed safe stage", async stage => {
    native.execFile.mockImplementation((_exe, _args, _options, callback) => callback(null, JSON.stringify({ stage }), ""));
    const stages: string[] = [];
    expect(await getHeroSiegeBuildIdentity(42, value => stages.push(value))).toBeNull(); expect(stages).toEqual([stage]);
  });
  test("arbitrary output and subprocess errors never escape into diagnostics", async () => {
    for (const failed of [false, true]) {
      native.execFile.mockImplementation((_exe, _args, _options, callback) => callback(failed ? new Error("CANARY_PRIVATE_PATH") : null,
        JSON.stringify({ stage: "CANARY_PRIVATE_PATH", hash: "wrong" }), "CANARY_PRIVATE_PATH"));
      const stages: string[] = [];
      expect(await getHeroSiegeBuildIdentity(42, value => stages.push(value))).toBeNull(); expect(stages).toEqual(["query_failed"]);
    }
  });
  test("invalid PID, missing hash or native exception cannot supply a guessed build identity", async () => {
    expect(await getHeroSiegeBuildIdentity(0)).toBeNull(); expect(native.execFile).not.toHaveBeenCalled();
    native.execFile.mockImplementationOnce((_exe, _args, _options, callback) => callback(null, "unknown", ""));
    expect(await getHeroSiegeBuildIdentity(42)).toBeNull();
    native.execFile.mockImplementationOnce((_exe, _args, _options, callback) => callback(new Error("private path"), "", "private path"));
    expect(await getHeroSiegeBuildIdentity(42)).toBeNull();
  });
});
