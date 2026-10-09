import { describe, expect, test, vi } from "vitest";
import { RunArchiveController } from "../../src/main/run-archive-controller";
import { pastRun } from "../renderer/fixtures";

describe("durable run archive", () => {
  test("failed writes keep the previous archive and allow the same run to be retried", () => {
    let runs = [pastRun({ id: "old", sessionStartedAt: 1 })];
    const saveRuns = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const publishRuns = vi.fn((next) => { runs = next; });
    const controller = new RunArchiveController({ getRuns: () => runs, saveRuns, publishRuns });
    const summary = pastRun({ id: "new", sessionStartedAt: 2 });
    expect(controller.archive(summary)).toBe("failed");
    expect(runs.map((run) => run.id)).toEqual(["old"]);
    expect(publishRuns).not.toHaveBeenCalled();
    expect(controller.archive(summary)).toBe("saved");
    expect(runs.map((run) => run.id)).toEqual(["new", "old"]);
    expect(controller.archive(summary)).toBe("already-archived");
    expect(saveRuns).toHaveBeenCalledTimes(2);
  });

  test("failed history edits never publish deletion or tag changes", () => {
    const publishRuns = vi.fn();
    const controller = new RunArchiveController({ getRuns: () => [pastRun()], saveRuns: () => false, publishRuns });
    expect(controller.replaceRuns([])).toBe(false);
    expect(publishRuns).not.toHaveBeenCalled();
  });
});
