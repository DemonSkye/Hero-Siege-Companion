import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Agent, ClientRequest } from "node:http";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarketPrivateDiagnostic } from "../../src/main/market-private-diagnostic";
import { MarketPrivateTraceWriter } from "../../src/main/market-private-trace-writer";

const bridge = vi.hoisted(() => ({ data: undefined as unknown, post: vi.fn(), request: vi.fn() }));
vi.mock("node:worker_threads", () => ({ default: { get workerData() { return bridge.data; }, parentPort: { postMessage: bridge.post } },
  get workerData() { return bridge.data; }, parentPort: { postMessage: bridge.post } }));
vi.mock("node:https", () => ({ default: { request: bridge.request } }));
const directories: string[] = [];
const directory = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-private-market-test-")); directories.push(value); return value; };
afterEach(() => { directories.splice(0).forEach(value => fs.rmSync(value, { recursive: true, force: true })); bridge.post.mockReset(); bridge.request.mockReset(); });
const context = { generation: 1, revision: 1, updatedAt: 1000, scopeKey: "PRIVATE_RAW_SCOPE_CANARY",
  endpoint: { address: "192.0.2.1", port: 6668 }, fields: { account_id: "7-424242", unique_account_id: "PRIVATE_RAW_UID_CANARY",
    crossregion_identifier: "PRIVATE_RAW_CROSS_CANARY", season: "11", hardcore: "0", beta: "0" } };
class Request extends EventEmitter {
  body = "";
  _header = "POST /market/herosiege_api_bootstrap.php HTTP/1.1\r\nHost: hsmarket.panicartstudios.com\r\nX-Test: HEADER_CANARY\r\n\r\n";
  getHeaders() { return { "x-test": "HEADER_CANARY" }; }
  end = vi.fn((body: string) => { this.body = body; });
  destroy = vi.fn();
}
class Response extends EventEmitter { statusCode = 200; statusMessage = "OK"; httpVersion = "1.1";
  rawHeaders = ["Set-Cookie", "RESPONSE_COOKIE_CANARY", "X-Exact", "ONE", "X-Exact", "TWO"];
  headers = { "set-cookie": ["RESPONSE_COOKIE_CANARY"], "x-exact": "ONE, TWO" }; }
