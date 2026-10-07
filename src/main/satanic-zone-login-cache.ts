import type { SatanicZoneLoginCacheState } from "../shared/satanic-zone-login-cache";
import type { CapturedSessionPayload } from "./captured-session-context";
import type { HeroSiegeNetworkState } from "./capture-network";
import type { CaptureConnection } from "../shared/app-state";
import type { CapturedTcpLifecycle } from "./packet-decoder";
import type { InitializedProbeInput } from "./satanic-zone-initialized-transport";
import { connectProbeIdentity, coherentProbePostLogin } from "./satanic-zone-initialized-protocol";
import { extractSessionContextMessages, rawAccountId } from "./session-context-fields";
import { satanicZoneSessionScopeStatus, satanicZoneSessionTerminated, type SatanicZoneSessionScope } from "./satanic-zone-session-scope";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import { SatanicZoneLoginCacheStore, type LoginCacheBodies } from "./satanic-zone-login-cache-store";

interface CacheOptions {
  store: SatanicZoneLoginCacheStore;
  networkState: () => Promise<HeroSiegeNetworkState>;
  onChange: (state: SatanicZoneLoginCacheState) => void;
  onDiagnostic?: (stage: "load" | "unlock" | "lock" | "save_admission" | "save_write" | "identity_binding", result: SatanicZoneLoginCacheState["status"] | "accepted" | "rejected" | "waiting_identity" | "flow_unavailable" | "evidence_expired" | "suspended") => void;
}
interface IdentityEvidence {
  uid: string; beta: string; observedAt: number; scope: SatanicZoneSessionScope;
  /** Topology hint while the ownership query is pending; never readiness proof. */
  pendingPid?: number;
}
interface AccountEvidence { account: string; scope: SatanicZoneSessionScope }
const IDENTITY_TTL_MS = 10 * 60_000;
/** Restored credentials require fresh account/mode evidence, not old socket identity. */
export class SatanicZoneLoginCache {
  private enabled = false;
  private automatic = false;
  private status: SatanicZoneLoginCacheState["status"] = "disabled";
  private bodies: LoginCacheBodies | null = null;
  private validated: SatanicZoneSessionScope | null = null;
  private epoch = 0;
  private unlockEpoch = 0;
  private unlocking = false;
  private disposed = false;
  private evidence: IdentityEvidence | null = null;
  private accountEvidence: AccountEvidence | null = null;
  private releaseEvidence: (() => void) | null = null;
  private evidenceRevision = 0;
  private binding: Promise<void> | null = null;
  private bindAgain = false;
  private processSignature: string | null = null;
  private budget!: SatanicZoneDiagnosticBufferBudget;
  constructor(private readonly options: CacheOptions) {}
  attachBudget(budget: SatanicZoneDiagnosticBufferBudget): void { this.dropRam(); this.budget = budget; }
  snapshot(): SatanicZoneLoginCacheState { return { enabled: this.enabled, unlocked: this.options.store.isUnlocked(), status: this.status,
    ...(this.automatic ? { automatic: true } : {}) }; }
  get holdsSecrets(): boolean { return Boolean(this.bodies); }
  configure(enabled: boolean, automatic = false): void {
    this.enabled = enabled; this.automatic = enabled && automatic; this.lock();
    if (!enabled && !this.options.store.forgetUnlockingKey()) this.status = "clear_failed";
    if (this.automatic && !this.disposed) {
      try { this.bodies = this.options.store.unlockAutomatic(this.budget); this.status = this.bodies ? "unverified" : "empty"; }
      catch (error) { this.status = fixedError(error); }
    }
    this.publish();
    this.options.onDiagnostic?.("load", this.status);
  }
  async unlock(passphrase: string): Promise<boolean> {
    if (!this.enabled || this.disposed || this.unlocking) return false;
    this.unlocking = true;
    try {
      this.dropRam(true); const epoch = ++this.unlockEpoch;
      this.status = "unlocking"; this.publish();
      try {
        const bodies = await this.options.store.unlock(passphrase, this.budget);
        if (epoch !== this.unlockEpoch || this.disposed || !this.enabled) {
          if (bodies) { this.budget.release(bodies.connectBody); this.budget.release(bodies.postLoginBody); }
          this.options.store.lock(); return false;
        }
        this.bodies = bodies; this.status = bodies ? "unverified" : "empty";
        if (this.automatic) this.options.store.retainUnlockingKey(this.budget);
        await this.bindEvidence();
      } catch (error) {
        if (epoch !== this.unlockEpoch || this.disposed) return false;
        this.status = error instanceof Error && error.message === "cancelled" ? "locked" : fixedError(error);
      }
      this.options.onDiagnostic?.("unlock", this.status); this.publish();
      return this.options.store.isUnlocked();
    } finally { this.unlocking = false; }
  }
  async enableAutomatic(passphrase: string): Promise<boolean> {
    if (!await this.unlock(passphrase)) return false;
    try {
      this.options.store.retainUnlockingKey(this.budget); this.automatic = true; this.publish(); return true;
    } catch { this.status = "storage_error"; this.publish(); return false; }
  }
  disableAutomatic(): void {
    this.automatic = false;
    this.status = this.options.store.forgetUnlockingKey() ? "storage_error" : "clear_failed";
    this.publish();
  }
  lock(): void {
    this.unlockEpoch++;
    this.dropRam(); this.options.store.lock(); this.status = this.enabled ? "locked" : "disabled";
    this.options.onDiagnostic?.("lock", this.status); this.publish();
  }
  clear(): void {
    this.unlockEpoch++;
    this.automatic = false;
    this.dropRam(); this.status = this.options.store.forget() ? this.enabled ? "locked" : "disabled" : "clear_failed";
    this.publish();
  }
  suspend(): void { this.epoch++; this.clearEvidence(); this.validated = null; if (this.bodies) this.status = "unverified";
    this.options.onDiagnostic?.("identity_binding", "suspended"); this.publish(); }
  dispose(): void { this.disposed = true; this.unlockEpoch++; this.dropRam(); this.options.store.lock(); }
  private dropRam(preserveEvidence = false): void {
    this.epoch++; this.validated = null;
    if (!preserveEvidence) this.clearEvidence();
    if (this.bodies) { this.budget.release(this.bodies.connectBody); this.budget.release(this.bodies.postLoginBody); }
    this.bodies = null;
  }
  /** Local serialization only; no executable query or authentication transmission. */
  async remember(input: InitializedProbeInput, _pid: number): Promise<void> {
    if (!this.enabled || this.disposed || !this.options.store.isUnlocked()) return;
    const budget = this.budget;
    let copy: LoginCacheBodies | null = null;
    let stage: "save_admission" | "save_write" = "save_admission";
    try {
      const identity = connectProbeIdentity(input.connectBody);
      if (!identity || !coherentProbePostLogin(input.postLoginBody, identity)) { this.options.onDiagnostic?.("save_admission", "rejected"); return; }
      const connectBody = budget.copy(input.connectBody);
      try { copy = { connectBody, postLoginBody: budget.copy(input.postLoginBody) }; }
      catch { budget.release(connectBody); throw new Error(); }
      this.options.onDiagnostic?.("save_admission", "accepted");
      stage = "save_write"; this.options.store.save(copy, budget);
      this.dropRam(); this.bodies = copy; copy = null; this.status = "saved";
      this.options.onDiagnostic?.("save_write", "saved");
    } catch { this.status = "storage_error"; this.options.onDiagnostic?.(stage, this.status); }
    finally {
      if (copy) { budget.release(copy.connectBody); budget.release(copy.postLoginBody); }
      this.publish();
    }
  }
  async observe(payload: CapturedSessionPayload): Promise<void> {
    if (!this.enabled || this.disposed || payload.direction !== "outbound"
      || !payload.localAddress || !payload.localPort || payload.localAddress.length > 64 || payload.remoteAddress.length > 64
      || ![6668, 6669].includes(payload.remotePort)) return;
    const messages = extractSessionContextMessages(payload.text);
    const identity = this.bodies ? connectProbeIdentity(this.bodies.connectBody)! : null;
    const account = this.bodies ? new URLSearchParams(this.bodies.postLoginBody.subarray(
      this.bodies.postLoginBody.indexOf(0, 4) + 3, -1).toString("utf8")).get("account_id")! : null;
    if (identity && messages.some(({ fields }) => (fields.unique_account_id && fields.unique_account_id !== identity.uniqueAccountId)
      || (fields.beta !== undefined && fields.beta !== identity.beta)
      || (fields.account_id && rawAccountId(fields.account_id) !== rawAccountId(account!)))) {
      this.clear(); if (this.status !== "clear_failed") this.status = "identity_mismatch"; this.publish(); return;
    }
    const fields = messages.map(message => message.fields);
    const pair = fields.find(field => field.unique_account_id && field.beta !== undefined);
    const observedAccount = fields.find(field => field.account_id)?.account_id;
    if (!pair && !observedAccount && !fields.some(field => field.unique_account_id || field.beta !== undefined)) return;
    // Store parsed bounded metadata, never the payload or authentication bodies.
    // Partial identity cannot be combined to manufacture a coherent pair.
    if (this.evidence && fields.some(field => (field.unique_account_id && field.unique_account_id !== this.evidence!.uid)
      || (field.beta !== undefined && field.beta !== this.evidence!.beta))) this.clearEvidence();
    const scope = { localAddress: payload.localAddress, localPort: payload.localPort,
      remoteAddress: payload.remoteAddress, remotePort: payload.remotePort, pid: 0 };
    if (pair) this.evidence = { uid: pair.unique_account_id!, beta: pair.beta!, observedAt: payload.observedAt ?? Date.now(), scope };
    if (observedAccount) this.accountEvidence = { account: rawAccountId(observedAccount), scope };
    this.evidenceRevision++; this.releaseEvidence?.(); this.releaseEvidence = null;
    if (!this.evidence && !this.accountEvidence) return;
    try { this.releaseEvidence = this.budget.reserve(256 + Buffer.byteLength(this.evidence?.uid ?? "") + Buffer.byteLength(this.accountEvidence?.account ?? "")); }
    catch { this.clearEvidence(); return; }
    return this.bindEvidence();
  }
  private bindEvidence(): Promise<void> {
    this.bindAgain = true;
    if (this.binding) return this.binding;
    // One read-only ownership query at a time; bursts retain only the latest
    // bounded metadata and request one follow-up, never a payload/promise queue.
    const pending = (async () => {
      do { this.bindAgain = false; await this.checkEvidence(); }
      while (this.bindAgain && this.enabled && !this.disposed);
    })();
    this.binding = pending;
    const clear = () => { if (this.binding === pending) this.binding = null; };
    void pending.then(clear, clear);
    return pending;
  }
  private async checkEvidence(): Promise<void> {
    const evidence = this.evidence, accountEvidence = this.accountEvidence;
    if (!evidence) { if (this.bodies) this.options.onDiagnostic?.("identity_binding", "waiting_identity"); return; }
    // Only pre-load evidence ages out. A validated Ready context has no timer.
    if (!this.validated && (Date.now() - evidence.observedAt > IDENTITY_TTL_MS || evidence.observedAt > Date.now() + 1000)) {
      this.clearEvidence(); this.options.onDiagnostic?.("identity_binding", "evidence_expired"); return;
    }
    const epoch = this.epoch, revision = this.evidenceRevision, bodies = this.bodies;
    try {
      const network = await this.options.networkState();
      if (epoch !== this.epoch || revision !== this.evidenceRevision || this.disposed || !this.enabled || bodies !== this.bodies) return;
      const owned = (scope: SatanicZoneSessionScope) => network.connections.filter(flow => network.gameProcessIds.includes(flow.owningProcess)
        && flow.localAddress === scope.localAddress && flow.localPort === scope.localPort
        && flow.remoteAddress === scope.remoteAddress && flow.remotePort === scope.remotePort
        && (scope.pid === 0 || scope.pid === flow.owningProcess) && ["established", "5"].includes(String(flow.state).toLowerCase()));
      const flows = owned(evidence.scope);
      if (flows.length !== 1 || (evidence.pendingPid !== undefined && flows[0].owningProcess !== evidence.pendingPid)) {
        this.clearEvidence(); this.options.onDiagnostic?.("identity_binding", "flow_unavailable"); return;
      }
      const flow = flows[0]; evidence.scope.pid = flow.owningProcess;
      if (accountEvidence && (owned(accountEvidence.scope).length !== 1
        || owned(accountEvidence.scope)[0].owningProcess !== flow.owningProcess)) { this.clearEvidence(); return; }
      if (accountEvidence) accountEvidence.scope.pid = owned(accountEvidence.scope)[0].owningProcess;
      if (!bodies || !this.options.store.isUnlocked()) return;
      const identity = connectProbeIdentity(bodies.connectBody)!;
      const account = new URLSearchParams(bodies.postLoginBody.subarray(bodies.postLoginBody.indexOf(0, 4) + 3, -1).toString("utf8")).get("account_id")!;
      if (evidence.uid !== identity.uniqueAccountId || evidence.beta !== identity.beta
        || (accountEvidence && accountEvidence.account !== rawAccountId(account))) {
        this.clear(); if (this.status !== "clear_failed") this.status = "identity_mismatch"; this.publish(); return;
      }
      const current = this.validated;
      // Identical evidence must not invalidate an in-flight pre/postflight token.
      if (!current || current.pid !== flow.owningProcess || current.localAddress !== flow.localAddress
        || current.localPort !== flow.localPort || current.remoteAddress !== flow.remoteAddress || current.remotePort !== flow.remotePort) {
        this.validated = { localAddress: flow.localAddress, localPort: flow.localPort,
          remoteAddress: flow.remoteAddress, remotePort: flow.remotePort, pid: flow.owningProcess };
      }
      this.status = "validated";
      this.options.onDiagnostic?.("identity_binding", "validated");
    } catch { if (epoch === this.epoch && bodies) this.status = "unverified"; }
    finally { this.publish(); }
  }
  restoreInput(): (InitializedProbeInput & { pid: number }) | null {
    if (!this.enabled || !this.bodies || !this.validated) return null;
    return { ...this.bodies, identity: connectProbeIdentity(this.bodies.connectBody)!, scope: this.validated,
      nativePort: this.validated.localPort, pid: this.validated.pid };
  }
  async preflight(scope: SatanicZoneSessionScope): Promise<boolean> {
    if (!this.options.store.isUnlocked()) { this.lock(); return false; }
    const epoch = this.epoch, current = this.validated, bodies = this.bodies;
    if (!current || !bodies || current.pid !== scope.pid || current.localAddress !== scope.localAddress
      || current.localPort !== scope.localPort || current.remoteAddress !== scope.remoteAddress || current.remotePort !== scope.remotePort) return false;
    try {
      const network = await this.options.networkState();
      const valid = epoch === this.epoch && this.enabled && !this.disposed && this.validated === current
        && this.bodies === bodies && this.options.store.isUnlocked() && network.gameProcessIds.includes(scope.pid)
        && satanicZoneSessionScopeStatus(scope, network.connections) === "current";
      if (!valid && epoch === this.epoch) this.suspend();
      return valid;
    } catch { if (epoch === this.epoch) this.suspend(); return false; }
  }
  observeProcesses(ids: readonly number[]): void {
    const signature = [...new Set(ids)].sort((a, b) => a - b).join(",");
    if (this.processSignature !== signature) { this.processSignature = signature; this.suspend(); }
  }
  observeConnections(flows: readonly CaptureConnection[]): void {
    const scope = this.validated ?? this.evidence?.scope;
    if (!scope) return;
    if (scope.pid === 0 && this.evidence) {
      const matching = flows.filter(flow => flow.localAddress === scope.localAddress && flow.localPort === scope.localPort
        && flow.remoteAddress === scope.remoteAddress && flow.remotePort === scope.remotePort);
      if (matching.length > 1) { this.suspend(); return; }
      // An unknown PID cannot differ from the first observed owner. Keep that
      // hint separate until the query confirms game ownership; later contrary
      // topology or a stale query result still rejects the evidence.
      if (this.evidence.pendingPid === undefined && matching[0]?.owningProcess > 0) this.evidence.pendingPid = matching[0].owningProcess;
      const pid = this.evidence.pendingPid;
      if (pid !== undefined && satanicZoneSessionScopeStatus({ ...scope, pid }, flows) === "changed") this.suspend();
    } else if (satanicZoneSessionScopeStatus(scope, flows) === "changed") this.suspend();
  }
  observeLifecycle(packet: CapturedTcpLifecycle): void {
    const scope = this.validated ?? this.evidence?.scope;
    if (scope && satanicZoneSessionTerminated(scope, packet)) this.suspend();
  }
  private clearEvidence(): void { this.evidenceRevision++; this.evidence = null; this.accountEvidence = null; this.releaseEvidence?.(); this.releaseEvidence = null; }
  private publish(): void { if (!this.disposed) this.options.onChange(this.snapshot()); }
}
function fixedError(error: unknown): SatanicZoneLoginCacheState["status"] {
  return error instanceof Error && error.message === "unlock_failed" ? "unlock_failed" : "storage_error";
}
