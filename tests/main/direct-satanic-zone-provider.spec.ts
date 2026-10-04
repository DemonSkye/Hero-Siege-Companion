import { createHash } from "node:crypto";
import net from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SatanicZoneRequestContext } from "../../src/main/captured-session-context";
import {
  createDirectSatanicZoneTransport,
  DirectSatanicZoneRefreshProvider,
  type DirectSatanicZoneContextSource,
} from "../../src/main/direct-satanic-zone-provider";

const servers: net.Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function source(context: SatanicZoneRequestContext | null) {
  let current = context;
  let listener = () => undefined;
  const value: DirectSatanicZoneContextSource = {
    satanicZoneContext: () => current,
    subscribe: (next) => { listener = next; return () => { listener = () => undefined; }; },
  };
  return { value, change(next: SatanicZoneRequestContext | null) { current = next; listener(); } };
}

async function listen(handler: (socket: net.Socket) => void): Promise<number> {
  const server = net.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  return (server.address() as net.AddressInfo).port;
}

function context(port: number): SatanicZoneRequestContext {
  return {
    generation: 1, revision: 2, updatedAt: Date.now(),
    uniqueAccountId: "hero-7", crossregionIdentifier: "xrid-one", beta: "0",
    endpoint: { address: "127.0.0.1", port }, scopeKey: "session-scope",
  };
}

function pongFrame(): Buffer {
  const header = Buffer.alloc(8);
  Buffer.from([0x81, 0x92, 0xa3, 0xb4]).copy(header);
  header.writeUInt32LE(2, 4);
  return Buffer.concat([header, Buffer.from([1, 0])]);
}

function receiveApiFrames(socket: net.Socket, onFrame: (frame: Buffer, index: number) => void): void {
  let buffered = Buffer.alloc(0);
  let index = 0;
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 16) {
      const frameLength = 16 + buffered.readUInt32LE(12);
      if (buffered.length < frameLength) return;
      const frame = buffered.subarray(0, frameLength);
      buffered = buffered.subarray(frameLength);
      onFrame(frame, index);
      index += 1;
    }
  });
}

describe("direct Satanic Zone provider", () => {
  test("uses one independent owned TCP connection from request frame through sanitized provider result", async () => {
    let received: Buffer | null = null;
    let receivedPing: Buffer | null = null;
    const diagnostics: Array<{ type: string; data: Record<string, unknown> }> = [];
    const port = await listen((socket) => receiveApiFrames(socket, (frame, index) => {
      if (index === 0) {
        receivedPing = frame;
        socket.write(pongFrame());
        return;
      }
      received = frame;
      const body = Buffer.from(JSON.stringify({ status: 1, satanicZoneName: "Act_08_03", buffs: "21|22", debuffs: "25|18" }));
      const connectionStatus = Buffer.from([0x01, 0, 0, 0, 0xff, 0x7f, 0, 0, 0, 0]);
      socket.end(Buffer.concat([connectionStatus, body]));
    }));
    const contextSource = source(context(port));
    const provider = new DirectSatanicZoneRefreshProvider(
      contextSource.value,
      (requestContext, signal) => createDirectSatanicZoneTransport(
        requestContext,
        signal,
        (type, data) => diagnostics.push({ type, data }),
      ),
    );

    const dispatch = await provider.requestRefresh();
    expect(dispatch).toMatchObject({ accepted: true, errorCode: null });
    expect(dispatch.correlationId).toMatch(/^[a-f0-9]{32}$/);
    const outcome = await provider.waitForObservation(dispatch.correlationId!, { timeoutMs: 2_000 });
    expect(outcome).toMatchObject({
      kind: "observation",
      observation: { zone: { rawZone: "Act_08_03" } },
      availabilityConsumed: false,
    });
    expect(receivedPing).not.toBeNull();
    expect(receivedPing!.subarray(16)).toEqual(Buffer.from([1, 0]));
    expect(received).not.toBeNull();
    const frame = received!;
    const body = frame.subarray(16);
    expect(frame.subarray(0, 12).toString("ascii")).toBe(
      createHash("md5").update(body).update(Buffer.from([1])).digest("hex").slice(0, 12),
    );
    expect(body.toString("utf8")).toContain("satanic_zone_get\0R\0");
    expect(diagnostics.map(({ data }) => data.status)).toEqual(expect.arrayContaining([
      "started", "bootstrap-sent", "bootstrapped", "dispatched", "succeeded",
    ]));
    expect(diagnostics.find(({ data }) => data.status === "succeeded")?.data).toMatchObject({
      responseChunks: expect.any(Number),
      responseBytes: expect.any(Number),
      bootstrapBytes: 10,
      dispatched: true,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("hero-7");
    expect(JSON.stringify(diagnostics)).not.toContain("xrid-one");
    expect(JSON.stringify(diagnostics)).not.toContain("127.0.0.1");
    provider.dispose();
  });

  test("does not consume cooldown before readiness and cancels an in-flight result on context change", async () => {
    const sockets: net.Socket[] = [];
    const port = await listen((socket) => {
      sockets.push(socket);
      receiveApiFrames(socket, (_frame, index) => {
        if (index === 0) socket.write(pongFrame());
      });
    });
    const contextSource = source(null);
    let now = 1_000;
    const provider = new DirectSatanicZoneRefreshProvider(contextSource.value, undefined, () => now);
    await expect(provider.requestRefresh()).resolves.toMatchObject({ accepted: false, errorCode: "helper_not_ready" });
    contextSource.change(context(port));
    const dispatch = await provider.requestRefresh();
    expect(dispatch.accepted).toBe(true);
    contextSource.change({ ...context(port), revision: 3 });
    await expect(provider.waitForObservation(dispatch.correlationId!, { timeoutMs: 100 })).resolves.toBeNull();
    await vi.waitFor(() => expect(sockets.every((socket) => socket.destroyed)).toBe(true));
    now += 30_000;
    provider.dispose();
  });
});
