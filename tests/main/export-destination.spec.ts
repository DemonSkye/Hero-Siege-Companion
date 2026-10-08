// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { safeExportDestination } from "../../src/main/export-destination";
const directories: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-export-path-")); directories.push(directory);
  const storage = path.join(directory, "storage"), code = path.join(directory, "app"), exports = path.join(directory, "exports");
  for (const dir of [storage, code, exports]) fs.mkdirSync(dir);
  const approval = path.join(storage, "game-executable.json"), game = path.join(directory, "approved-game.exe");
  fs.writeFileSync(approval, "original approval"); fs.writeFileSync(game, "synthetic game");
  return { directory, storage, code, exports, approval, game, policy: { roots: [storage, code], files: [game] } };
}
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
test("rejects existing and nonexistent internal targets with segment-aware case-insensitive containment", () => {
  const f = fixture();
  for (const target of [f.approval, f.approval.toUpperCase(), path.join(f.storage, "new", "config.json"),
    path.join(f.code, "main.js"), f.game, `${f.approval}. `, `${f.approval}:stream`]) {
    expect(() => safeExportDestination(target, f.policy)).toThrow();
  }
  const sibling = `${f.storage}-exports`; fs.mkdirSync(sibling);
  const target = path.join(sibling, "backup.json");
  expect(safeExportDestination(target, f.policy)).toBe(target);
});
test("resolves junctions for existing files and their missing descendants", () => {
  const f = fixture(), alias = path.join(f.exports, "alias"); fs.symlinkSync(f.storage, alias, "junction");
  for (const target of [path.join(alias, "game-executable.json"), path.join(alias, "new", "config.json")]) {
    expect(() => safeExportDestination(target, f.policy)).toThrow();
  }
  const approvedAlias = path.join(f.exports, "game-dir"); fs.symlinkSync(f.directory, approvedAlias, "junction");
  expect(() => safeExportDestination(path.join(approvedAlias, "approved-game.exe"), f.policy)).toThrow();
});
test("rejects hard-linked overwrite while permitting fresh and ordinary overwritten exports", () => {
  const f = fixture(), alias = path.join(f.exports, "approval.json"); fs.linkSync(f.approval, alias);
  expect(() => safeExportDestination(alias, f.policy)).toThrow();
  const target = path.join(f.exports, "ordinary.json");
  expect(safeExportDestination(target, f.policy)).toBe(target);
  fs.writeFileSync(target, "original export");
  expect(safeExportDestination(target, f.policy)).toBe(target);
  expect(fs.readFileSync(f.approval, "utf8")).toBe("original approval");
});
test("uses canonical roots even when the protected root itself is an alias", () => {
  const f = fixture(), alias = path.join(f.exports, "storage-root"); fs.symlinkSync(f.storage, alias, "junction");
  expect(() => safeExportDestination(f.approval, { roots: [alias], files: [] })).toThrow();
});
test("rejects namespace, relative, stream and unresolved link paths", () => {
  const f = fixture();
  for (const target of ["relative.json", "C:relative.json", `\\\\?\\${f.approval}`, `\\\\.\\${f.approval}`, `${f.game}:stream`]) {
    expect(() => safeExportDestination(target, f.policy)).toThrow();
  }
  const alias = path.join(f.exports, "dangling"); fs.symlinkSync(path.join(f.directory, "missing"), alias, "junction");
  expect(() => safeExportDestination(path.join(alias, "backup.json"), f.policy)).toThrow();
});
test("canonical filesystem aliases cannot defeat lexical-path differences", () => {
  const f = fixture(), alias = path.join(f.exports, "short-name.json"); fs.writeFileSync(alias, "synthetic alias");
  const realpath = fs.realpathSync.native;
  vi.spyOn(fs.realpathSync, "native").mockImplementation(target => String(target) === alias ? f.approval : realpath(target));
  expect(() => safeExportDestination(alias, f.policy)).toThrow();
});