async function entry(filename?: string) {
  vi.resetModules(); bridge.post.mockClear(); bridge.request.mockReset();
  const outgoing = new Request(); let received!: (response: Response) => void;
  bridge.request.mockImplementation((_options, callback) => { received = callback; return outgoing; });
  bridge.data = { context, request: { itemMask: 1, statFilters: [] }, ...(filename ? { privateTracePath: filename } : {}) };
  await import("../../src/main/market-direct-search-worker");
  expect(bridge.request).toHaveBeenCalledTimes(1); expect(outgoing.end).toHaveBeenCalledTimes(1);
  const response = new Response(); received(response);
  const terminal = async () => { await vi.waitFor(() => expect(bridge.post.mock.calls.some(([value]) => !value.type)).toBe(true)); };
  return { outgoing, response, terminal };
}
const records = (filename: string) => fs.readFileSync(filename, "utf8").trim().split("\n").map(line => JSON.parse(line));
describe("one explicitly enabled own Market request raw diagnostic", () => {
  test("short filesystem writes still retain a complete JSON record", () => {
    const filename = path.join(directory(), "short-writes.jsonl");
    const write = fs.writeSync.bind(fs);
    const shortWrites = vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, data: string | Buffer, offset?: number, length?: number) =>
      typeof data === "string" ? write(fd, data.slice(0, 7)) : write(fd, data, offset, Math.min(length ?? data.length, 7))) as typeof fs.writeSync);
    try {
      const writer = new MarketPrivateTraceWriter(filename, 1024);
      writer.prepared("account_id=SHORT_WRITE_CANARY", "https://fixture.invalid/market");
      expect(writer.finish(undefined, false)).toBe(true);
    } finally { shortWrites.mockRestore(); }
    expect(records(filename)[0]).toMatchObject({ event: "request-form", bodyUtf8: "account_id=SHORT_WRITE_CANARY" });
  });
  test("real Node request serialization records generated headers and byte-exact body using only an in-memory socket", async () => {
    const writes: Buffer[] = [];
    const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { writes.push(Buffer.from(chunk)); done(); } });
    const agent = new Agent(); agent.createConnection = () => socket;
    const body = "account_id=SERIALIZER_CANARY&value=%2B%26";
    const request = new ClientRequest({ hostname: "fixture.invalid", path: "/market", method: "POST", agent,
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body), "accept-encoding": "identity" } });
    request.on("error", () => {}); request.end(body);
    const filename = path.join(directory(), "serialized.jsonl"), writer = new MarketPrivateTraceWriter(filename, 4 * 1024 * 1024);
    writer.request(request, body, "https://fixture.invalid/market"); writer.finish(undefined, false);
    await vi.waitFor(() => expect(Buffer.concat(writes).toString("utf8")).toContain(body));
    const stored = records(filename).find(row => row.event === "request");
    expect(stored.headerBlockAvailable).toBe(true); expect(stored.headerBlock).toContain("Host: fixture.invalid\r\n");
    expect(Buffer.concat(writes)).toEqual(Buffer.from(stored.headerBlock + body));
    request.destroy(); agent.destroy();
  });
  test("controller defaults off, cancels without deletion, and consumes its opt-in once", () => {
    const root = directory(), control = new MarketPrivateDiagnostic(root);
    expect(control.snapshot()).toEqual({ phase: "off" }); expect(control.take()).toBeUndefined();
    const first = control.setEnabled(true); expect(first.phase).toBe("armed"); expect(first.filePath).toContain("private-market-diagnostics");
    expect(fs.existsSync(first.filePath!)).toBe(false); control.setEnabled(false); expect(control.take()).toBeUndefined();
    control.setEnabled(true); const filename = control.take()!; expect(control.take()).toBeUndefined();
    fs.writeFileSync(filename, "PRIVATE_EVIDENCE_CANARY"); control.finish(true);
    expect(control.snapshot()).toMatchObject({ phase: "saved", completeResponse: true });
    control.setEnabled(false); expect(fs.readFileSync(filename, "utf8")).toBe("PRIVATE_EVIDENCE_CANARY");
    expect(new MarketPrivateDiagnostic(root).snapshot()).toEqual({ phase: "off" });
  });
  test("actual worker preserves exact request headers/body and complete response bytes only in the local artifact", async () => {
    const filename = path.join(directory(), "private.jsonl"), run = await entry(filename);
    expect(fs.existsSync(filename)).toBe(true);
    const bytes = Buffer.from('{"status":-3,"error":"RESPONSE_BODY_CANARY", "extra":"unredacted"}\n');
    run.response.emit("data", bytes.subarray(0, 9)); run.response.emit("data", bytes.subarray(9)); run.response.emit("end"); await run.terminal();
    const rows = records(filename);
    expect(rows.find(row => row.event === "request")).toMatchObject({ headerBlock: run.outgoing._header, bodyUtf8: run.outgoing.body });
    expect(Buffer.from(rows.find(row => row.event === "request").bodyBase64, "base64").toString("utf8")).toBe(run.outgoing.body);
    expect(rows.find(row => row.event === "response")).toMatchObject({ statusCode: 200, rawHeaders: run.response.rawHeaders });
    expect(Buffer.concat(rows.filter(row => row.event === "response-chunk").map(row => Buffer.from(row.base64, "base64")))).toEqual(bytes);
    expect(rows.find(row => row.event === "response-body").bodyUtf8).toBe(bytes.toString("utf8"));
    expect(rows.at(-1)).toMatchObject({ event: "end", completeResponse: true, truncated: false });
    expect(JSON.stringify(bridge.post.mock.calls)).not.toMatch(/PRIVATE_RAW|HEADER_CANARY|RESPONSE_COOKIE_CANARY|RESPONSE_BODY_CANARY/);
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
  test("default worker emits no raw artifact progress or private response text", async () => {
    const run = await entry(); run.response.emit("data", Buffer.from('{"status":-3,"message":"RESPONSE_BODY_CANARY"}')); run.response.emit("end"); await run.terminal();
    expect(bridge.post.mock.calls.some(([value]) => value.type === "private-diagnostic")).toBe(false);
    expect(JSON.stringify(bridge.post.mock.calls)).not.toMatch(/PRIVATE_RAW|RESPONSE_BODY_CANARY|HEADER_CANARY/);
  });
  test("response cap retains only its bounded prefix, records truncation, and sends no retry", async () => {
    const filename = path.join(directory(), "bounded.jsonl"), run = await entry(filename);
    run.response.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1, 65)); await run.terminal();
    const rows = records(filename), chunks = rows.filter(row => row.event === "response-chunk");
    expect(chunks.reduce((count, row) => count + Buffer.from(row.base64, "base64").length, 0)).toBe(4 * 1024 * 1024);
    expect(rows.at(-1)).toMatchObject({ completeResponse: false, truncated: true });
    expect(run.outgoing.destroy).toHaveBeenCalledTimes(1); expect(bridge.request).toHaveBeenCalledTimes(1);
  });
  test("failure preserves received partial evidence and never overwrites an existing file", async () => {
    const filename = path.join(directory(), "partial.jsonl"), run = await entry(filename);
    run.response.emit("data", Buffer.from("PARTIAL_RESPONSE_CANARY")); run.outgoing.emit("timeout"); await run.terminal();
    const before = fs.readFileSync(filename);
    expect(records(filename).at(-1)).toMatchObject({ reason: "timeout", completeResponse: false });
    const second = await entry(filename); second.response.emit("end"); await second.terminal();
    expect(fs.readFileSync(filename)).toEqual(before);
    expect(bridge.post.mock.calls).toContainEqual([{ type: "private-diagnostic", writeSucceeded: false, completeResponse: true }]);
  });
});
