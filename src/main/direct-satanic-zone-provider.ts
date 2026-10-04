import net from "node:net";
import { randomUUID } from "node:crypto";
import type { SatanicZoneInfo } from "../shared/parser";
import type { SatanicZoneRequestContext } from "./captured-session-context";
import {
  buildDirectApiPingFrame,
  buildDirectSatanicZoneFrame,
  DirectApiPingResponseDecoder,
  DirectSatanicZoneResponseDecoder,
} from "./direct-satanic-zone-protocol";
import type {
  SatanicZoneObservationWaitOptions,
  SatanicZoneProviderWaitOutcome,
  SatanicZoneRefreshAvailability,
  SatanicZoneRefreshDispatchResult,
  SatanicZoneRefreshProvider,
  SatanicZoneRefreshRequestOptions,
} from "./satanic-zone-refresh-provider";

const DISPATCH_COOLDOWN_MS = 30_000;
const TRANSPORT_TIMEOUT_MS = 20_000;

export interface DirectSatanicZoneContextSource {
  satanicZoneContext(): SatanicZoneRequestContext | null;
  subscribe(listener: () => void): () => void;
}

export interface TransportRequest {
  dispatched: Promise<void>;
  outcome: Promise<SatanicZoneInfo>;
  abort(): void;
}

type DirectSatanicZoneTransport = (context: SatanicZoneRequestContext, signal?: AbortSignal) => TransportRequest;
type DirectSatanicZoneTransportLog = (type: string, data: Record<string, unknown>) => void;

export type DirectSatanicZoneTransportTrace =
  | { kind: "connected"; localAddress: string; localPort: number; remoteAddress: string; remotePort: number }
  | { kind: "outgoing"; phase: "bootstrap" | "zone"; bytes: Buffer }
  | { kind: "incoming"; bytes: Buffer }
  | { kind: "bootstrapped" };

export interface DirectSatanicZoneTransportOptions {
  // Main-process only; borrowed buffers must never be passed to logging or IPC.
  trace?: (event: DirectSatanicZoneTransportTrace) => void;
  createSocket?: () => net.Socket;
  bufferBudget?: import("./satanic-zone-diagnostic-budget").SatanicZoneDiagnosticBufferBudget;
}

