// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GameExecutable } from "../../src/main/game-executable";
const processMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => processMock);
const directories: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-launch-policy-")); directories.push(directory);
  const pe = Buffer.alloc(512);
  pe.write("MZ"); pe.writeUInt32LE(128, 60); pe.write("PE\0\0", 128);
  pe.writeUInt16LE(2, 150); pe.writeUInt16LE(0x20b, 152);
  const selected = path.join(directory, "a standalone game.exe"), storage = path.join(directory, "approval.json");
  fs.writeFileSync(selected, pe);
  processMock.spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn(); queueMicrotask(() => child.emit("spawn")); return child;
  });
  return { selected, storage, directory, owner: new GameExecutable(() => storage) };
}
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
describe("main-owned native executable approval", () => {
  test("consent survives restart and launches a path with spaces as one binary with no args or shell", async () => {
    const f = fixture();
    await f.owner.approveNativeSelection(f.selected, () => true);
    const reopened = new GameExecutable(() => f.storage);
    expect(reopened.selectedPath()).toBe(fs.realpathSync(f.selected));
    await reopened.launch(() => true);
    expect(processMock.spawn).toHaveBeenCalledWith(fs.realpathSync(f.selected), [],
      { cwd: f.directory, shell: false, detached: true, stdio: "ignore" });
  });
  test("missing approval and modified or missing file never dispatch", async () => {
    const f = fixture();
    await expect(f.owner.launch(() => true)).rejects.toThrow("Browse");
    await f.owner.approveNativeSelection(f.selected, () => true);
    fs.appendFileSync(f.selected, "changed bytes");
    await expect(f.owner.launch(() => true)).rejects.toThrow("changed");
    fs.unlinkSync(f.selected);
    await expect(f.owner.launch(() => true)).rejects.toThrow();
    expect(processMock.spawn).not.toHaveBeenCalled();
  });
  test.each(["relative.exe", "https://example.invalid/game.exe", "\\\\server\\share\\game.exe",
    "\\\\?\\C:\\game.exe", "C:\\game.exe:stream.exe", 'C:\\game.exe" --flag', "C:\\game.cmd", "C:\\game.exe\0"])
    ("rejects nonlocal, command-line or non-executable selection %s", async selected => {
      const f = fixture();
      await expect(f.owner.approveNativeSelection(selected, () => true)).rejects.toThrow();
      expect(f.owner.selectedPath()).toBe(null); expect(processMock.spawn).not.toHaveBeenCalled();
    });
  test("an executable-looking filename does not approve a text file or DLL", async () => {
    const f = fixture();
    fs.writeFileSync(f.selected, "this filename is no identity proof");
    await expect(f.owner.approveNativeSelection(f.selected, () => true)).rejects.toThrow("not a Windows executable");
    const dll = Buffer.alloc(512); dll.write("MZ"); dll.writeUInt32LE(128, 60);
    dll.write("PE\0\0", 128); dll.writeUInt16LE(0x2002, 150); dll.writeUInt16LE(0x20b, 152);
    fs.writeFileSync(f.selected, dll);
    await expect(f.owner.approveNativeSelection(f.selected, () => true)).rejects.toThrow("not a Windows executable");
    expect(processMock.spawn).not.toHaveBeenCalled();
  });
  test("authorization lost during selection or before dispatch cannot commit or start", async () => {
    const f = fixture();
    await expect(f.owner.approveNativeSelection(f.selected, () => false)).rejects.toThrow("cancelled");
    expect(f.owner.selectedPath()).toBe(null);
    await f.owner.approveNativeSelection(f.selected, () => true);
    await expect(f.owner.launch(() => false)).rejects.toThrow("cancelled");
    expect(processMock.spawn).not.toHaveBeenCalled();
  });
  test("retargeting a canonical path and corrupt persisted approval fail closed", async () => {
    const f = fixture(); await f.owner.approveNativeSelection(f.selected, () => true);
    const other = path.join(f.directory, "Hero_Siege.exe"); fs.copyFileSync(f.selected, other);
    vi.spyOn(fs.promises, "realpath").mockResolvedValue(other);
    await expect(f.owner.launch(() => true)).rejects.toThrow("changed");
    fs.writeFileSync(f.storage, JSON.stringify({ schemaVersion: 1, path: other, sha256: "invalid" }));
    expect(f.owner.selectedPath()).toBe(null);
    expect(processMock.spawn).not.toHaveBeenCalled();
  });
});
