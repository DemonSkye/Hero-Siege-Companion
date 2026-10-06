import type { MarketReadiness } from "../shared/market-readiness";

interface MarketReadinessSource {
  marketReadiness(): MarketReadiness;
  subscribeReadiness(listener: () => void): () => void;
}

/** Publishes readiness and expiry without dispatching or invalidating lookups. */
export class MarketReadinessController {
  private captureRunning = false;
  private preparations = 0;
  private preparationFailed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private previous = "";
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly source: MarketReadinessSource,
    private readonly onChange: (readiness: MarketReadiness) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.unsubscribe = source.subscribeReadiness(() => this.publish());
    this.publish();
  }

  setCaptureRunning(running: boolean): void {
    this.captureRunning = running;
    if (!running) this.preparationFailed = false;
    this.publish();
  }

  async prepareRegion(operation: () => Promise<void>): Promise<void> {
    this.preparations += 1;
    this.preparationFailed = false;
    this.publish();
    try {
      await operation();
      if (this.source.marketReadiness().phase === "region-required") this.preparationFailed = true;
    } catch (error) {
      this.preparationFailed = true;
      throw error;
    } finally {
      this.preparations -= 1;
      this.publish();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.clearExpiryTimer();
  }

  private clearExpiryTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(): void {
    if (this.disposed) return;
    const context = this.source.marketReadiness();
    let readiness = context;
    if (!this.captureRunning) {
      readiness = { ...context, phase: "waiting", reason: "capture_inactive", canSearch: false };
    } else if (context.phase === "region-required") {
      if (this.preparations > 0) {
        readiness = { ...context, phase: "preparing", reason: "region_unprepared", canSearch: false };
      } else if (this.preparationFailed) {
        readiness = { ...context, phase: "region-error", reason: "region_unavailable" };
      }
    }
    this.clearExpiryTimer();
    if (this.captureRunning && context.expiresAt !== null && context.phase !== "expired") {
      // A valid snapshot can cross its deadline before scheduling. Always recheck
      // it on the next tick in that case; never leave a stale snapshot untimed.
      this.timer = setTimeout(() => this.publish(), Math.max(1, context.expiresAt - this.now() + 1));
      this.timer.unref?.();
    }
    const serialized = JSON.stringify(readiness);
    if (serialized === this.previous) return;
    this.previous = serialized;
    this.onChange(readiness);
  }
}
