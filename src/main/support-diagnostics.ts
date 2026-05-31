import type { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { showSaveDialogWithParent } from "./electron-dialogs";
import { createZipArchive, type ZipArchiveEntry } from "./zip-archive";
import type { SupportDiagnosticLogFileInfo, SupportDiagnosticsInfo, SupportDiagnosticsSaveResult } from "../shared/support-diagnostics";

const SUPPORT_DIAGNOSTIC_GENERATED_FILES = [
  {
    name: "diagnostics-summary.txt",
    description: "Current capture status, adapter, filter, packet counters, parser health, and app version.",
  },
];

const SUPPORT_DIAGNOSTIC_LOG_FILES = [
  {
    name: "app-debug.log",
    description: "App startup, window, crash, update, and session heartbeat diagnostics.",
  },
  {
    name: "app-debug.log.old",
    description: "Previous rotated app diagnostics log, when one exists.",
  },
  {
    name: "capture-debug.log",
    description: "Npcap setup, adapter selection, capture-open, connection, and parser diagnostics.",
  },
  {
    name: "capture-debug.log.old",
    description: "Previous rotated capture diagnostics log, when one exists.",
  },
  {
    name: "capture-wide-debug.log",
    description: "Optional verbose packet and assembled-payload diagnostics when verbose live logging is enabled.",
  },
  {
    name: "capture-wide-debug.log.old",
    description: "Previous rotated verbose capture diagnostics log, when one exists.",
  },
];

interface SaveSupportDiagnosticsOptions {
  diagnosticsSummary: string;
  appVersion?: string;
  ownerWindow: BrowserWindow | null;
  userDataPath: string;
  onLogReadFailed: (file: { name: string; path: string }) => void;
}

export function getSupportDiagnosticsInfo(userDataPath: string, appVersion = "unknown"): SupportDiagnosticsInfo {
  return {
    userDataPath,
    appVersion,
    generatedFiles: SUPPORT_DIAGNOSTIC_GENERATED_FILES,
    logFiles: SUPPORT_DIAGNOSTIC_LOG_FILES
      .map((file) => getSupportLogFileInfo(userDataPath, file))
      .filter((file) => file.exists),
  };
}

export async function saveSupportDiagnosticsBundle(options: SaveSupportDiagnosticsOptions): Promise<SupportDiagnosticsSaveResult> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  const dialogOptions = {
    title: "Save Hero Siege Companion diagnostics",
    defaultPath: `hero-siege-companion-diagnostics-${timestamp}.zip`,
    filters: [
      { name: "ZIP archive", extensions: ["zip"] },
      { name: "All files", extensions: ["*"] },
    ],
  } satisfies Electron.SaveDialogOptions;
  const result = await showSaveDialogWithParent(options.ownerWindow, dialogOptions);
  if (result.canceled || !result.filePath) {
    return { saved: false, canceled: true, filePath: null, includedFiles: [] };
  }

  const info = getSupportDiagnosticsInfo(options.userDataPath, options.appVersion);
  const entries: ZipArchiveEntry[] = [
    {
      name: "diagnostics-summary.txt",
      data: Buffer.from(createSupportDiagnosticsSummary(options.diagnosticsSummary, info), "utf8"),
      modifiedAt: new Date(),
    },
  ];

  for (const file of info.logFiles) {
    if (!file.exists) continue;
    try {
      entries.push({
        name: file.name,
        data: readSupportLogFile(file),
        modifiedAt: file.updatedAt ? new Date(file.updatedAt) : new Date(),
      });
    } catch {
      options.onLogReadFailed({ name: file.name, path: file.path });
    }
  }

  fs.writeFileSync(result.filePath, createZipArchive(entries));
  return {
    saved: true,
    canceled: false,
    filePath: result.filePath,
    includedFiles: entries.map((entry) => entry.name),
  };
}

function readSupportLogFile(file: SupportDiagnosticLogFileInfo): Buffer {
  const text = fs.readFileSync(file.path, "utf8");
  const sanitizedText = file.name.startsWith("capture-wide-debug.log")
    ? sanitizeWideDebugLogForSupport(text)
    : text;
  return Buffer.from(redactUserProfilePath(sanitizedText), "utf8");
}

export function sanitizeWideDebugLogForSupport(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => sanitizeWideDebugLogLine(line))
    .join("\n");
}

function sanitizeWideDebugLogLine(line: string): string {
  if (!line.trim()) return line;
  try {
    const entry = JSON.parse(line) as unknown;
    if (!isRecord(entry)) return line;
    const sanitized = { ...entry };
    delete sanitized.payloadBase64;
    delete sanitized.textBase64;
    return JSON.stringify(sanitized);
  } catch {
    return line;
  }
}

function getSupportLogFileInfo(userDataPath: string, file: { name: string; description: string }): SupportDiagnosticLogFileInfo {
  const filePath = path.join(userDataPath, file.name);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("Support diagnostics path is not a file.");
    return {
      name: file.name,
      path: filePath,
      description: file.description,
      exists: true,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return {
      name: file.name,
      path: filePath,
      description: file.description,
      exists: false,
      sizeBytes: 0,
      updatedAt: null,
    };
  }
}

function createSupportDiagnosticsSummary(diagnosticsSummary: string, info: SupportDiagnosticsInfo): string {
  const normalizedSummary = diagnosticsSummary.trim() || "Hero Siege Companion capture diagnostics";
  const logFileLines = info.logFiles.map((file) => {
    const status = file.exists
      ? `${file.sizeBytes} bytes${file.updatedAt ? `, modified ${file.updatedAt}` : ""}`
      : "not found";
    return `- ${file.name}: ${status}`;
  });

  return [
    normalizedSummary,
    "",
    "Diagnostic log folder:",
    redactUserProfilePath(info.userDataPath),
    "",
    "Files selected for this bundle:",
    "- diagnostics-summary.txt: generated from the current Support tab preview",
    ...logFileLines,
    "",
  ].join("\n");
}

function redactUserProfilePath(value: string): string {
  return value.replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/\r\n"]+/gi, "%USERPROFILE%");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
