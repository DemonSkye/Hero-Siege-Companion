import fs from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";

/** Own HTTPS request only. Never pass these records through IPC/logs/support exports. */
export class MarketPrivateTraceWriter {
  private fd?: number;
  private bytes = 0;
  private truncated = false;
  private failed = false;
  constructor(filename: string, private readonly maxResponseBytes: number) {
    try { this.fd = fs.openSync(filename, "wx", 0o600); }
    catch { this.failed = true; }
  }
  private write(record: Record<string, unknown>): void {
    if (this.fd === undefined || this.failed) return;
    try {
      const bytes = Buffer.from(JSON.stringify({ at: new Date().toISOString(), ...record }) + "\n", "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        const written = fs.writeSync(this.fd, bytes, offset, bytes.length - offset);
        if (written <= 0) { this.failed = true; return; }
        offset += written;
      }
    }
    catch { this.failed = true; }
  }
  prepared(body: string, url: string): void {
    this.write({ event: "request-form", url, method: "POST", bodyUtf8: body, bodyBase64: Buffer.from(body, "utf8").toString("base64"),
      note: "Built request, not proof of submission. Unredacted local evidence; Base64 is encoding, not protection." });
  }
  request(request: ClientRequest, body: string, url: string): void {
    if (this.fd === undefined || this.failed) return;
    try {
      const headerBlock = (request as ClientRequest & { _header?: string | null })._header;
      this.write({ event: "request", url, method: "POST", headerBlock: typeof headerBlock === "string" ? headerBlock : null,
        headerBlockAvailable: typeof headerBlock === "string", headers: request.getHeaders?.() ?? null,
        bodyUtf8: body, bodyBase64: Buffer.from(body, "utf8").toString("base64"),
        note: "Unredacted private local evidence. Base64 is encoding, not protection. Response chunks are exact received bytes. No end record means incomplete." });
    } catch { this.failed = true; }
  }
  response(response: IncomingMessage): void {
    try {
      this.write({ event: "response", statusCode: response.statusCode ?? null, statusMessage: response.statusMessage ?? null,
        httpVersion: response.httpVersion ?? null, rawHeaders: response.rawHeaders ?? [], headers: response.headers ?? {} });
    } catch { this.failed = true; }
  }
  chunk(chunk: Buffer): void {
    const count = Math.min(chunk.length, Math.max(0, this.maxResponseBytes - this.bytes));
    if (count < chunk.length) this.truncated = true;
    if (count) this.write({ event: "response-chunk", offset: this.bytes, bytes: count, base64: chunk.subarray(0, count).toString("base64") });
    this.bytes += count;
  }
  completeBody(body: Buffer): void {
    this.write({ event: "response-body", bodyUtf8: body.toString("utf8"),
      note: "UTF-8 view for local reading. Response-chunk Base64 records preserve the exact bytes, including non-UTF-8 responses." });
  }
  finish(reason: string | undefined, completeResponse: boolean): boolean {
    this.write({ event: "end", reason: reason ?? null, completeResponse: completeResponse && !this.truncated,
      retainedResponseBytes: this.bytes, truncated: this.truncated });
    if (this.fd !== undefined) { try { fs.closeSync(this.fd); } catch { this.failed = true; } this.fd = undefined; }
    return !this.failed;
  }
}
