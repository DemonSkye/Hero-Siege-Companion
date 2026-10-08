// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
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

  test("native confirmation of changed bytes retains the path, refreshes approval and survives restart", async () => {
    const f = fixture(), confirm = vi.fn(async () => true);
    const owner = new GameExecutable(() => f.storage, confirm);
    await owner.approveNativeSelection(f.selected, () => true);
    fs.appendFileSync(f.selected, "intentional synthetic update");
    await owner.launch(() => true);
    expect(confirm).toHaveBeenCalledWith(fs.realpathSync(f.selected));
    expect(JSON.parse(fs.readFileSync(f.storage, "utf8")).sha256)
      .toBe(createHash("sha256").update(fs.readFileSync(f.selected)).digest("hex"));
    await new GameExecutable(() => f.storage).launch(() => true);
    expect(confirm).toHaveBeenCalledTimes(1); expect(processMock.spawn).toHaveBeenCalledTimes(2);
  });
  test.each(["cancel", "content change", "authorization loss", "selection change"])
    ("native confirmation preserves old approval and blocks dispatch after %s", async reason => {
      const f = fixture(); let authorized = true;
      const confirm = vi.fn(async () => {
        if (reason === "content change") fs.appendFileSync(f.selected, "another change during dialog");
        if (reason === "authorization loss") authorized = false;
        if (reason === "selection change") fs.writeFileSync(f.storage, "changed by another selection");
        return reason !== "cancel";
      });
      const owner = new GameExecutable(() => f.storage, confirm);
      await owner.approveNativeSelection(f.selected, () => true);
      const original = fs.readFileSync(f.storage, "utf8");
      fs.appendFileSync(f.selected, "updated bytes before dialog");
      await expect(owner.launch(() => authorized)).rejects.toThrow();
      expect(fs.readFileSync(f.storage, "utf8")).toBe(reason === "selection change" ? "changed by another selection" : original);
      expect(processMock.spawn).not.toHaveBeenCalled();
    });
  test("retargeted canonical paths do not receive the native update-confirmation shortcut", async () => {
    const f = fixture(), confirm = vi.fn(async () => true), owner = new GameExecutable(() => f.storage, confirm);
    await owner.approveNativeSelection(f.selected, () => true);
    const other = path.join(f.directory, "another.exe"); fs.copyFileSync(f.selected, other);
    vi.spyOn(fs.promises, "realpath").mockResolvedValue(other);
    await expect(owner.launch(() => true)).rejects.toThrow("Browse");
    expect(confirm).not.toHaveBeenCalled(); expect(processMock.spawn).not.toHaveBeenCalled();
  });
  test("a pending changed-file dialog rejects another launch without another prompt", async () => {
    const f = fixture(); let answer!: (allow: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; }));
    const owner = new GameExecutable(() => f.storage, confirm);
    await owner.approveNativeSelection(f.selected, () => true); fs.appendFileSync(f.selected, "updated bytes");
    const first = owner.launch(() => true);
    // Attach the rejection handler before resolving the pending native answer.
    const cancelled = expect(first).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await expect(owner.launch(() => true)).rejects.toThrow("cancelled");
    answer(false); await cancelled;
    expect(confirm).toHaveBeenCalledTimes(1); expect(processMock.spawn).not.toHaveBeenCalled();
  });
});
