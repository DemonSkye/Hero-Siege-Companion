import type { CompleteCapturedSessionContext, MarketContextProvenance } from "./captured-session-context";
import { SESSION_CONTEXT_FIELDS, validSessionContextField } from "./session-context-fields";
import { compareMarketRecords, type MarketRecordComparison } from "./market-record-evidence";

export interface MarketRequestDiagnostics extends MarketContextProvenance {
  generation: number;
  season: string | null;
  hardcore: "0" | "1" | null;
  beta: "0" | "1" | null;
  recordComparison?: MarketRecordComparison;
}
const SOURCES = ["mailbox", "market", "game-api", "json", "character-save", "region-directory"] as const;
const QUALIFICATIONS = ["observed-prefix", "region-directory", "unqualified", "unknown"] as const;
const agreement = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;

/** Allowlist actual FINAL form flags, never identifiers/body/checksum/endpoint. */
export function buildMarketRequestDiagnostics(context: CompleteCapturedSessionContext, body: string): MarketRequestDiagnostics {
  const form = new URLSearchParams(body), proof = context.provenance;
  const season = form.get("season"), hardcore = form.get("hardcore"), beta = form.get("beta");
  const recordComparison = compareMarketRecords(context, body);
  return {
    generation: Number.isSafeInteger(context.generation) && context.generation >= 0 ? context.generation : 0,
    season: validSessionContextField("season", season) ? season : null,
    hardcore: hardcore === "0" || hardcore === "1" ? hardcore : null,
    beta: beta === "0" || beta === "1" ? beta : null,
    ...(recordComparison ? { recordComparison } : {}),
    fieldSources: Object.fromEntries(SESSION_CONTEXT_FIELDS.flatMap(field => {
      const source = proof?.fieldSources?.[field];
      return source && SOURCES.includes(source) ? [[field, source]] : [];
    })),
    accountQualification: proof && QUALIFICATIONS.includes(proof.accountQualification) ? proof.accountQualification : "unknown",
    accountPrefixCoherent: agreement(proof?.accountPrefixCoherent),
    sameEndpoint: agreement(proof?.sameEndpoint), sameFlow: agreement(proof?.sameFlow),
    hardcoreApiObserved: proof?.hardcoreApiObserved === true,
    hardcoreSaveObserved: proof?.hardcoreSaveObserved === true,
    hardcoreSourcesAgree: agreement(proof?.hardcoreSourcesAgree),
  };
}
