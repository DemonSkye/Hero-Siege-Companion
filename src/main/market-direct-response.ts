import { inflateSync } from "node:zlib";
import type { MarketSearchResponse } from "../shared/market-search";
import type { MarketRequestDiagnostics } from "./market-request-diagnostics";

export type DirectMarketFailure =
  | "http-status" | "invalid-json" | "server-rejected" | "missing-items"
  | "invalid-items" | "context-unavailable" | "timeout" | "response-too-large"
  | "response-aborted" | "tls" | "dns" | "connection" | "worker" | "cancelled";
export interface DirectMarketDiagnostics {
  reason?: DirectMarketFailure;
  httpStatus?: number;
  applicationStatus?: number;
  serverReason?: "checksum" | "multipass" | "account" | "session" | "rate-limit" | "other";
  responseBytes?: number;
  contextRevision?: number;
  contextAgeMs?: number;
  requestContext?: MarketRequestDiagnostics;
  /** Submitted means request.end(body) returned locally, never server delivery. */
  dispatchStatus?: "unconfirmed" | "submitted";
}
export interface DirectMarketWorkerResult {
  response: MarketSearchResponse;
  diagnostics: DirectMarketDiagnostics;
}

export interface DirectMarketWorkerProgress {
  type: "request-context";
  diagnostics: {
    contextRevision: number;
    contextAgeMs: number;
    requestContext: MarketRequestDiagnostics;
    dispatchStatus: "unconfirmed" | "submitted";
  };
}
export type DirectMarketWorkerMessage = DirectMarketWorkerProgress | DirectMarketWorkerResult;

export function directMarketFailure(reason: DirectMarketFailure, diagnostics: DirectMarketDiagnostics = {}): DirectMarketWorkerResult {
  const errorCode = reason === "context-unavailable" ? "template_unavailable"
    : reason === "server-rejected" && diagnostics.serverReason === "checksum" ? "checksum_rejected"
    : reason === "worker" || reason === "cancelled" ? "helper_unavailable"
    : reason === "timeout" ? "timed_out"
    : ["server-rejected", "missing-items", "invalid-json", "invalid-items"].includes(reason) ? "cached_request_rejected"
    : "market_unreachable";
  return { response: { ok: false, errorCode }, diagnostics: { ...diagnostics, reason } };
}

export function inspectDirectMarketResponse(body: Buffer, statusCode: number | undefined): DirectMarketWorkerResult {
  const diagnostics: DirectMarketDiagnostics = { httpStatus: statusCode, responseBytes: body.length };
  if (statusCode !== 200) return directMarketFailure("http-status", diagnostics);
  let envelope: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return directMarketFailure("invalid-json", diagnostics);
    envelope = parsed as Record<string, unknown>;
  } catch {
    return directMarketFailure("invalid-json", diagnostics);
  }
  if (typeof envelope.status === "number" && Number.isSafeInteger(envelope.status) && Math.abs(envelope.status) <= 1000) {
    diagnostics.applicationStatus = envelope.status;
  }
  if (envelope.status !== 1) {
    // Classify in memory; never retain arbitrary server text or echoed identity.
    const message = [envelope.message, envelope.error].filter((value) => typeof value === "string").join(" ").slice(0, 4096);
    diagnostics.serverReason = /checksum/i.test(message) ? "checksum"
      : /multipass/i.test(message) ? "multipass"
      : /account/i.test(message) ? "account"
      : /session|expired|crossregion/i.test(message) ? "session"
      : /rate.limit|too many/i.test(message) ? "rate-limit" : "other";
    return directMarketFailure("server-rejected", diagnostics);
  }
  if (typeof envelope.items !== "string") return directMarketFailure("missing-items", diagnostics);
  try {
    const decoded: unknown = JSON.parse(inflateSync(Buffer.from(envelope.items, "base64"), { maxOutputLength: 4 * 1024 * 1024 }).toString("utf8"));
    if (!Array.isArray(decoded)) return directMarketFailure("invalid-items", diagnostics);
    const listings = decoded.flatMap((item): { price: number; unitPrice?: number }[] => {
      if (!item || typeof item !== "object" || typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0) return [];
      const unitPrice = item.unit_price ?? item.unitPrice;
      return typeof unitPrice === "number" && Number.isFinite(unitPrice) && unitPrice >= 0
        ? [{ price: item.price, unitPrice }] : [{ price: item.price }];
    }).sort((left, right) => left.price - right.price).slice(0, 2);
    const totalMatches = typeof envelope.itemCount === "number" && Number.isSafeInteger(envelope.itemCount) && envelope.itemCount >= 0
      ? envelope.itemCount : undefined;
    return { response: { ok: true, result: totalMatches === undefined ? { listings } : { listings, totalMatches } }, diagnostics };
  } catch {
    return directMarketFailure("invalid-items", diagnostics);
  }
}

export function reduceDirectMarketResponse(body: Buffer, statusCode: number | undefined): MarketSearchResponse {
  return inspectDirectMarketResponse(body, statusCode).response;
}

export function classifyDirectMarketNetworkError(code: string | undefined): DirectMarketFailure {
  if (code && /CERT|TLS|SSL/.test(code)) return "tls";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  return "connection";
}