export class DirectSatanicZoneRefreshProvider implements SatanicZoneRefreshProvider {
  readonly experimental = false;
  private nextAllowedDispatchAt = 0;
  private pending: { correlationId: string; context: SatanicZoneRequestContext; request: TransportRequest } | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly contextSource: DirectSatanicZoneContextSource,
    private readonly transport: DirectSatanicZoneTransport = createDirectSatanicZoneTransport,
    private readonly now: () => number = Date.now,
  ) {
    this.unsubscribe = contextSource.subscribe(() => this.cancelPending());
  }

  async getAvailability(): Promise<SatanicZoneRefreshAvailability> {
    return this.contextSource.satanicZoneContext()
      ? { available: true, experimental: false, errorCode: null }
      : { available: false, experimental: false, errorCode: "helper_not_ready" };
  }

  async requestRefresh(options: SatanicZoneRefreshRequestOptions = {}): Promise<SatanicZoneRefreshDispatchResult> {
    if (options.signal?.aborted) return rejected("helper_unavailable");
    if (this.pending) return rejected("refresh_pending");
    if (this.now() < this.nextAllowedDispatchAt) return rejected("refresh_cooldown");
    const context = this.contextSource.satanicZoneContext();
    if (!context) return rejected("helper_not_ready");

    const correlationId = randomUUID().replace(/-/g, "");
    const request = this.transport(context, options.signal);
    if (options.signal?.aborted) { request.abort(); return rejected("helper_unavailable"); }
    this.pending = { correlationId, context, request };
    try {
      await request.dispatched;
    } catch {
      if (this.pending?.correlationId === correlationId) this.pending = null;
      request.abort();
      return rejected("helper_failed");
    }
    const current = this.contextSource.satanicZoneContext();
    if (!current || current.generation !== context.generation || current.revision !== context.revision
      || current.scopeKey !== context.scopeKey) {
      this.cancelPending();
      return rejected("helper_not_ready");
    }
    this.nextAllowedDispatchAt = this.now() + DISPATCH_COOLDOWN_MS;
    return { accepted: true, errorCode: null, correlationId };
  }

  async waitForObservation(
    correlationId: string,
    options: SatanicZoneObservationWaitOptions,
  ): Promise<SatanicZoneProviderWaitOutcome | null> {
    const pending = this.pending;
    if (!pending || pending.correlationId !== correlationId) return null;
    try {
      const zone = await raceOutcome(pending.request.outcome, options.timeoutMs, options.signal);
      const current = this.contextSource.satanicZoneContext();
      if (!current || current.generation !== pending.context.generation || current.revision !== pending.context.revision
        || current.scopeKey !== pending.context.scopeKey) {
        return { kind: "terminal", errorCode: "helper_failed", availabilityConsumed: false };
      }
      return { kind: "observation", observation: { zone, observedAt: zone.updatedAt }, availabilityConsumed: false };
    } catch (error) {
      return {
        kind: "terminal",
        errorCode: error instanceof TimeoutError ? "response_timeout" : "helper_failed",
        availabilityConsumed: false,
      };
    } finally {
      if (this.pending?.correlationId === correlationId) {
        this.pending.request.abort();
        this.pending = null;
      }
    }
  }

  stop(): void {
    this.cancelPending();
  }

  dispose(): void {
    this.unsubscribe();
    this.cancelPending();
  }

  private cancelPending(): void {
    this.pending?.request.abort();
    this.pending = null;
  }
}

