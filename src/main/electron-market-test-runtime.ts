import { buildDirectMarketRequestBody } from "./market-direct-search-worker";
import { buildMarketRequestDiagnostics } from "./market-request-diagnostics";
import { directMarketFailure, inspectDirectMarketResponse } from "./market-direct-response";
import type { DirectMarketWorkerRunner } from "./direct-market-search-provider";
import { isElectronE2eTestMode } from "./electron-test-mode";

/** Opt-in mock transport only. No HTTPS, game access or authentication dispatch. */
export class ElectronMarketTestRuntime {
  private response: { body: Buffer; status: number } | null = null;
  attemptCount = 0;
  private lastFilters: Record<string,string|null> | null = null;
  getLastFilters() { return this.lastFilters ? {...this.lastFilters} : null; }
  static enabled(): boolean { return isElectronE2eTestMode() && process.env.HERO_SIEGE_COMPANION_E2E_MARKET === "1"; }
  setResponse(status: number, body: number[]): void {
    this.response = body.length <= 4 * 1024 * 1024 ? { body: Buffer.from(body), status } : null;
  }
  readonly run: DirectMarketWorkerRunner = async (context, request) => {
    this.attemptCount++;
    const body = buildDirectMarketRequestBody(context, request);
    const form = new URLSearchParams(body);
    this.lastFilters = Object.fromEntries(["filter_masks","filter_runeword","filter_sockets_min","stat_filter"].map(field=>[field,form.get(field)]));
    const result = this.response ? inspectDirectMarketResponse(this.response.body, this.response.status) : directMarketFailure("worker");
    return { ...result, diagnostics: { ...result.diagnostics, contextRevision: context.revision,
      contextAgeMs: Math.max(0, Date.now() - context.updatedAt), requestContext: buildMarketRequestDiagnostics(context, body) } };
  };
}
