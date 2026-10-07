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
  onDiagnostic?: (stage: "load" | "unlock" | "lock" | "save_admission" | "save_write", result: SatanicZoneLoginCacheState["status"] | "accepted" | "rejected") => void;
}
/** Restored credentials require fresh account/mode evidence, not old socket identity. */
export class SatanicZoneLoginCache {
  private enabled = false;
  private status: SatanicZoneLoginCacheState["status"] = "disabled";
  private bodies: LoginCacheBodies | null = null;
  private validated: SatanicZoneSessionScope | null = null;
  private epoch = 0;
  private unlockEpoch = 0;
  private unlocking = false;
  private disposed = false;
  private checking = false;
  private budget!: SatanicZoneDiagnosticBufferBudget;
  constructor(private readonly options: CacheOptions) {}
  attachBudget(budget: SatanicZoneDiagnosticBufferBudget): void { this.dropRam(); this.budget = budget; }
  snapshot(): SatanicZoneLoginCacheState { return { enabled: this.enabled, unlocked: this.options.store.isUnlocked(), status: this.status }; }
  get holdsSecrets(): boolean { return Boolean(this.bodies); }
  configure(enabled: boolean): void {
    this.enabled = enabled; this.lock();
    this.options.onDiagnostic?.("load", this.status);
  }
  async unlock(passphrase: string): Promise<boolean> {
    if (!this.enabled || this.disposed || this.unlocking) return false;
    this.unlocking = true;
    try {
      this.dropRam(); const epoch = ++this.unlockEpoch;
      this.status = "unlocking"; this.publish();
      try {
        const bodies = await this.options.store.unlock(passphrase, this.budget);
        if (epoch !== this.unlockEpoch || this.disposed || !this.enabled) {
          if (bodies) { this.budget.release(bodies.connectBody); this.budget.release(bodies.postLoginBody); }
          this.options.store.lock(); return false;
        }
        this.bodies = bodies; this.status = bodies ? "unverified" : "empty";
      } catch (error) {
        if (epoch !== this.unlockEpoch || this.disposed) return false;
        this.status = error instanceof Error && error.message === "cancelled" ? "locked" : fixedError(error);
      }
      this.options.onDiagnostic?.("unlock", this.status); this.publish();
      return this.options.store.isUnlocked();
    } finally { this.unlocking = false; }
  }
  lock(): void {
    this.unlockEpoch++;
    this.dropRam(); this.options.store.lock(); this.status = this.enabled ? "locked" : "disabled";
    this.options.onDiagnostic?.("lock", this.status); this.publish();
  }
  clear(): void {
    this.unlockEpoch++;
    this.dropRam(); this.status = this.options.store.forget() ? this.enabled ? "locked" : "disabled" : "clear_failed";
    this.publish();
  }
  suspend(): void { this.epoch++; this.validated = null; if (this.bodies) this.status = "unverified"; this.publish(); }
  dispose(): void { this.disposed = true; this.unlockEpoch++; this.dropRam(); this.options.store.lock(); }
  private dropRam(): void {
    this.epoch++; this.validated = null;
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
    if (!this.bodies || !this.enabled || this.disposed || payload.direction !== "outbound"
      || !payload.localAddress || !payload.localPort || ![6668, 6669].includes(payload.remotePort)) return;
    if (!this.options.store.isUnlocked()) { this.lock(); return; }
    const messages = extractSessionContextMessages(payload.text);
    const identity = connectProbeIdentity(this.bodies.connectBody)!;
    const account = new URLSearchParams(this.bodies.postLoginBody.subarray(
      this.bodies.postLoginBody.indexOf(0, 4) + 3, -1).toString("utf8")).get("account_id")!;
    // Any observed contrary identity invalidates even when the packet lacks the full pair.
    if (messages.some(({ fields }) => (fields.unique_account_id && fields.unique_account_id !== identity.uniqueAccountId)
      || (fields.beta !== undefined && fields.beta !== identity.beta)
      || (fields.account_id && rawAccountId(fields.account_id) !== rawAccountId(account)))) {
      this.clear(); if (this.status !== "clear_failed") this.status = "identity_mismatch"; this.publish(); return;
    }
    if (!messages.some(({ fields }) => fields.unique_account_id === identity.uniqueAccountId && fields.beta === identity.beta)
      || this.checking) return;
    const epoch = this.epoch, bodies = this.bodies; this.checking = true;
    try {
      const network = await this.options.networkState();
      const flows = network.connections.filter(flow => network.gameProcessIds.includes(flow.owningProcess)
        && flow.localAddress === payload.localAddress && flow.localPort === payload.localPort
        && flow.remoteAddress === payload.remoteAddress && flow.remotePort === payload.remotePort
        && ["established", "5"].includes(String(flow.state).toLowerCase()));
      if (flows.length !== 1) return;
      if (epoch !== this.epoch || bodies !== this.bodies || this.disposed) return;
      const flow = flows[0], current = this.validated;
      // Identical evidence must not invalidate an in-flight pre/postflight token.
      if (!current || current.pid !== flow.owningProcess || current.localAddress !== flow.localAddress
        || current.localPort !== flow.localPort || current.remoteAddress !== flow.remoteAddress || current.remotePort !== flow.remotePort) {
        this.validated = { localAddress: flow.localAddress, localPort: flow.localPort,
          remoteAddress: flow.remoteAddress, remotePort: flow.remotePort, pid: flow.owningProcess };
      }
      this.status = "validated";
    } catch { if (epoch === this.epoch) this.status = "unverified"; }
    finally { this.checking = false; this.publish(); }
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
    if (this.validated && !ids.includes(this.validated.pid)) this.suspend();
  }
  observeConnections(flows: readonly CaptureConnection[]): void {
    if (this.validated && satanicZoneSessionScopeStatus(this.validated, flows) === "changed") this.suspend();
  }
  observeLifecycle(packet: CapturedTcpLifecycle): void {
    if (this.validated && satanicZoneSessionTerminated(this.validated, packet)) this.suspend();
  }
  private publish(): void { if (!this.disposed) this.options.onChange(this.snapshot()); }
}
function fixedError(error: unknown): SatanicZoneLoginCacheState["status"] {
  return error instanceof Error && error.message === "unlock_failed" ? "unlock_failed" : "storage_error";
}
