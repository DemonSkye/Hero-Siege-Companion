import https from "node:https";
import { parentPort, workerData } from "node:worker_threads";
import { classifyDirectMarketNetworkError, directMarketFailure, inspectDirectMarketResponse, type DirectMarketWorkerResult } from "./market-direct-response";
export { reduceDirectMarketResponse } from "./market-direct-response";
import type { MarketSearchRequest } from "../shared/market-search";
import { buildMarketFetchItemsChecksum } from "./market-checksum";
import { buildMarketFetchItemsMultipass, MARKET_FETCH_ITEMS_API_SCRIPT } from "./market-multipass";
import type { CompleteCapturedSessionContext } from "./captured-session-context";
import type { SessionContextFields } from "./session-context-fields";
import { buildMarketRequestDiagnostics } from "./market-request-diagnostics";

const MARKET_HOST = "hsmarket.panicartstudios.com";
const MARKET_PATH = "/market/herosiege_api_bootstrap.php";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface DirectMarketWorkerData {
  context: CompleteCapturedSessionContext;
  request: MarketSearchRequest;
}

export function buildDirectMarketRequestBody(context: CompleteCapturedSessionContext, request: MarketSearchRequest): string {
  const form = new URLSearchParams();
  for (const field of [
    "account_id", "unique_account_id", "crossregion_identifier", "season",
    "hardcore", "beta",
  ] as const) form.set(field, context.fields[field]!);
  form.set("checksum", buildMarketFetchItemsChecksum(context.fields as Required<SessionContextFields>));
  form.set("multipass", buildMarketFetchItemsMultipass());
  form.set("api_script", MARKET_FETCH_ITEMS_API_SCRIPT);
  form.set("item_sort", "2");
  form.set("scroll_page", "0");
  form.set("page_id", "99999999");
  form.set("get_highest_id", "1");
  form.set("filter_masks", JSON.stringify([request.itemMask]));
  if (request.minSockets !== undefined) form.set("filter_sockets_min", String(request.minSockets));
  if (request.statFilters.length > 0) {
    const clauses = request.statFilters.map((filter) => ({
      statId: Number(filter.statId),
      filter: 2,
      statValue: Number(filter.minimum),
    }));
    form.set("stat_filter", Buffer.from(JSON.stringify(clauses), "utf8").toString("base64"));
  }
  return form.toString();
}

async function run(data: DirectMarketWorkerData): Promise<DirectMarketWorkerResult> {
  const context = data.context;
  const body = buildDirectMarketRequestBody(context, data.request);
  const requestContext = buildMarketRequestDiagnostics(context, body);
  const snapshot = {
    contextRevision: context.revision,
    contextAgeMs: Math.max(0, Date.now() - context.updatedAt),
    requestContext,
  };
  if (requestContext.season === null || requestContext.hardcore === null || requestContext.beta === null
    || [requestContext.sameEndpoint, requestContext.sameFlow, requestContext.accountPrefixCoherent,
      requestContext.hardcoreSourcesAgree].includes(false)) return directMarketFailure("context-unavailable", snapshot);
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result: DirectMarketWorkerResult) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, diagnostics: { ...result.diagnostics, ...snapshot } });
    };
    let request: ReturnType<typeof https.request>;
    try { request = https.request({
      hostname: MARKET_HOST,
      port: 443,
      path: MARKET_PATH,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
        "accept-encoding": "identity",
      },
      timeout: 15_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const responseFailure = (reason: "response-too-large" | "response-aborted") => {
        finish(directMarketFailure(reason, { httpStatus: response.statusCode, responseBytes: size }));
        request.destroy();
      };
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) responseFailure("response-too-large");
        else chunks.push(chunk);
      });
      response.on("aborted", () => responseFailure("response-aborted"));
      response.on("error", () => responseFailure("response-aborted"));
      response.on("end", () => {
        if (!settled) finish(inspectDirectMarketResponse(Buffer.concat(chunks), response.statusCode));
      });
    }); } catch { finish(directMarketFailure("worker")); return; }
    request.on("timeout", () => {
      finish(directMarketFailure("timeout"));
      request.destroy();
    });
    request.on("error", (error: NodeJS.ErrnoException) => finish(directMarketFailure(classifyDirectMarketNetworkError(error.code))));
    try { request.end(body); } catch { finish(directMarketFailure("worker")); request.destroy(); }
  });
}

const workerPort = parentPort;
if (workerPort) {
  void run(workerData as DirectMarketWorkerData)
    .then((result) => workerPort.postMessage(result))
    .catch(() => workerPort.postMessage(directMarketFailure("worker")));
}
