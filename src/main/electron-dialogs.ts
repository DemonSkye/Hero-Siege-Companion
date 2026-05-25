import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from "electron";

export function showOpenDialogWithParent(parentWindow: BrowserWindow | null, options: OpenDialogOptions) {
  return parentWindow ? dialog.showOpenDialog(parentWindow, options) : dialog.showOpenDialog(options);
}

export function showSaveDialogWithParent(parentWindow: BrowserWindow | null, options: SaveDialogOptions) {
  return parentWindow ? dialog.showSaveDialog(parentWindow, options) : dialog.showSaveDialog(options);
}
