import type { MarketRegionDirectory } from "./market-region-directory";
import type { MarketReadiness } from "../shared/market-readiness";
import { MarketRecordEvidenceStore, type FrozenMarketRecordEvidence } from "./market-record-evidence";
import {
  extractSessionContextMessages,
  isRegionQualifiedAccount,
  rawAccountId,
  SESSION_CONTEXT_FIELDS,
  type SessionContextField,
  type SessionContextFields,
  type SessionContextMessage,
} from "./session-context-fields";

const TRANSIENT_IDENTITY_TTL_MS = 10 * 60_000;
const MAX_ACCOUNT_SOURCES = 8;

export interface CapturedSessionPayload {
  text: string;
  direction: "inbound" | "outbound";
  remoteAddress: string;
  remotePort: number;
  observedAt?: number;
  localAddress?: string;
  localPort?: number;
}

interface FieldEvidence {
  direction: "inbound" | "outbound";
  remoteAddress: string;
  remotePort: number;
  observedAt: number;
  source: SessionContextMessage["source"];
  localAddress?: string;
  localPort?: number;
  qualification?: MarketContextProvenance["accountQualification"];
}

/** Diagnostic comparisons only; different connections do not prove invalid values. */
export interface MarketContextProvenance {
  fieldSources: Partial<Record<SessionContextField, SessionContextMessage["source"]>>;
  accountQualification: "observed-prefix" | "region-directory" | "unqualified" | "unknown";
  accountPrefixCoherent: boolean | null;
  sameEndpoint: boolean | null;
  sameFlow: boolean | null;
  hardcoreApiObserved: boolean;
  hardcoreSaveObserved: boolean;
  hardcoreSourcesAgree: boolean | null;
}
interface HardcoreEvidence { value: string; account?: string; evidence: FieldEvidence }

export interface CompleteCapturedSessionContext {
  generation: number;
  revision: number;
  updatedAt: number;
  fields: Required<SessionContextFields>;
  endpoint: { address: string; port: number };
  scopeKey: string;
  provenance?: MarketContextProvenance;
  /** Detached diagnostic snapshot set only for an outgoing main-process worker. */
  diagnosticRecords?: FrozenMarketRecordEvidence;
}

export interface SatanicZoneRequestContext {
  generation: number;
  revision: number;
  updatedAt: number;
  uniqueAccountId: string;
  crossregionIdentifier: string;
  beta: string;
  endpoint: { address: string; port: number };
  scopeKey: string;
}

export class CapturedSessionContextStore {
  private fields: SessionContextFields = {};
  private evidence: Partial<Record<SessionContextField, FieldEvidence>> = {};
  private accountSources: CapturedSessionPayload[] = [];
  private processSignature = "";
  private generation = 0;
  private revision = 0;
  private readinessContextVersion = 0;
  private directory: MarketRegionDirectory | null = null;
  private apiHardcore?: HardcoreEvidence;
  private saveHardcore?: HardcoreEvidence;
  private readonly listeners = new Set<() => void>();
  private readonly readinessListeners = new Set<() => void>();
  private readonly records = new MarketRecordEvidenceStore();

