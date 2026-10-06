import fs from "node:fs";
import path from "node:path";
import { connectProbeIdentity, coherentProbePostLogin } from "./satanic-zone-initialized-protocol";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";

export interface LoginCacheBodies { connectBody: Buffer; postLoginBody: Buffer; build: string }
export interface LoginCacheEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
const MAX_FILE = 131_072;
/** Dedicated encrypted file, never included in configuration exports or support bundles. */
export class SatanicZoneLoginCacheStore {
  constructor(private readonly file: string, private readonly encryption: LoginCacheEncryption) {}
  available(): boolean { try { return this.encryption.isEncryptionAvailable(); } catch { return false; } }
  load(budget: SatanicZoneDiagnosticBufferBudget): LoginCacheBodies | null {
    if (!this.available()) throw new Error("encryption_unavailable");
    if (!fs.existsSync(this.file)) return null;
    let encrypted: Buffer | undefined;
    let connectBody: Buffer | undefined, postLoginBody: Buffer | undefined;
    try {
      const fd = fs.openSync(this.file, "r");
      try {
        const bytes = fs.fstatSync(fd).size;
        if (bytes <= 0 || bytes > MAX_FILE) throw new Error();
        encrypted = budget.allocate(bytes);
        if (fs.readSync(fd, encrypted, 0, bytes, 0) !== bytes || fs.fstatSync(fd).size !== bytes) throw new Error();
      } finally { fs.closeSync(fd); }
      const text = this.encryption.decryptString(encrypted);
      if (text.length > 70_000) throw new Error();
      const record = JSON.parse(text);
      if (!record || record.schema !== 1 || Object.keys(record).sort().join() !== "build,connect,post,schema"
        || !/^[a-f0-9]{64}$/.test(record.build) || !validHex(record.connect) || !validHex(record.post)) throw new Error();
      connectBody = budget.allocate(record.connect.length / 2); connectBody.write(record.connect, "hex");
      postLoginBody = budget.allocate(record.post.length / 2); postLoginBody.write(record.post, "hex");
      const identity = connectProbeIdentity(connectBody);
      if (!identity || !coherentProbePostLogin(postLoginBody, identity)) throw new Error();
      return { connectBody, postLoginBody, build: record.build };
    } catch {
      if (connectBody) budget.release(connectBody); if (postLoginBody) budget.release(postLoginBody);
      if (!this.forget()) throw new Error("clear_failed");
      throw new Error("storage_error");
    } finally { if (encrypted) budget.release(encrypted); }
  }
  save(bodies: LoginCacheBodies, budget: SatanicZoneDiagnosticBufferBudget): void {
    if (!this.available()) throw new Error("encryption_unavailable");
    const temporary = `${this.file}.tmp`;
    let encrypted: Buffer | undefined, release: (() => void) | undefined;
    try {
      encrypted = this.encryption.encryptString(JSON.stringify({ schema: 1, build: bodies.build,
        connect: bodies.connectBody.toString("hex"), post: bodies.postLoginBody.toString("hex") }));
      if (!encrypted.length || encrypted.length > MAX_FILE) throw new Error();
      release = budget.reserve(encrypted.length);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const fd = fs.openSync(temporary, "w", 0o600);
      try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.file);
    } catch { try { fs.unlinkSync(temporary); } catch {} throw new Error("storage_error"); }
    finally { encrypted?.fill(0); release?.(); }
  }
  forget(): boolean {
    let cleared = true;
    for (const file of [this.file, `${this.file}.tmp`]) {
      try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleared = false; }
    }
    return cleared;
  }
}
function validHex(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && value.length <= 32_768
    && value.length % 2 === 0 && /^[a-f0-9]+$/.test(value);
}
