/** Bounds owned raw buffers, including transient copies and configured native capacity.
 * JavaScript strings/objects, allocator overhead and OS socket memory are separate.
 */
export class SatanicZoneDiagnosticBufferBudget {
  private used = 0;
  private peak = 0;
  private disposed = false;
  private denied = false;
  private readonly allocations = new Map<Buffer, () => void>();
  constructor(readonly limit = 1_048_576) {}
  get peakBytes(): number { return this.peak; }
  get usedBytes(): number { return this.used; }
  get exceeded(): boolean { return this.denied; }

  reserve(bytes: number): () => void {
    if (this.disposed || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit - this.used) {
      this.denied = true; throw new Error("byte-limit");
    }
    this.used += bytes; this.peak = Math.max(this.peak, this.used);
    let released = false;
    return () => { if (released) return; released = true; this.used -= bytes; };
  }
  allocate(bytes: number): Buffer {
    const release = this.reserve(bytes);
    try { const buffer = Buffer.alloc(bytes); this.allocations.set(buffer, release); return buffer; }
    catch (error) { release(); throw error; }
  }
  copy(bytes: Buffer): Buffer { const copy = this.allocate(bytes.length); bytes.copy(copy); return copy; }
  concat(parts: readonly Buffer[]): Buffer {
    const buffer = this.allocate(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0; for (const part of parts) { part.copy(buffer, offset); offset += part.length; } return buffer;
  }
  release(buffer: Buffer): void { buffer.fill(0); this.allocations.get(buffer)?.(); this.allocations.delete(buffer); }
  dispose(): void { this.disposed = true; for (const buffer of this.allocations.keys()) this.release(buffer); }
}
