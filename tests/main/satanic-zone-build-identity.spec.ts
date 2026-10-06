import { describe, expect, test, vi } from "vitest";
const native = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ ...native, default: native }));
import { getHeroSiegeBuildIdentity } from "../../src/main/capture-network";
describe("cache game build identity with every OS boundary mocked", () => {
  test("normalizes one SHA256; query uses current validated PID, no retained path or version guess", async () => {
    native.execFile.mockImplementationOnce((_exe, _args, _options, callback) => callback(null, "E".repeat(64), ""));
    expect(await getHeroSiegeBuildIdentity(42)).toBe("e".repeat(64));
    expect(native.execFile.mock.calls[0][1].at(-1)).toContain("Get-Process -Id 42");
    expect(native.execFile.mock.calls[0][1].at(-1)).toContain("Get-FileHash -LiteralPath $game.Path -Algorithm SHA256");
  });
  test("invalid PID, missing hash or native exception cannot supply a guessed build identity", async () => {
    expect(await getHeroSiegeBuildIdentity(0)).toBeNull(); expect(native.execFile).not.toHaveBeenCalled();
    native.execFile.mockImplementationOnce((_exe, _args, _options, callback) => callback(null, "unknown", ""));
    expect(await getHeroSiegeBuildIdentity(42)).toBeNull();
    native.execFile.mockImplementationOnce((_exe, _args, _options, callback) => callback(new Error("private path"), "", "private path"));
    expect(await getHeroSiegeBuildIdentity(42)).toBeNull();
  });
});
