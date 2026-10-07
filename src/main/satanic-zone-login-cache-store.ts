import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { connectProbeIdentity, coherentProbePostLogin } from "./satanic-zone-initialized-protocol";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";

export interface LoginCacheDestination { address: string; port: number }
export interface LoginCacheBodies { connectBody: Buffer; postLoginBody: Buffer; destination?: LoginCacheDestination }
// Existing portable ciphertext format/KDF remain compatible. Automatic reopening
// separately retains a local unlocking key only after explicit consent.
const MAGIC = Buffer.from("HSCSZ001"), DESTINATION_MAGIC = Buffer.from("HSCSZ002"), HEADER = 52, MAX_BODY = 16_384,
  MAX_DESTINATION = 128, MAX_FILE = HEADER + 8 + 2 * MAX_BODY + MAX_DESTINATION;
const KEY_MAGIC = Buffer.from("HSCSZK01"), KEY_SIZE = 56;
/** Passphrase-encrypted portable file, with an optional explicitly retained key. */
export class SatanicZoneLoginCacheStore {
  private key: Buffer | null = null;
  private salt: Buffer | null = null;
  private releaseKey: (() => void) | null = null;
  private epoch = 0;
  private unlocking = false;
  constructor(private readonly file: string) {}
  fileMetadata(): { ciphertextPresent: boolean; keyPresent: boolean } {
    return { ciphertextPresent: fs.existsSync(this.file), keyPresent: fs.existsSync(`${this.file}.key`) };
  }
  isUnlocked(): boolean { return this.key !== null; }
  lock(): void {
    this.epoch++; this.key?.fill(0); this.salt?.fill(0); this.releaseKey?.();
    this.key = null; this.salt = null; this.releaseKey = null;
  }
  /** Wrong password/corruption never destroys a file. Unlocking sends no request. */
  async unlock(passphrase: string, budget: SatanicZoneDiagnosticBufferBudget): Promise<LoginCacheBodies | null> {
    if (this.unlocking) throw new Error("cancelled");
    this.unlocking = true;
    this.lock(); const epoch = this.epoch;
    let packed: Buffer | undefined, password: Buffer | undefined, derived: Buffer | undefined;
    let releaseDerived: (() => void) | undefined;
    let bodies: LoginCacheBodies | null = null;
    try {
      if (typeof passphrase !== "string" || Buffer.byteLength(passphrase, "utf8") > 1024 || Array.from(passphrase).length < 8) throw new Error("unlock_failed");
      packed = this.read(budget);
      if (packed && (packed.length < HEADER + 8 || !knownMagic(packed))) throw new Error("unlock_failed");
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
  /** Read only after the separate automatic-reopening preference has been opted in. */
  unlockAutomatic(budget: SatanicZoneDiagnosticBufferBudget): LoginCacheBodies | null {
    this.lock();
    let retained: Buffer | undefined, packed: Buffer | undefined;
    try {
      const fd = fs.openSync(`${this.file}.key`, "r");
      try {
        if (fs.fstatSync(fd).size !== KEY_SIZE) throw new Error("unlock_failed");
        retained = budget.allocate(KEY_SIZE);
        if (fs.readSync(fd, retained, 0, KEY_SIZE, 0) !== KEY_SIZE || fs.fstatSync(fd).size !== KEY_SIZE
          || !retained.subarray(0, 8).equals(KEY_MAGIC)) throw new Error("unlock_failed");
      } finally { fs.closeSync(fd); }
      packed = this.read(budget);
      if (packed && (!knownMagic(packed) || !packed.subarray(8, 24).equals(retained.subarray(8, 24)))) throw new Error("unlock_failed");
      this.releaseKey = budget.reserve(32); this.key = Buffer.from(retained.subarray(24)); this.salt = Buffer.from(retained.subarray(8, 24));
      return packed ? this.decrypt(packed, this.key, budget) : null;
    } catch (error) {
      this.lock();
      throw new Error(error instanceof Error && error.message === "storage_error" ? "storage_error" : "unlock_failed");
    } finally { if (retained) budget.release(retained); if (packed) budget.release(packed); }
  }
  /** The key is locally readable, not protected by encoding or an OS credential store. */
  retainUnlockingKey(budget: SatanicZoneDiagnosticBufferBudget): void {
    if (!this.key || !this.salt) throw new Error("locked");
    const retained = budget.allocate(KEY_SIZE), epoch = this.epoch, key = this.key;
    try {
      KEY_MAGIC.copy(retained); this.salt.copy(retained, 8); key.copy(retained, 24);
      this.replace(`${this.file}.key`, retained, () => epoch === this.epoch && key === this.key);
    } finally { budget.release(retained); }
  }
  forgetUnlockingKey(): boolean { return this.remove([`${this.file}.key`, `${this.file}.key.tmp`]); }
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
      cipher.setAAD(packed.subarray(0, 8)); cipher.setAuthTag(packed.subarray(36, HEADER));
      update = cipher.update(packed.subarray(HEADER)); tail = cipher.final(); plain = Buffer.concat([update, tail]);
      const connectSize = plain.readUInt32LE(0), postSize = plain.readUInt32LE(4);
      const bodyEnd = 8 + connectSize + postSize;
      if (connectSize < 2 || postSize < 2 || connectSize > MAX_BODY || postSize > MAX_BODY || plain.length < bodyEnd) throw new Error();
      let destination: LoginCacheDestination | undefined;
      if (packed.subarray(0, 8).equals(DESTINATION_MAGIC)) {
        if (plain.length === bodyEnd || plain.length - bodyEnd > MAX_DESTINATION) throw new Error();
        destination = JSON.parse(plain.subarray(bodyEnd).toString("utf8")) as LoginCacheDestination;
        if (!validLoginCacheDestination(destination)) throw new Error();
      } else if (plain.length !== bodyEnd) throw new Error();
      const connect = plain.subarray(8, 8 + connectSize), post = plain.subarray(8 + connectSize, bodyEnd);
      const identity = connectProbeIdentity(connect);
      if (!identity || !coherentProbePostLogin(post, identity)) throw new Error();
      connectBody = budget.copy(connect);
      return { connectBody, postLoginBody: budget.copy(post), ...(destination ? { destination } : {}) };
    } catch { if (connectBody) budget.release(connectBody); throw new Error("unlock_failed"); }
    finally { update?.fill(0); tail?.fill(0); plain?.fill(0); release(); }
  }
  save(bodies: LoginCacheBodies, budget: SatanicZoneDiagnosticBufferBudget): void {
    if (!this.key || !this.salt) throw new Error("locked");
    const epoch = this.epoch, key = this.key;
    let plain: Buffer | undefined, encrypted: Buffer | undefined, tail: Buffer | undefined, packed: Buffer | undefined;
    let release: (() => void) | undefined;
    try {
      const identity = connectProbeIdentity(bodies.connectBody);
      if (!identity || !coherentProbePostLogin(bodies.postLoginBody, identity)
        || bodies.connectBody.length > MAX_BODY || bodies.postLoginBody.length > MAX_BODY) throw new Error();
      if (bodies.destination && !validLoginCacheDestination(bodies.destination)) throw new Error();
      const destination = bodies.destination ? JSON.stringify(bodies.destination) : "";
      const magic = bodies.destination ? DESTINATION_MAGIC : MAGIC;
      plain = budget.allocate(8 + bodies.connectBody.length + bodies.postLoginBody.length + Buffer.byteLength(destination));
      plain.writeUInt32LE(bodies.connectBody.length, 0); plain.writeUInt32LE(bodies.postLoginBody.length, 4);
      bodies.connectBody.copy(plain, 8); bodies.postLoginBody.copy(plain, 8 + bodies.connectBody.length);
      if (destination) plain.write(destination, 8 + bodies.connectBody.length + bodies.postLoginBody.length);
      release = budget.reserve(2 * plain.length + HEADER);
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(magic);
      encrypted = cipher.update(plain); tail = cipher.final();
      packed = Buffer.concat([magic, this.salt, iv, cipher.getAuthTag(), encrypted, tail]);
      if (epoch !== this.epoch || key !== this.key || packed.length > MAX_FILE) throw new Error();
      this.replace(this.file, packed, () => epoch === this.epoch && key === this.key);
    } catch { throw new Error("storage_error"); }
    finally { if (plain) budget.release(plain); encrypted?.fill(0); tail?.fill(0); packed?.fill(0); release?.(); }
  }
  forget(): boolean {
    this.lock();
    return this.remove([this.file, `${this.file}.tmp`, `${this.file}.key`, `${this.file}.key.tmp`]);
  }
  private remove(files: readonly string[]): boolean {
    let cleared = true;
    for (const file of files) {
      try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleared = false; }
    }
    return cleared;
  }
  private replace(file: string, bytes: Buffer, current: () => boolean): void {
    const temporary = `${file}.tmp`; let ownsTemporary = false;
    try {
      if (!current()) throw new Error();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(temporary, "wx", 0o600); ownsTemporary = true;
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (!current()) throw new Error();
      fs.renameSync(temporary, file); ownsTemporary = false;
    } catch {
      if (ownsTemporary) { try { fs.unlinkSync(temporary); } catch {} }
      throw new Error("storage_error");
    }
  }
}
function knownMagic(bytes: Buffer): boolean { return bytes.subarray(0, 8).equals(MAGIC) || bytes.subarray(0, 8).equals(DESTINATION_MAGIC); }
export function validLoginCacheDestination(value: unknown): value is LoginCacheDestination {
  if (!value || typeof value !== "object") return false;
  const destination = value as LoginCacheDestination;
  return typeof destination.address === "string" && isIP(destination.address) === 4 && [6668, 6669].includes(destination.port)
    && Object.keys(value).length === 2;
}