export function createDirectSatanicZoneTransport(
  context: SatanicZoneRequestContext,
  parentSignal?: AbortSignal,
  log: DirectSatanicZoneTransportLog = () => undefined,
  options: DirectSatanicZoneTransportOptions = {},
): TransportRequest {
  const socket = options.createSocket?.() ?? new net.Socket();
  const pingDecoder = new DirectApiPingResponseDecoder(options.bufferBudget);
  const decoder = new DirectSatanicZoneResponseDecoder(options.bufferBudget);
  const startedAt = Date.now();
  let responseBytes = 0;
  let responseChunks = 0;
  let bootstrapBytes = 0;
  let responsePhase: "bootstrap" | "zone" = "bootstrap";
  let wasDispatched = false;
  let dispatchedResolve!: () => void;
  let dispatchedReject!: (error: Error) => void;
  let outcomeResolve!: (zone: SatanicZoneInfo) => void;
  let outcomeReject!: (error: Error) => void;
  let settled = false;
  let cleanedUp = false;
  const trace = (event: DirectSatanicZoneTransportTrace) => {
    try { options.trace?.(event); } catch { /* Observers cannot alter transport or leak exceptions. */ }
  };
  const dispatched = new Promise<void>((resolve, reject) => { dispatchedResolve = resolve; dispatchedReject = reject; });
  const outcome = new Promise<SatanicZoneInfo>((resolve, reject) => { outcomeResolve = resolve; outcomeReject = reject; });
  void outcome.catch(() => undefined);
  const report = (
    status: "started" | "bootstrap-sent" | "bootstrapped" | "dispatched" | "succeeded" | "failed",
    reason?: string,
  ) => {
    log("satanic-zone-direct-transport", {
      status,
      reason,
      contextRevision: context.revision,
      durationMs: Date.now() - startedAt,
      responseBytes,
      responseChunks,
      bootstrapBytes,
      dispatched: wasDispatched,
    });
  };
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    socket.setTimeout(0);
    pingDecoder.dispose(); decoder.dispose();
    parentSignal?.removeEventListener("abort", abort);
    socket.destroy();
  };
  const fail = (error: Error, reason: string) => {
    if (settled) { cleanup(); return; }
    settled = true;
    report("failed", reason);
    dispatchedReject(error);
    outcomeReject(error);
    cleanup();
  };
  const abort = () => fail(new Error("cancelled"), "cancelled");
  report("started");
  parentSignal?.addEventListener("abort", abort, { once: true });
  socket.setTimeout(TRANSPORT_TIMEOUT_MS, () => fail(new TimeoutError(), "timeout"));
  socket.once("error", () => fail(new Error("transport"), "socket-error"));
  socket.once("close", () => {
    if (!settled) fail(new Error("closed"), "closed-before-zone");
  });
  const acceptZoneBytes = (chunk: Buffer) => {
    if (chunk.length === 0 || settled) return;
    try {
      const zone = decoder.push(chunk, Date.now());
      if (!zone) return;
      settled = true;
      report("succeeded");
      outcomeResolve(zone);
      cleanup();
    } catch {
      fail(new Error("invalid-response"), "response-too-large");
    }
  };
  const dispatchZoneRequest = (remainder: Buffer) => {
    responsePhase = "zone";
    bootstrapBytes = 10;
    report("bootstrapped");
    trace({ kind: "bootstrapped" });
    if (settled) return;
    const frame = buildDirectSatanicZoneFrame(context, 1, options.bufferBudget);
    trace({ kind: "outgoing", phase: "zone", bytes: frame });
    if (settled) { options.bufferBudget?.release(frame); return; }
    socket.write(frame, (error) => {
      options.bufferBudget ? options.bufferBudget.release(frame) : frame.fill(0);
      if (error) fail(error, "write-error");
      else {
        wasDispatched = true;
        report("dispatched");
        dispatchedResolve();
      }
    });
    acceptZoneBytes(remainder);
    pingDecoder.dispose();
  };
  socket.on("data", (chunk: Buffer) => {
    if (settled) return;
    let releaseChunk: (() => void) | undefined;
    try {
      releaseChunk = options.bufferBudget?.reserve(chunk.length);
      trace({ kind: "incoming", bytes: chunk });
      if (settled) return;
      responseBytes += chunk.length;
      responseChunks += 1;
      if (responsePhase === "zone") {
        acceptZoneBytes(chunk);
        return;
      }
      try {
        const remainder = pingDecoder.push(chunk);
        if (remainder) dispatchZoneRequest(remainder);
      } catch {
        fail(new Error("invalid-bootstrap-response"), "invalid-bootstrap-response");
      }
    } catch { fail(new Error("byte-limit"), "response-too-large"); }
    finally { releaseChunk?.(); }
  });
  if (parentSignal?.aborted) { abort(); return { dispatched, outcome, abort }; }
  socket.connect(context.endpoint.port, context.endpoint.address, () => {
    if (settled) return;
    try {
      trace({ kind: "connected", localAddress: socket.localAddress ?? "", localPort: socket.localPort ?? 0,
        remoteAddress: context.endpoint.address, remotePort: context.endpoint.port });
      if (settled) return;
      const frame = buildDirectApiPingFrame(0, options.bufferBudget);
      trace({ kind: "outgoing", phase: "bootstrap", bytes: frame });
      if (settled) { options.bufferBudget?.release(frame); return; }
      socket.write(frame, (error) => {
        options.bufferBudget ? options.bufferBudget.release(frame) : frame.fill(0);
        if (error) fail(error, "bootstrap-write-error");
        else report("bootstrap-sent");
      });
    } catch { fail(new Error("byte-limit"), "bootstrap-failed"); }
  });
  return { dispatched, outcome, abort };
}

function rejected(errorCode: NonNullable<SatanicZoneRefreshDispatchResult["errorCode"]>): SatanicZoneRefreshDispatchResult {
  return { accepted: false, errorCode, correlationId: null };
}

class TimeoutError extends Error {}

function raceOutcome<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new TimeoutError()), Math.max(1, Math.min(30_000, timeoutMs)));
    const onAbort = () => reject(new Error("cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}
