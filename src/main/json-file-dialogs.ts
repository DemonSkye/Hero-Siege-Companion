import type { BrowserWindow, OpenDialogOptions, SaveDialogOptions } from "electron";
import fs from "node:fs";
import { showOpenDialogWithParent, showSaveDialogWithParent } from "./electron-dialogs";

const JSON_DIALOG_FILTERS = [
  { name: "JSON", extensions: ["json"] },
  { name: "All files", extensions: ["*"] },
];

export async function saveJsonFileWithDialog(
  parentWindow: BrowserWindow | null,
  options: { title: string; defaultPath: string; contents: unknown },
): Promise<boolean> {
  const contents = String(options.contents ?? "").trim();
  if (!contents) return false;

  const dialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    filters: JSON_DIALOG_FILTERS,
  } satisfies SaveDialogOptions;
  const result = await showSaveDialogWithParent(parentWindow, dialogOptions);
  if (result.canceled || !result.filePath) return false;

  fs.writeFileSync(result.filePath, `${contents}\n`, "utf8");
  return true;
}

export async function readJsonFileWithDialog(
  parentWindow: BrowserWindow | null,
  options: { title: string; maxBytes: number; tooLargeMessage: string },
): Promise<string | null> {
  const dialogOptions = {
    title: options.title,
    properties: ["openFile"],
    filters: JSON_DIALOG_FILTERS,
  } satisfies OpenDialogOptions;
  const result = await showOpenDialogWithParent(parentWindow, dialogOptions);
  if (result.canceled) return null;

  const filePath = result.filePaths[0];
  if (!filePath) return null;
  if (fs.statSync(filePath).size > options.maxBytes) {
    throw new Error(options.tooLargeMessage);
  }

  return fs.readFileSync(filePath, "utf8");
}