  constructor(
    private readonly log: (type: string, data: Record<string, unknown>) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  observeGameProcessIds(values: readonly number[]): void {
    const signature = [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))]
      .sort((left, right) => left - right).join(",");
    if (signature === this.processSignature) return;
    this.processSignature = signature;
    this.generation += 1;
    this.records.clear();
    this.clearContext("game-generation", true);
  }

  observe(payload: CapturedSessionPayload): void {
    if (!this.processSignature || payload.direction !== "outbound") return;
    for (const message of extractSessionContextMessages(payload.text)) {
      this.records.observe(payload, message, this.generation, payload.observedAt ?? this.now());
      this.observeMessage(payload, message);
    }
    this.qualifyCurrentAccount();
    this.notifyReadiness();
  }

  applyRegionDirectory(directory: MarketRegionDirectory): void {
    this.directory = directory;
    this.qualifyCurrentAccount();
    this.notifyReadiness();
  }
  marketRecordSnapshot(): FrozenMarketRecordEvidence { return this.records.freeze(this.generation, this.now()); }
  clearMarketRecordEvidenceForGap(): void { this.records.clear(true); }

  marketReadiness(): MarketReadiness {
    const unique = this.evidence.unique_account_id;
    const crossregion = this.evidence.crossregion_identifier;
    const expiresAt = unique && crossregion
      ? Math.min(unique.observedAt, crossregion.observedAt) + TRANSIENT_IDENTITY_TTL_MS : null;
    const snapshot: MarketReadiness = {
      contextVersion: this.readinessContextVersion,
      phase: "collecting", reason: "missing_fields",
      missingFields: SESSION_CONTEXT_FIELDS.filter((field) => this.fields[field] === undefined),
      sessionCurrent: Boolean(this.processSignature && this.transientEndpoint(this.now())),
      regionQualified: isRegionQualifiedAccount(this.fields.account_id),
      expiresAt, canSearch: false,
    };
    if (!this.processSignature) return { ...snapshot, phase: "waiting", reason: "game_unavailable" };
    if (expiresAt !== null && this.now() > expiresAt) {
      return { ...snapshot, phase: "expired", reason: "identity_expired" };
    }
    if (snapshot.missingFields.length) return snapshot;
    if (!snapshot.sessionCurrent) return { ...snapshot, reason: "endpoint_mismatch" };
    if (!snapshot.regionQualified) {
      return { ...snapshot, phase: "region-required", reason: "region_unprepared", canSearch: true };
    }
    // Use the same final preflight as the working lookup provider.
    return this.marketContext() ? { ...snapshot, phase: "ready", reason: null, canSearch: true } : snapshot;
  }

  subscribeReadiness(listener: () => void): () => void {
    this.readinessListeners.add(listener);
    return () => this.readinessListeners.delete(listener);
  }

  private notifyReadiness(): void {
    for (const listener of this.readinessListeners) listener();
  }


  marketContext(): CompleteCapturedSessionContext | null {
    const currentTime = this.now();
    if (!this.processSignature || !isComplete(this.fields) || !isRegionQualifiedAccount(this.fields.account_id)) return null;
    const endpoint = this.transientEndpoint(currentTime);
    if (!endpoint) return null;
    return {
      generation: this.generation,
      revision: this.revision,
      updatedAt: latestEvidenceTime(this.evidence),
      fields: { ...this.fields },
      endpoint,
      provenance: this.marketProvenance(),
      scopeKey: JSON.stringify([
        this.generation,
        this.fields.account_id,
        this.fields.unique_account_id,
        this.fields.season,
        this.fields.hardcore,
        this.fields.beta,
      ]),
    };
  }

  satanicZoneContext(): SatanicZoneRequestContext | null {
    const currentTime = this.now();
    const uniqueAccountId = this.fields.unique_account_id;
    const crossregionIdentifier = this.fields.crossregion_identifier;
    const beta = this.fields.beta;
    const endpoint = this.transientEndpoint(currentTime);
    if (!this.processSignature || !uniqueAccountId || !crossregionIdentifier || !beta || !endpoint) return null;
    return {
      generation: this.generation,
      revision: this.revision,
      updatedAt: Math.min(
        this.evidence.unique_account_id?.observedAt ?? 0,
        this.evidence.crossregion_identifier?.observedAt ?? 0,
        this.evidence.beta?.observedAt ?? 0,
      ),
      uniqueAccountId,
      crossregionIdentifier,
      beta,
      endpoint,
      scopeKey: JSON.stringify([this.generation, uniqueAccountId, beta]),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.records.clear();
    this.listeners.clear();
    this.readinessListeners.clear();
    this.fields = {};
    this.evidence = {};
    this.accountSources = [];
    this.apiHardcore = this.saveHardcore = undefined;
    this.directory = null;
    this.processSignature = "";
  }

  private transientEndpoint(currentTime: number): { address: string; port: number } | null {
    const unique = this.evidence.unique_account_id;
    const crossregion = this.evidence.crossregion_identifier;
    if (!unique || !crossregion) return null;
    if (currentTime - unique.observedAt > TRANSIENT_IDENTITY_TTL_MS
      || currentTime - crossregion.observedAt > TRANSIENT_IDENTITY_TTL_MS) return null;
    if (unique.remoteAddress !== crossregion.remoteAddress || unique.remotePort !== crossregion.remotePort) return null;
    return { address: crossregion.remoteAddress, port: crossregion.remotePort };
  }

  private qualifyCurrentAccount(): void {
    const account = this.fields.account_id;
    if (!account || isRegionQualifiedAccount(account) || !this.directory) return;
    for (const source of this.accountSources) {
      const region = this.directory.lookup(source.remoteAddress, source.remotePort, this.fields.beta);
      if (!region) continue;
      this.observeMessage(source, { source: "region-directory", fields: { account_id: `${region}-${account}` } });
      return;
    }
  }

  private observeMessage(payload: CapturedSessionPayload, message: SessionContextMessage): void {
    const candidates = { ...message.fields };
    if (!candidates.account_id && !candidates.unique_account_id) return;
    const current = this.fields;
    const accountChanged = candidates.account_id && current.account_id
      && rawAccountId(candidates.account_id) !== rawAccountId(current.account_id);
    const uniqueChanged = candidates.unique_account_id && current.unique_account_id
      && candidates.unique_account_id !== current.unique_account_id;
    if (candidates.account_id && !isRegionQualifiedAccount(candidates.account_id)) {
      const beta = candidates.beta ?? (!accountChanged && !uniqueChanged ? current.beta : undefined);
      const region = this.directory?.lookup(payload.remoteAddress, payload.remotePort, beta);
      if (region) candidates.account_id = `${region}-${candidates.account_id}`;
    }
    const regionChanged = isRegionQualifiedAccount(candidates.account_id) && isRegionQualifiedAccount(current.account_id)
      && candidates.account_id !== current.account_id;
    const reset = Boolean(accountChanged || uniqueChanged || regionChanged);
    if (reset) this.clearContext("identity", true);

    if (message.fields.account_id && message.source !== "region-directory") {
      this.accountSources = [{ ...payload, text: "" }, ...this.accountSources.filter((source) =>
        source.remoteAddress !== payload.remoteAddress || source.remotePort !== payload.remotePort)].slice(0, MAX_ACCOUNT_SOURCES);
    }
    let retainedQualification = false;
    if (!reset && candidates.account_id && current.account_id
      && !isRegionQualifiedAccount(candidates.account_id) && isRegionQualifiedAccount(current.account_id)) {
      candidates.account_id = current.account_id;
      retainedQualification = true;
    }

    const modeFields = ["season", "hardcore", "beta"] as const;
    const modeChanged = modeFields.some((field) => candidates[field] !== undefined && this.fields[field] !== undefined
      && candidates[field] !== this.fields[field]);
    if (modeChanged) {
      if ((candidates.season !== undefined && this.fields.season !== undefined && candidates.season !== this.fields.season)
        || (candidates.beta !== undefined && this.fields.beta !== undefined && candidates.beta !== this.fields.beta)) this.apiHardcore = this.saveHardcore = undefined;
      for (const field of modeFields) {
        delete this.fields[field];
        delete this.evidence[field];
      }
    }

    const observedAt = payload.observedAt ?? this.now();
    const changedFields: SessionContextField[] = [];
    let refreshed = false;
    let endpointChanged = false;
    for (const field of SESSION_CONTEXT_FIELDS) {
      const value = candidates[field];
      if (value === undefined) continue;
      if (this.fields[field] !== value) changedFields.push(field);
      else refreshed = true;
      const previousEvidence = this.evidence[field];
      if ((field === "unique_account_id" || field === "crossregion_identifier") && previousEvidence
        && !sameEndpoint(previousEvidence, payload)) {
        endpointChanged = true;
      }
      this.fields[field] = value;
      this.evidence[field] = {
        direction: payload.direction,
        remoteAddress: payload.remoteAddress,
        remotePort: payload.remotePort,
        observedAt,
        source: message.source === "region-directory" ? previousEvidence?.source ?? message.source : message.source,
        localAddress: payload.localAddress,
        localPort: payload.localPort,
        qualification: field !== "account_id" ? undefined : retainedQualification ? previousEvidence?.qualification
          : isRegionQualifiedAccount(message.fields.account_id) && message.source !== "region-directory" ? "observed-prefix"
          : isRegionQualifiedAccount(value) ? "region-directory" : "unqualified",
      };
    }
    this.observeHardcore(payload, message, observedAt);
    if (!changedFields.length && !reset && !modeChanged && !endpointChanged) {
      if (refreshed) this.log("session-context-refreshed", { generation: this.generation });
      return;
    }
    this.revision += 1;
    // Qualifying the same raw account during the first explicit search is public
    // metadata preparation, not an account/session change for displayed results.
    if (message.source !== "region-directory") this.readinessContextVersion += 1;
    this.log("session-context-changed", {
      generation: this.generation,
      revision: this.revision,
      source: message.source,
      changedFields,
      reset: reset ? "identity" : modeChanged ? "mode" : "none",
      endpointChanged,
      marketReady: this.marketContext() !== null,
      satanicZoneReady: this.satanicZoneContext() !== null,
    });
    for (const listener of this.listeners) listener();
  }

  private clearContext(reason: string, notify: boolean): void {
    this.fields = {};
    this.evidence = {};
    this.accountSources = [];
    this.apiHardcore = this.saveHardcore = undefined;
    this.revision += 1;
    this.readinessContextVersion += 1;
    this.log("session-context-reset", { generation: this.generation, revision: this.revision, reason });
    if (notify) for (const listener of this.listeners) listener();
    this.notifyReadiness();
  }

  marketProvenance(): MarketContextProvenance {
    const endpoint = this.transientEndpoint(this.now());
    const evidence = SESSION_CONTEXT_FIELDS.flatMap(field => this.evidence[field] ? [this.evidence[field]!] : []);
    const knownFlows = evidence.filter(item => item.localAddress && item.localPort !== undefined);
    const account = this.fields.account_id, qualification = this.evidence.account_id?.qualification ?? "unknown";
    const region = endpoint && this.directory?.lookup(endpoint.address, endpoint.port, this.fields.beta);
    const prefix = account?.slice(0, account.lastIndexOf("-"));
    // Native can post fallback 0-; directory metadata cannot contradict an observed native prefix.
    const prefixCoherent = region && isRegionQualifiedAccount(account)
      ? prefix === region ? true : qualification === "region-directory" ? false : null : null;
    const fresh = (item: HardcoreEvidence | undefined) => item && this.now() - item.evidence.observedAt <= TRANSIENT_IDENTITY_TTL_MS ? item : undefined;
    const api = fresh(this.apiHardcore), save = fresh(this.saveHardcore);
    const comparable = api && save && api.account && api.account === save.account
      && account && api.account === rawAccountId(account) && sameFlow(api.evidence, save.evidence) === true;
    return {
      fieldSources: Object.fromEntries(SESSION_CONTEXT_FIELDS.flatMap(field => this.evidence[field] ? [[field, this.evidence[field]!.source]] : [])),
      accountQualification: qualification, accountPrefixCoherent: prefixCoherent,
      sameEndpoint: endpoint ? evidence.every(item => item.remoteAddress === endpoint.address && item.remotePort === endpoint.port) : null,
      sameFlow: knownFlows.length > 1 && knownFlows.some(item => sameFlow(item, knownFlows[0]) === false) ? false
        : evidence.length === SESSION_CONTEXT_FIELDS.length && knownFlows.length === evidence.length ? true : null,
      hardcoreApiObserved: Boolean(api), hardcoreSaveObserved: Boolean(save),
      hardcoreSourcesAgree: comparable ? api.value === save.value : null,
    };
  }
  private observeHardcore(payload: CapturedSessionPayload, message: SessionContextMessage, observedAt: number): void {
    if (message.source === "region-directory") return;
    const nativeAccount = message.fields.account_id ? rawAccountId(message.fields.account_id) : undefined;
    // API mode can precede account-bearing save traffic. Bind only the same full flow.
    if (nativeAccount) for (const prior of [this.apiHardcore, this.saveHardcore]) {
      if (prior && !prior.account && sameFlow(prior.evidence, payload) === true) prior.account = nativeAccount;
    }
    if (message.fields.hardcore === undefined) return;
    const account = message.fields.account_id ? rawAccountId(message.fields.account_id)
      : this.fields.account_id && this.evidence.account_id && sameFlow(payload, this.evidence.account_id) === true ? rawAccountId(this.fields.account_id) : undefined;
    const evidence: FieldEvidence = { remoteAddress: payload.remoteAddress, remotePort: payload.remotePort,
      direction: payload.direction, localAddress: payload.localAddress, localPort: payload.localPort,
      observedAt, source: message.source };
    const observed = { value: message.fields.hardcore, account, evidence };
    if (message.source === "character-save") this.saveHardcore = observed; else this.apiHardcore = observed;
  }
}

function sameEndpoint(left: Pick<CapturedSessionPayload, "remoteAddress" | "remotePort">, right: Pick<CapturedSessionPayload, "remoteAddress" | "remotePort">): boolean {
  return left.remoteAddress === right.remoteAddress && left.remotePort === right.remotePort;
}
function sameFlow(left: Pick<CapturedSessionPayload, "remoteAddress" | "remotePort" | "localAddress" | "localPort">, right: Pick<CapturedSessionPayload, "remoteAddress" | "remotePort" | "localAddress" | "localPort">): boolean | null {
  if (!left.localAddress || !right.localAddress || left.localPort === undefined || right.localPort === undefined) return null;
  return sameEndpoint(left, right) && left.localAddress === right.localAddress && left.localPort === right.localPort;
}

function isComplete(fields: SessionContextFields): fields is Required<SessionContextFields> {
  return SESSION_CONTEXT_FIELDS.every((field) => fields[field] !== undefined);
}

function latestEvidenceTime(evidence: Partial<Record<SessionContextField, FieldEvidence>>): number {
  return Math.max(0, ...Object.values(evidence).map((item) => item?.observedAt ?? 0));
}
