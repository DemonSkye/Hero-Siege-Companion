import type { CapturedSessionPayload, CompleteCapturedSessionContext } from "./captured-session-context";
import { isRegionQualifiedAccount, rawAccountId, SESSION_CONTEXT_FIELDS, validSessionContextField,
  NATIVE_PLAYER_SALES_METHOD, type NativeMarketDigestEvidence, type SessionContextFields, type SessionContextMessage } from "./session-context-fields";

const MAX_RECORDS = 8;
type Agreement = boolean | null;
type Fields<T> = Record<typeof SESSION_CONTEXT_FIELDS[number], T>;
interface RecordEvidence {
  fields: SessionContextFields;
  source: SessionContextMessage["source"];
  slot?: string;
  generation: number;
  observedAt: number;
  ordinal: number;
  flow: Pick<CapturedSessionPayload, "remoteAddress" | "remotePort" | "localAddress" | "localPort">;
  nativeMarket?: NativeMarketDigestEvidence;
}
/** Main-process RAM only, including the worker thread. Never renderer IPC or logs. */
export interface FrozenMarketRecordEvidence {
  generation: number;
  frozenAt: number;
  api: RecordEvidence[];
  saves: RecordEvidence[];
  evicted: boolean;
  clearedForObservationGap: boolean;
}
interface ComparedRecord {
  source: SessionContextMessage["source"] | "unknown";
  available: Fields<boolean>;
  equalToRequest: Fields<Agreement>;
  observedPrefixEqual: Agreement;
  slotObserved: boolean;
  sameGeneration: boolean;
  sameEndpoint: boolean;
  observedBeforeDispatch: boolean;
  nativeDigest: { route: typeof NATIVE_PLAYER_SALES_METHOD | null; nativeDigestAvailable: boolean };
}
export interface MarketRecordComparison {
  evidenceAvailable: boolean;
  recordsEvicted: boolean;
  clearedForObservationGap: boolean;
  formUnambiguous: boolean;
  formValid: Fields<boolean>;
  contextEqualsForm: Fields<Agreement>;
  api: ComparedRecord[];
  saves: ComparedRecord[];
  /** Matrix rows follow api; columns follow saves. No raw record IDs or slots. */
  apiSave: { rawAccountEqual: Agreement; observedSlotEqual: Agreement;
    modeEqual: Record<"season" | "hardcore" | "beta", Agreement>; sameFlow: Agreement; sameEndpoint: boolean;
    apiObservedFirst: boolean }[][];
  /** Observed slots and generic API records do not establish native selected-slot authority. */
  selectedNativeSlotEstablished: false;
  nativeMarketDigestObserved: boolean;
  nativeFetchDigestObserved: false;
  authoritativeLoginBoundaryObserved: false;
}

/** Separate records, no field backfill, account immutability rule or readiness effect. */
export class MarketRecordEvidenceStore {
  private api: RecordEvidence[] = [];
  private saves: RecordEvidence[] = [];
  private ordinal = 0;
  private evicted = false;
  private clearedForObservationGap = false;
  observe(payload: CapturedSessionPayload, message: SessionContextMessage, generation: number, observedAt: number): void {
    if (message.source === "region-directory" || !SESSION_CONTEXT_FIELDS.some(field => message.fields[field] !== undefined)) return;
    const records = message.source === "character-save" ? this.saves : this.api;
    const fields = Object.fromEntries(SESSION_CONTEXT_FIELDS.flatMap(field =>
      validSessionContextField(field, message.fields[field]) ? [[field, message.fields[field]]] : []));
    records.push({ fields, source: message.source, ...(message.slot ? { slot: message.slot } : {}),
      generation, observedAt, ordinal: ++this.ordinal, flow: { remoteAddress: payload.remoteAddress, remotePort: payload.remotePort,
        localAddress: payload.localAddress, localPort: payload.localPort },
      ...(message.nativeMarket?.method === NATIVE_PLAYER_SALES_METHOD ? { nativeMarket: { method: NATIVE_PLAYER_SALES_METHOD,
        ...(message.nativeMarket.checksum && /^[a-f0-9]{64}$/i.test(message.nativeMarket.checksum) ? { checksum: message.nativeMarket.checksum } : {}) } } : {}) });
    if (records.length > MAX_RECORDS) { records.shift(); this.evicted = true; }
  }
  clear(observationGap = false): void {
    this.api = []; this.saves = []; this.ordinal = 0; this.evicted = false; this.clearedForObservationGap = observationGap;
  }
  freeze(generation: number, frozenAt: number): FrozenMarketRecordEvidence {
    const copy = (records: RecordEvidence[]) => records.map(record => ({ ...record, fields: { ...record.fields }, flow: { ...record.flow },
      ...(record.nativeMarket ? { nativeMarket: { ...record.nativeMarket } } : {}) }));
    return { generation, frozenAt, api: copy(this.api), saves: copy(this.saves), evicted: this.evicted,
      clearedForObservationGap: this.clearedForObservationGap };
  }
}

