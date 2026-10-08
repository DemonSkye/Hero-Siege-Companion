import { app, dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions, type MessageBoxOptions } from "electron";
import path from "node:path";
import { safeExportDestination } from "./export-destination";

let protectedExportFiles: () => string[] = () => [];

export function setProtectedExportFiles(provider: () => string[]): void {
  protectedExportFiles = provider;
}

export function showOpenDialogWithParent(parentWindow: BrowserWindow | null, options: OpenDialogOptions) {
  return parentWindow ? dialog.showOpenDialog(parentWindow, options) : dialog.showOpenDialog(options);
}

export async function showSaveDialogWithParent(parentWindow: BrowserWindow | null, options: SaveDialogOptions) {
  const result = await (parentWindow ? dialog.showSaveDialog(parentWindow, options) : dialog.showSaveDialog(options));
  if (result.canceled || !result.filePath) return result;
  const appPath = app.getAppPath();
  return { ...result, filePath: safeExportDestination(result.filePath, {
    roots: [app.getPath("userData"), app.isPackaged ? path.dirname(appPath) : appPath, process.resourcesPath],
    files: [app.getPath("exe"), ...protectedExportFiles()],
  }) };
}

export function showMessageBoxWithParent(parentWindow: BrowserWindow | null, options: MessageBoxOptions) {
  return parentWindow ? dialog.showMessageBox(parentWindow, options) : dialog.showMessageBox(options);
}
