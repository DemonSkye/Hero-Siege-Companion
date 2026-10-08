import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

interface ApprovedExecutable {
  schemaVersion: 1;
  path: string;
  sha256: string;
}

// A native dialog grants consent for this exact local file. Neither a familiar
// filename nor renderer preferences establish executable identity or consent.
export class GameExecutable {
  private updateConfirmationPending = false;
  constructor(private readonly storagePath: () => string,
    private readonly confirmChangedFile?: (filePath: string) => Promise<boolean>) {}

  selectedPath(): string | null {
    return this.load()?.path ?? null;
  }

  async approveNativeSelection(selectedPath: string, authorized: () => boolean): Promise<string> {
    const approved = await inspectExecutable(selectedPath);
    if (!authorized()) throw new Error("Game executable selection cancelled.");
    const file = this.storagePath();
    if (!file) throw new Error("Game executable storage is unavailable.");
    // Approval never comes from imports, localStorage or IPC payload paths.
    fs.writeFileSync(file, JSON.stringify(approved), { encoding: "utf8", mode: 0o600 });
    return approved.path;
  }

  async launch(authorized: () => boolean): Promise<void> {
    const approved = this.load();
    if (!approved) throw new Error("Choose the Hero Siege executable with Browse in Settings first.");
    let current = await inspectExecutable(approved.path);
    if (current.path !== approved.path) {
      throw new Error("The selected executable changed. Use Browse in Settings to approve it again.");
    }
    if (current.sha256 !== approved.sha256) current = await this.approveChangedFile(approved, current, authorized);
    if (!authorized()) throw new Error("Game launch cancelled.");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(current.path, [], {
        cwd: path.dirname(current.path), shell: false, detached: true, stdio: "ignore",
      });
      child.once("error", () => reject(new Error("Could not start the selected Hero Siege executable.")));
      child.once("spawn", () => { child.unref(); resolve(); });
    });
  }

  private async approveChangedFile(previous: ApprovedExecutable, candidate: ApprovedExecutable,
    authorized: () => boolean): Promise<ApprovedExecutable> {
    if (!this.confirmChangedFile) throw new Error("The selected executable changed. Use Browse in Settings to approve it again.");
    if (this.updateConfirmationPending || !authorized()) throw new Error("Game launch cancelled.");
    this.updateConfirmationPending = true;
    try {
      if (!await this.confirmChangedFile(previous.path) || !authorized()) throw new Error("Game launch cancelled.");
      const current = await inspectExecutable(previous.path);
      const stillApproved = this.load();
      if (current.path !== candidate.path || current.sha256 !== candidate.sha256
        || stillApproved?.path !== previous.path || stillApproved.sha256 !== previous.sha256 || !authorized()) {
        throw new Error("The selected executable changed again. Try Launch Game again or use Browse in Settings.");
      }
      fs.writeFileSync(this.storagePath(), JSON.stringify(current), { encoding: "utf8", mode: 0o600 });
      return current;
    } finally { this.updateConfirmationPending = false; }
  }

  private load(): ApprovedExecutable | null {
    try {
      const file = this.storagePath();
      if (!file || fs.statSync(file).size > 16_384) return null;
      const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ApprovedExecutable>;
      if (value.schemaVersion !== 1 || typeof value.path !== "string" || !isLocalExecutablePath(value.path)
        || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return null;
      return value as ApprovedExecutable;
    } catch { return null; }
  }
}

function isLocalExecutablePath(value: string): boolean {
  // Local drive paths only: reject URLs, UNC/device paths, ADS, relative paths
  // and command-line strings. Spaces remain part of a single file path.
  return /^[A-Za-z]:[\\/]/.test(value) && !/[\x00-\x1f<>"|?*]/.test(value)
    && !value.slice(2).includes(":") && path.extname(value).toLowerCase() === ".exe";
}

async function inspectExecutable(selectedPath: string): Promise<ApprovedExecutable> {
  if (!isLocalExecutablePath(selectedPath)) throw new Error("Choose a local Windows game executable (.exe).");
  const canonical = await fs.promises.realpath(selectedPath);
  if (!isLocalExecutablePath(canonical)) throw new Error("Choose a local Windows game executable (.exe).");
  const file = await fs.promises.open(canonical, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 64) throw new Error("The selected file is not a Windows executable.");
    const dos = Buffer.alloc(64);
    await file.read(dos, 0, dos.length, 0);
    const offset = dos.readUInt32LE(60);
    if (dos.toString("ascii", 0, 2) !== "MZ" || offset < 64 || offset > before.size - 26) {
      throw new Error("The selected file is not a Windows executable.");
    }
    const pe = Buffer.alloc(26);
    await file.read(pe, 0, pe.length, offset);
    const flags = pe.readUInt16LE(22), magic = pe.readUInt16LE(24);
    if (pe.readUInt32LE(0) !== 0x00004550 || !(flags & 2) || (flags & 0x2000)
      || (magic !== 0x10b && magic !== 0x20b)) throw new Error("The selected file is not a Windows executable.");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("The selected executable changed while being checked. Use Browse again.");
    }
    return { schemaVersion: 1, path: canonical, sha256: hash.digest("hex") };
  } finally { await file.close(); }
}
