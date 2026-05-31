import type { BrowserWindow, SaveDialogOptions } from "electron";
import fs from "node:fs";
import { showSaveDialogWithParent } from "./electron-dialogs";

const TEXT_DIALOG_FILTERS = [
  { name: "Text", extensions: ["txt"] },
  { name: "All files", extensions: ["*"] },
];

export async function saveTextFileWithDialog(
  parentWindow: BrowserWindow | null,
  options: { title: string; defaultPath: string; contents: unknown; filters?: SaveDialogOptions["filters"] },
): Promise<boolean> {
  const contents = String(options.contents ?? "").trim();
  if (!contents) return false;

  const dialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters ?? TEXT_DIALOG_FILTERS,
  } satisfies SaveDialogOptions;
  const result = await showSaveDialogWithParent(parentWindow, dialogOptions);
  if (result.canceled || !result.filePath) return false;

  fs.writeFileSync(result.filePath, `${contents}\n`, "utf8");
  return true;
}
