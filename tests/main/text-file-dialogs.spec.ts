import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { saveTextFileWithDialog } from "../../src/main/text-file-dialogs";

const dialogMock = vi.hoisted(() => ({
  showSaveDialogWithParent: vi.fn(),
}));

vi.mock("../../src/main/electron-dialogs", () => ({
  showSaveDialogWithParent: dialogMock.showSaveDialogWithParent,
}));

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-text-dialog-"));
  dialogMock.showSaveDialogWithParent.mockReset();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("text file dialogs", () => {
  test("skips empty text exports before opening a save dialog", async () => {
    await expect(saveTextFileWithDialog(null, { title: "Export", defaultPath: "empty.csv", contents: "  " })).resolves.toBe(false);

    expect(dialogMock.showSaveDialogWithParent).not.toHaveBeenCalled();
  });

  test("returns false when the save dialog is canceled", async () => {
    dialogMock.showSaveDialogWithParent.mockResolvedValue({ canceled: true, filePath: undefined });

    await expect(saveTextFileWithDialog(null, { title: "Export", defaultPath: "runs.csv", contents: "a,b" })).resolves.toBe(false);
  });

  test("writes trimmed text with custom filters and a trailing newline", async () => {
    const filePath = path.join(tempDir, "runs.csv");
    const filters = [{ name: "CSV", extensions: ["csv"] }];
    dialogMock.showSaveDialogWithParent.mockResolvedValue({ canceled: false, filePath });

    await expect(saveTextFileWithDialog(null, { title: "Export CSV", defaultPath: "runs.csv", contents: " section,label\n", filters })).resolves.toBe(true);

    expect(dialogMock.showSaveDialogWithParent).toHaveBeenCalledWith(null, {
      title: "Export CSV",
      defaultPath: "runs.csv",
      filters,
    });
    expect(fs.readFileSync(filePath, "utf8")).toBe("section,label\n");
  });
});
