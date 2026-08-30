import type {
  CaptureDiagnosticsLevel,
  CaptureDiagnosticsMode,
  CaptureDiagnosticsState,
  CapturePreferences,
} from "../shared/app-state";
import { DEFAULT_CAPTURE_DIAGNOSTICS_STATE, DEFAULT_CAPTURE_PREFERENCES } from "../shared/initial-state";

export const TIMED_CAPTURE_DIAGNOSTICS_MS = 10 * 60_000;

interface CaptureDiagnosticsControllerOptions {
  onChange: (state: CaptureDiagnosticsState, preferences: CapturePreferences) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

export class CaptureDiagnosticsController {
  private readonly state: CaptureDiagnosticsState = cloneState(DEFAULT_CAPTURE_DIAGNOSTICS_STATE);
  private readonly timers: Partial<Record<CaptureDiagnosticsLevel, NodeJS.Timeout>> = {};
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  private readonly clearTimer: (timer: NodeJS.Timeout) => void;

  constructor(private readonly options: CaptureDiagnosticsControllerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  snapshot(): CaptureDiagnosticsState {
    this.expireElapsedModes();
    return cloneState(this.state);
  }

  capturePreferences(): CapturePreferences {
    this.expireElapsedModes();
    const enhanced = this.state.enhanced.mode !== "off";
    const deep = this.state.deep.mode !== "off";
    return {
      ...DEFAULT_CAPTURE_PREFERENCES,
      capturePayloadLogging: enhanced || deep,
      captureWideLogging: deep,
    };
  }

  setMode(level: CaptureDiagnosticsLevel, mode: CaptureDiagnosticsMode): CaptureDiagnosticsState {
    this.clearLevelTimer(level);
    this.state[level] = mode === "timed"
      ? { mode, timedUntil: this.now() + TIMED_CAPTURE_DIAGNOSTICS_MS }
      : { mode, timedUntil: null };
    if (mode === "timed") this.scheduleExpiry(level);
    this.publish();
    return cloneState(this.state);
  }

  dispose(): void {
    this.clearLevelTimer("enhanced");
    this.clearLevelTimer("deep");
  }

  private scheduleExpiry(level: CaptureDiagnosticsLevel): void {
    const timedUntil = this.state[level].timedUntil;
    if (timedUntil === null) return;
    let timer: NodeJS.Timeout;
    timer = this.setTimer(() => {
      if (this.timers[level] !== timer) return;
      delete this.timers[level];
      if (this.state[level].mode !== "timed" || this.state[level].timedUntil !== timedUntil) return;
      this.state[level] = { mode: "off", timedUntil: null };
      this.publish();
    }, Math.max(0, timedUntil - this.now()));
    timer.unref?.();
    this.timers[level] = timer;
  }

  private expireElapsedModes(): void {
    const now = this.now();
    for (const level of ["enhanced", "deep"] as const) {
      const current = this.state[level];
      if (current.mode !== "timed" || current.timedUntil === null || current.timedUntil > now) continue;
      this.clearLevelTimer(level);
      this.state[level] = { mode: "off", timedUntil: null };
    }
  }

  private clearLevelTimer(level: CaptureDiagnosticsLevel): void {
    const timer = this.timers[level];
    if (!timer) return;
    this.clearTimer(timer);
    delete this.timers[level];
  }

  private publish(): void {
    this.expireElapsedModes();
    this.options.onChange(cloneState(this.state), this.capturePreferences());
  }
}

function cloneState(state: CaptureDiagnosticsState): CaptureDiagnosticsState {
  return {
    enhanced: { ...state.enhanced },
    deep: { ...state.deep },
  };
}
