import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MarketPrivateDiagnosticState } from "../shared/market-private-diagnostic";

/** Explicit opt-in for one already-requested search. No credentials live here. */
export class MarketPrivateDiagnostic {
  readonly directory: string;
  private state: MarketPrivateDiagnosticState = { phase: "off" };
  constructor(userData: string, private readonly changed: (state: MarketPrivateDiagnosticState) => void = () => {}) {
    this.directory = path.join(userData, "private-market-diagnostics");
  }
  snapshot(): MarketPrivateDiagnosticState { return { ...this.state }; }
  setEnabled(enabled: boolean): MarketPrivateDiagnosticState {
    if (this.state.phase === "recording") return this.snapshot();
    if (!enabled) this.state = { ...this.state, phase: "off" };
    else {
      try {
        fs.mkdirSync(this.directory, { recursive: true });
        this.state = { phase: "armed", filePath: path.join(this.directory, `market-${Date.now()}-${randomUUID()}.jsonl`) };
      } catch { this.state = { phase: "failed" }; }
    }
    this.changed(this.snapshot()); return this.snapshot();
  }
  take(): string | undefined {
    if (this.state.phase !== "armed") return undefined;
    this.state = { ...this.state, phase: "recording" }; this.changed(this.snapshot());
    return this.state.filePath;
  }
  finish(completeResponse = false, writeSucceeded = true): void {
    if (this.state.phase !== "recording") return;
    this.state = { ...this.state, phase: writeSucceeded && this.state.filePath && fs.existsSync(this.state.filePath) ? "saved" : "failed", completeResponse };
    this.changed(this.snapshot());
  }
}
