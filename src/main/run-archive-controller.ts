import { MAX_PAST_RUNS } from "./persistence";
import type { PastRunSummary } from "../shared/stats";

interface RunArchiveControllerOptions {
  getRuns: () => PastRunSummary[];
  saveRuns: (runs: PastRunSummary[]) => boolean;
  publishRuns: (runs: PastRunSummary[]) => void;
}

export class RunArchiveController {
  private readonly archivedSessionStarts = new Set<number>();

  constructor(private readonly options: RunArchiveControllerOptions) {}

  archive(summary: PastRunSummary): "saved" | "already-archived" | "failed" {
    if (this.archivedSessionStarts.has(summary.sessionStartedAt)) return "already-archived";
    const runs = [summary, ...this.options.getRuns().filter((run) => run.sessionStartedAt !== summary.sessionStartedAt)].slice(0, MAX_PAST_RUNS);
    if (!this.replaceRuns(runs)) return "failed";
    this.archivedSessionStarts.add(summary.sessionStartedAt);
    return "saved";
  }

  replaceRuns(runs: PastRunSummary[]): boolean {
    if (!this.options.saveRuns(runs)) return false;
    this.options.publishRuns(runs);
    return true;
  }
}
