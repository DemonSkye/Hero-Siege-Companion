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
  buildIdentity: (pid: number) => Promise<string | null>;
  onChange: (state: SatanicZoneLoginCacheState) => void;
}
/** Restored credentials require fresh account/mode evidence, not old socket identity. */
export class SatanicZoneLoginCache {
  private enabled = false;
  private status: SatanicZoneLoginCacheState["status"] = "disabled";
  private bodies: LoginCacheBodies | null = null;
  private validated: SatanicZoneSessionScope | null = null;
  private epoch = 0;
  private disposed = false;
  private checking = false;
  private pendingSave: { pid: number; epoch: number } | null = null;
  private budget!: SatanicZoneDiagnosticBufferBudget;
  constructor(private readonly options: CacheOptions) {}
  attachBudget(budget: SatanicZoneDiagnosticBufferBudget): void { this.dropRam(); this.budget = budget; }
  snapshot(): SatanicZoneLoginCacheState { return { enabled: this.enabled, status: this.status }; }
  get holdsSecrets(): boolean { return Boolean(this.bodies); }
  configure(enabled: boolean): void {
    this.enabled = enabled; this.suspend();
    if (!enabled) { this.clear(); return; }
    this.dropRam();
    try {
      this.bodies = this.options.store.load(this.budget);
      this.status = this.bodies ? "unverified" : "empty";
    } catch (error) { this.status = fixedError(error); }
    this.publish();
  }
  clear(): void {
    this.dropRam(); this.status = this.options.store.forget() ? this.enabled ? "empty" : "disabled" : "clear_failed";
    this.publish();
  }
  suspend(): void { this.epoch++; this.validated = null; if (this.bodies) this.status = "unverified"; this.publish(); }
  dispose(): void { this.disposed = true; this.dropRam(); }
  private dropRam(): void {
    this.epoch++; this.validated = null;
    if (this.bodies) { this.budget.release(this.bodies.connectBody); this.budget.release(this.bodies.postLoginBody); }
    this.bodies = null;
  }
  /** Copies synchronously before async build discovery; copies share the product budget. */
  async remember(input: InitializedProbeInput, pid: number): Promise<void> {
    if (!this.enabled || this.disposed) return;
    const save = { pid, epoch: ++this.epoch }, budget = this.budget;
    this.pendingSave = save; this.validated = null;
    const epoch = save.epoch;
    let copy: LoginCacheBodies | null = null;
    try {
      const identity = connectProbeIdentity(input.connectBody);
      if (!identity || !coherentProbePostLogin(input.postLoginBody, identity)) return;
      const connectBody = budget.copy(input.connectBody);
      try { copy = { connectBody, postLoginBody: budget.copy(input.postLoginBody), build: "" }; }
      catch { budget.release(connectBody); throw new Error(); }
      const build = await this.options.buildIdentity(pid);
      if (epoch !== this.epoch || this.disposed || !this.enabled) return;
      if (!build) { this.status = "build_unavailable"; return; }
      copy.build = build; this.options.store.save(copy, budget);
      this.dropRam(); this.bodies = copy; copy = null; this.status = "saved";
    } catch (error) { if (epoch === this.epoch) this.status = fixedError(error); }
    finally {
      if (copy) { budget.release(copy.connectBody); budget.release(copy.postLoginBody); }
      if (this.pendingSave === save) this.pendingSave = null;
      this.publish();
    }
  }
  async observe(payload: CapturedSessionPayload): Promise<void> {
    if (!this.bodies || !this.enabled || this.disposed || payload.direction !== "outbound"
      || !payload.localAddress || !payload.localPort || ![6668, 6669].includes(payload.remotePort)) return;
    if (!this.options.store.available()) { this.dropRam(); this.status = "encryption_unavailable"; this.publish(); return; }
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
      const build = await this.options.buildIdentity(flows[0].owningProcess);
      if (epoch !== this.epoch || bodies !== this.bodies || this.disposed) return;
      if (!build) { this.status = "build_unavailable"; return; }
      if (build !== bodies.build) { this.clear(); if (this.status !== "clear_failed") this.status = "build_mismatch"; return; }
      this.validated = { localAddress: flows[0].localAddress, localPort: flows[0].localPort,
        remoteAddress: flows[0].remoteAddress, remotePort: flows[0].remotePort, pid: flows[0].owningProcess };
      this.status = "validated";
    } catch { if (epoch === this.epoch) this.status = "build_unavailable"; }
    finally { this.checking = false; this.publish(); }
  }
  restoreInput(): (InitializedProbeInput & { pid: number }) | null {
    if (!this.enabled || !this.bodies || !this.validated) return null;
    return { ...this.bodies, identity: connectProbeIdentity(this.bodies.connectBody)!, scope: this.validated,
      nativePort: this.validated.localPort, pid: this.validated.pid };
  }
  async preflight(scope: SatanicZoneSessionScope): Promise<boolean> {
    if (!this.options.store.available()) { this.dropRam(); this.status = "encryption_unavailable"; this.publish(); return false; }
    const epoch = this.epoch, current = this.validated, bodies = this.bodies;
    if (!current || !bodies || current.pid !== scope.pid || current.localAddress !== scope.localAddress
      || current.localPort !== scope.localPort || current.remoteAddress !== scope.remoteAddress || current.remotePort !== scope.remotePort) return false;
    try {
      const network = await this.options.networkState();
      const build = await this.options.buildIdentity(scope.pid);
      const valid = epoch === this.epoch && this.enabled && !this.disposed && this.validated === current
        && build === bodies.build && network.gameProcessIds.includes(scope.pid)
        && satanicZoneSessionScopeStatus(scope, network.connections) === "current";
      if (!valid && epoch === this.epoch) {
        if (build && build !== bodies.build) { this.clear(); if (this.status !== "clear_failed") this.status = "build_mismatch"; this.publish(); }
        else { this.suspend(); if (!build) { this.status = "build_unavailable"; this.publish(); } }
      }
      return valid;
    } catch { if (epoch === this.epoch) this.suspend(); return false; }
  }
  observeProcesses(ids: readonly number[]): void {
    if ((this.validated && !ids.includes(this.validated.pid)) || (this.pendingSave && !ids.includes(this.pendingSave.pid))) this.suspend();
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
  return error instanceof Error && ["encryption_unavailable", "clear_failed"].includes(error.message)
    ? error.message as "encryption_unavailable" | "clear_failed" : "storage_error";
}
