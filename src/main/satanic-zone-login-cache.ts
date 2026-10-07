import type { SatanicZoneLoginCacheState } from "../shared/satanic-zone-login-cache";
import type { HeroSiegeNetworkState } from "./capture-network";
import type { CaptureConnection } from "../shared/app-state";
import type { InitializedProbeInput } from "./satanic-zone-initialized-transport";
import { connectProbeIdentity, coherentProbePostLogin } from "./satanic-zone-initialized-protocol";
import type { SatanicZoneDiagnosticBufferBudget } from "./satanic-zone-diagnostic-budget";
import { SatanicZoneLoginCacheStore, validLoginCacheDestination, type LoginCacheBodies } from "./satanic-zone-login-cache-store";

type CacheStage = "load" | "unlock" | "lock" | "save_admission" | "save_write" | "forget" | "destination";
interface CacheOptions {
  store: SatanicZoneLoginCacheStore;
  networkState: () => Promise<HeroSiegeNetworkState>;
  onChange: (state: SatanicZoneLoginCacheState) => void;
  onDiagnostic?: (stage: CacheStage, result: SatanicZoneLoginCacheState["status"] | "accepted" | "rejected",
    files: { ciphertextPresent: boolean; keyPresent: boolean }) => void;
}
/** Saved inputs are independent of a game's socket. Only explicit Refresh authenticates them. */
export class SatanicZoneLoginCache {
  private enabled = false;
  private automatic = false;
  private status: SatanicZoneLoginCacheState["status"] = "disabled";
  private bodies: LoginCacheBodies | null = null;
  private epoch = 0;
  private unlocking = false;
  private disposed = false;
  private budget!: SatanicZoneDiagnosticBufferBudget;
  constructor(private readonly options: CacheOptions) {}
  attachBudget(budget: SatanicZoneDiagnosticBufferBudget): void { this.dropRam(); this.budget = budget; }
  snapshot(): SatanicZoneLoginCacheState {
    const identity = this.bodies && connectProbeIdentity(this.bodies.connectBody);
    return { enabled: this.enabled, unlocked: this.options.store.isUnlocked(), status: this.status,
      ...(this.automatic ? { automatic: true } : {}),
      ...(identity ? { accountLabel: identity.beta === "1" ? "Saved beta account" : "Saved standard account" } : {}) };
  }
  get holdsSecrets(): boolean { return Boolean(this.bodies); }
  configure(enabled: boolean, automatic = false): void {
    this.enabled = enabled; this.automatic = enabled && automatic; this.lock();
    if (!enabled && !this.options.store.forgetUnlockingKey()) this.status = "clear_failed";
    if (this.automatic && !this.disposed) {
      try { this.bodies = this.options.store.unlockAutomatic(this.budget); this.loaded(); }
      catch (error) { this.status = fixedError(error); }
    }
    this.diagnostic("load", this.status); this.publish();
    void this.resolveLegacyDestination();
  }
  async unlock(passphrase: string): Promise<boolean> {
    if (!this.enabled || this.disposed || this.unlocking) return false;
    this.unlocking = true;
    try {
      this.dropRam(); const epoch = this.epoch;
      this.status = "unlocking"; this.publish();
      try {
        const bodies = await this.options.store.unlock(passphrase, this.budget);
        if (epoch !== this.epoch || this.disposed || !this.enabled) {
          this.release(bodies); this.options.store.lock(); return false;
        }
        this.bodies = bodies; this.loaded();
        if (this.automatic) this.options.store.retainUnlockingKey(this.budget);
      } catch (error) {
        if (epoch !== this.epoch || this.disposed) return false;
        this.status = error instanceof Error && error.message === "cancelled" ? "locked" : fixedError(error);
      }
      this.diagnostic("unlock", this.status); this.publish();
      await this.resolveLegacyDestination();
      return this.options.store.isUnlocked();
    } finally { this.unlocking = false; }
  }
  async enableAutomatic(passphrase: string): Promise<boolean> {
    if (!await this.unlock(passphrase)) return false;
    try { this.options.store.retainUnlockingKey(this.budget); this.automatic = true; this.publish(); return true; }
    catch { this.status = "storage_error"; this.diagnostic("save_write", this.status); this.publish(); return false; }
  }
  disableAutomatic(): void {
    this.automatic = false; this.status = this.options.store.forgetUnlockingKey() ? "storage_error" : "clear_failed";
    this.diagnostic("save_write", this.status); this.publish();
  }
  lock(): void {
    this.dropRam(); this.options.store.lock(); this.status = this.enabled ? "locked" : "disabled";
    this.diagnostic("lock", this.status); this.publish();
  }
  clear(): void {
    this.automatic = false; this.dropRam();
    this.status = this.options.store.forget() ? this.enabled ? "locked" : "disabled" : "clear_failed";
    this.diagnostic("forget", this.status); this.publish();
  }
  dispose(): void { this.disposed = true; this.dropRam(); this.options.store.lock(); }
  private release(bodies: LoginCacheBodies | null): void {
    if (bodies) { this.budget.release(bodies.connectBody); this.budget.release(bodies.postLoginBody); }
  }
  private dropRam(): void { this.epoch++; this.release(this.bodies); this.bodies = null; }
  private loaded(): void { this.status = !this.bodies ? "empty" : this.bodies.destination ? "loaded" : "route_required"; }
  /** Save only the complete successfully collected native pair and its destination. */
  async remember(input: InitializedProbeInput, _pid: number): Promise<void> {
    if (!this.enabled || this.disposed || !this.options.store.isUnlocked()) return;
    let copy: LoginCacheBodies | null = null, stage: CacheStage = "save_admission";
    try {
      const identity = connectProbeIdentity(input.connectBody), destination = { address: input.scope.remoteAddress, port: input.scope.remotePort };
      if (!identity || !coherentProbePostLogin(input.postLoginBody, identity) || !validLoginCacheDestination(destination)) {
        this.diagnostic("save_admission", "rejected"); return;
      }
      const connectBody = this.budget.copy(input.connectBody);
      try { copy = { connectBody, postLoginBody: this.budget.copy(input.postLoginBody), destination }; }
      catch { this.budget.release(connectBody); throw new Error(); }
      this.diagnostic(stage, "accepted"); stage = "save_write";
      this.options.store.save(copy, this.budget);
      this.dropRam(); this.bodies = copy; copy = null; this.status = "saved";
      this.diagnostic(stage, this.status);
    } catch { this.status = "storage_error"; this.diagnostic(stage, this.status); }
    finally { this.release(copy); this.publish(); }
  }
  /** Legacy files have no route. Connection metadata can supply one, never identity or authentication. */
  observeConnections(connections: readonly CaptureConnection[]): void {
    if (!this.enabled || !this.bodies || this.bodies.destination) return;
    const flow = connections.find(connection => validLoginCacheDestination({ address: connection.remoteAddress, port: connection.remotePort }));
    if (!flow) return;
    this.bodies.destination = { address: flow.remoteAddress, port: flow.remotePort }; this.loaded();
    this.diagnostic("destination", this.status); this.publish();
  }
  private async resolveLegacyDestination(): Promise<void> {
    const bodies = this.bodies, epoch = this.epoch;
    if (!bodies || bodies.destination) return;
    try {
      const network = await this.options.networkState();
      if (epoch === this.epoch && bodies === this.bodies && !this.disposed) this.observeConnections(network.connections);
    } catch { /* Loaded legacy inputs remain available for a later route observation. */ }
  }
  restoreInput(): InitializedProbeInput | null {
    const bodies = this.bodies;
    if (!this.enabled || !bodies?.destination || !this.options.store.isUnlocked() || this.disposed) return null;
    return { connectBody: bodies.connectBody, postLoginBody: bodies.postLoginBody,
      identity: connectProbeIdentity(bodies.connectBody)!, scope: { remoteAddress: bodies.destination.address, remotePort: bodies.destination.port } };
  }
  private diagnostic(stage: CacheStage, result: SatanicZoneLoginCacheState["status"] | "accepted" | "rejected"): void {
    this.options.onDiagnostic?.(stage, result, this.options.store.fileMetadata());
  }
  private publish(): void { if (!this.disposed) this.options.onChange(this.snapshot()); }
}
function fixedError(error: unknown): SatanicZoneLoginCacheState["status"] {
  return error instanceof Error && error.message === "unlock_failed" ? "unlock_failed" : "storage_error";
}
