import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { connectProbeIdentity, coherentProbePostLogin } from "./satanic-zone-initialized-protocol";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";

export interface LoginCacheBodies { connectBody: Buffer; postLoginBody: Buffer }
// Version fixes the KDF/cipher parameters. No algorithm negotiation or adjacent key.
const MAGIC = Buffer.from("HSCSZ001"), HEADER = 52, MAX_BODY = 16_384, MAX_FILE = HEADER + 8 + 2 * MAX_BODY;
/** Passphrase-encrypted portable file. Key exists only in main RAM until Lock/close. */
export class SatanicZoneLoginCacheStore {
  private key: Buffer | null = null;
  private salt: Buffer | null = null;
  private releaseKey: (() => void) | null = null;
  private epoch = 0;
  private unlocking = false;
  constructor(private readonly file: string) {}
  isUnlocked(): boolean { return this.key !== null; }
  lock(): void {
    this.epoch++; this.key?.fill(0); this.salt?.fill(0); this.releaseKey?.();
    this.key = null; this.salt = null; this.releaseKey = null;
  }
  /** Wrong password/corruption never destroys a file. Fresh identity is a separate gate. */
  async unlock(passphrase: string, budget: SatanicZoneDiagnosticBufferBudget): Promise<LoginCacheBodies | null> {
    if (this.unlocking) throw new Error("cancelled");
    this.unlocking = true;
    this.lock(); const epoch = this.epoch;
    let packed: Buffer | undefined, password: Buffer | undefined, derived: Buffer | undefined;
    let releaseDerived: (() => void) | undefined;
    let bodies: LoginCacheBodies | null = null;
    try {
      if (typeof passphrase !== "string" || Buffer.byteLength(passphrase, "utf8") > 1024 || Array.from(passphrase).length < 12) throw new Error("unlock_failed");
      packed = this.read(budget);
      if (packed && (packed.length < HEADER + 8 || !packed.subarray(0, 8).equals(MAGIC))) throw new Error("unlock_failed");
      const salt = packed ? Buffer.from(packed.subarray(8, 24)) : randomBytes(16);
      password = budget.allocate(Buffer.byteLength(passphrase, "utf8")); password.write(passphrase, "utf8");
      derived = await new Promise<Buffer>((resolve, reject) => scrypt(password!, salt, 32,
        { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(new Error("unlock_failed")) : resolve(key)));
      if (epoch !== this.epoch) throw new Error("cancelled");
      releaseDerived = budget.reserve(derived.length);
      if (packed) bodies = this.decrypt(packed, derived, budget);
      this.key = derived; this.salt = salt; this.releaseKey = releaseDerived;
      derived = undefined; releaseDerived = undefined;
      return bodies;
    } catch (error) {
      if (bodies) { budget.release(bodies.connectBody); budget.release(bodies.postLoginBody); }
      if (epoch === this.epoch) this.lock();
      throw new Error(error instanceof Error && ["storage_error", "cancelled"].includes(error.message) ? error.message : "unlock_failed");
    } finally { derived?.fill(0); releaseDerived?.(); if (password) budget.release(password); if (packed) budget.release(packed); this.unlocking = false; }
  }
  private read(budget: SatanicZoneDiagnosticBufferBudget): Buffer | undefined {
    let packed: Buffer | undefined;
    try {
      const fd = fs.openSync(this.file, "r");
      try {
        const size = fs.fstatSync(fd).size;
        if (size < HEADER + 8 || size > MAX_FILE) throw new Error("unlock_failed");
        packed = budget.allocate(size);
        if (fs.readSync(fd, packed, 0, size, 0) !== size || fs.fstatSync(fd).size !== size) throw new Error("unlock_failed");
        return packed;
      } finally { fs.closeSync(fd); }
    } catch (error) {
      if (packed) budget.release(packed);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(error instanceof Error && error.message === "unlock_failed" ? "unlock_failed" : "storage_error");
    }
  }
  private decrypt(packed: Buffer, key: Buffer, budget: SatanicZoneDiagnosticBufferBudget): LoginCacheBodies {
    const release = budget.reserve(3 * packed.length);
    let update: Buffer | undefined, tail: Buffer | undefined, plain: Buffer | undefined, connectBody: Buffer | undefined;
    try {
      const cipher = createDecipheriv("aes-256-gcm", key, packed.subarray(24, 36));
      cipher.setAAD(MAGIC); cipher.setAuthTag(packed.subarray(36, HEADER));
      update = cipher.update(packed.subarray(HEADER)); tail = cipher.final(); plain = Buffer.concat([update, tail]);
      const connectSize = plain.readUInt32LE(0), postSize = plain.readUInt32LE(4);
      if (connectSize < 2 || postSize < 2 || connectSize > MAX_BODY || postSize > MAX_BODY || plain.length !== 8 + connectSize + postSize) throw new Error();
      const connect = plain.subarray(8, 8 + connectSize), post = plain.subarray(8 + connectSize);
      const identity = connectProbeIdentity(connect);
      if (!identity || !coherentProbePostLogin(post, identity)) throw new Error();
      connectBody = budget.copy(connect);
      return { connectBody, postLoginBody: budget.copy(post) };
    } catch { if (connectBody) budget.release(connectBody); throw new Error("unlock_failed"); }
    finally { update?.fill(0); tail?.fill(0); plain?.fill(0); release(); }
  }
  save(bodies: LoginCacheBodies, budget: SatanicZoneDiagnosticBufferBudget): void {
    if (!this.key || !this.salt) throw new Error("locked");
    const epoch = this.epoch, temporary = `${this.file}.tmp`, key = this.key;
    let plain: Buffer | undefined, encrypted: Buffer | undefined, tail: Buffer | undefined, packed: Buffer | undefined;
    let release: (() => void) | undefined, ownsTemporary = false;
    try {
      const identity = connectProbeIdentity(bodies.connectBody);
      if (!identity || !coherentProbePostLogin(bodies.postLoginBody, identity)
        || bodies.connectBody.length > MAX_BODY || bodies.postLoginBody.length > MAX_BODY) throw new Error();
      plain = budget.allocate(8 + bodies.connectBody.length + bodies.postLoginBody.length);
      plain.writeUInt32LE(bodies.connectBody.length, 0); plain.writeUInt32LE(bodies.postLoginBody.length, 4);
      bodies.connectBody.copy(plain, 8); bodies.postLoginBody.copy(plain, 8 + bodies.connectBody.length);
      release = budget.reserve(2 * plain.length + HEADER);
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(MAGIC);
      encrypted = cipher.update(plain); tail = cipher.final();
      packed = Buffer.concat([MAGIC, this.salt, iv, cipher.getAuthTag(), encrypted, tail]);
      if (epoch !== this.epoch || key !== this.key || packed.length > MAX_FILE) throw new Error();
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const fd = fs.openSync(temporary, "wx", 0o600); ownsTemporary = true;
      try { fs.writeFileSync(fd, packed); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (epoch !== this.epoch || key !== this.key) throw new Error();
      fs.renameSync(temporary, this.file); ownsTemporary = false;
    } catch { if (ownsTemporary) { try { fs.unlinkSync(temporary); } catch {} } throw new Error("storage_error"); }
    finally { if (plain) budget.release(plain); encrypted?.fill(0); tail?.fill(0); packed?.fill(0); release?.(); }
  }
  forget(): boolean {
    this.lock(); let cleared = true;
    for (const file of [this.file, `${this.file}.tmp`]) {
      try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleared = false; }
    }
    return cleared;
  }
}