const SOURCES: SessionContextMessage["source"][] = ["mailbox", "market", "game-api", "json", "character-save"];
const equal = (left: string | undefined, right: string | undefined): Agreement => left === undefined || right === undefined ? null : left === right;
const rawEqual = (left: string | undefined, right: string | undefined): Agreement => left === undefined || right === undefined ? null : rawAccountId(left) === rawAccountId(right);
function fieldMap<T>(pick: (field: typeof SESSION_CONTEXT_FIELDS[number]) => T): Fields<T> {
  return Object.fromEntries(SESSION_CONTEXT_FIELDS.map(field => [field, pick(field)])) as Fields<T>;
}
function sameEndpoint(left: RecordEvidence["flow"], right: RecordEvidence["flow"]): boolean {
  return left.remoteAddress === right.remoteAddress && left.remotePort === right.remotePort;
}
function sameFlow(left: RecordEvidence["flow"], right: RecordEvidence["flow"]): Agreement {
  if (!left.localAddress || !right.localAddress || left.localPort === undefined || right.localPort === undefined) return null;
  return sameEndpoint(left, right) && left.localAddress === right.localAddress && left.localPort === right.localPort;
}
/** Only fixed booleans/nulls and category enums leave the evidence owner. */
export function compareMarketRecords(context: CompleteCapturedSessionContext, body: string): MarketRecordComparison | undefined {
  const snapshot = context.diagnosticRecords;
  if (!snapshot) return undefined;
  const params = new URLSearchParams(body);
  const formUnambiguous = SESSION_CONTEXT_FIELDS.every(field => params.getAll(field).length === 1);
  const formValid = fieldMap(field => params.getAll(field).length === 1 && validSessionContextField(field, params.get(field)));
  const form: SessionContextFields = Object.fromEntries(SESSION_CONTEXT_FIELDS.flatMap(field => formValid[field] ? [[field, params.get(field)!]] : []));
  const api = snapshot.api.slice(0, MAX_RECORDS), saves = snapshot.saves.slice(0, MAX_RECORDS);
  const compare = (record: RecordEvidence): ComparedRecord => ({
    source: SOURCES.includes(record.source) ? record.source : "unknown",
    available: fieldMap(field => record.fields[field] !== undefined),
    equalToRequest: fieldMap(field => field === "account_id" ? rawEqual(record.fields[field], form[field]) : equal(record.fields[field], form[field])),
    observedPrefixEqual: isRegionQualifiedAccount(record.fields.account_id) && isRegionQualifiedAccount(form.account_id)
      ? record.fields.account_id!.slice(0, record.fields.account_id!.lastIndexOf("-")) === form.account_id!.slice(0, form.account_id!.lastIndexOf("-")) : null,
    slotObserved: record.slot !== undefined,
    sameGeneration: record.generation === context.generation,
    sameEndpoint: record.flow.remoteAddress === context.endpoint.address && record.flow.remotePort === context.endpoint.port,
    observedBeforeDispatch: record.observedAt <= snapshot.frozenAt,
    nativeDigest: { route: record.nativeMarket?.method === NATIVE_PLAYER_SALES_METHOD ? NATIVE_PLAYER_SALES_METHOD : null,
      nativeDigestAvailable: record.nativeMarket?.method === NATIVE_PLAYER_SALES_METHOD && /^[a-f0-9]{64}$/i.test(record.nativeMarket.checksum ?? "") },
  });
  return { evidenceAvailable: api.length + saves.length > 0, recordsEvicted: snapshot.evicted === true,
    clearedForObservationGap: snapshot.clearedForObservationGap === true, formUnambiguous, formValid,
    contextEqualsForm: fieldMap(field => equal(context.fields[field], form[field])),
    api: api.map(compare), saves: saves.map(compare),
    apiSave: api.map(record => saves.map(saved => ({
      rawAccountEqual: rawEqual(record.fields.account_id, saved.fields.account_id), observedSlotEqual: equal(record.slot, saved.slot),
      modeEqual: { season: equal(record.fields.season, saved.fields.season), hardcore: equal(record.fields.hardcore, saved.fields.hardcore), beta: equal(record.fields.beta, saved.fields.beta) },
      sameFlow: sameFlow(record.flow, saved.flow), sameEndpoint: sameEndpoint(record.flow, saved.flow), apiObservedFirst: record.ordinal < saved.ordinal }))),
    selectedNativeSlotEstablished: false, nativeMarketDigestObserved: api.some(record => record.nativeMarket?.method === NATIVE_PLAYER_SALES_METHOD && /^[a-f0-9]{64}$/i.test(record.nativeMarket.checksum ?? "")),
    nativeFetchDigestObserved: false, authoritativeLoginBoundaryObserved: false };
}
