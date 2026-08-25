import type { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { redactSensitiveDebugText } from "./capture-debug";
import { showSaveDialogWithParent } from "./electron-dialogs";
import { createZipArchive, type ZipArchiveEntry } from "./zip-archive";
import type { SupportDiagnosticLogFileInfo, SupportDiagnosticsInfo, SupportDiagnosticsSaveResult } from "../shared/support-diagnostics";

const SUPPORT_DIAGNOSTIC_SUMMARY_FILE = {
  name: "diagnostics-summary.txt",
  description: "Current capture status, adapter, filter, packet counters, parser health, and app version.",
};

const SUPPORT_DIAGNOSTIC_APP_SESSION_FILE = {
  name: "app-session.json",
  description: "Sanitized app-session heartbeat state, when a readable snapshot exists.",
};

const SUPPORT_DIAGNOSTIC_CRASH_METADATA_FILE = {
  name: "crash-metadata.json",
  description: "Up to five newest Crashpad report filenames, sizes, and timestamps; never dump contents.",
};

const APP_SESSION_STRING_FIELDS = [
  "sessionId",
  "startedAt",
  "lastHeartbeatAt",
  "phase",
  "version",
  "platform",
  "arch",
  "electronVersion",
  "nodeVersion",
  "nodeModulesAbi",
  "chromeVersion",
  "closedAt",
  "shutdownReason",
] as const;
const MAX_APP_SESSION_BYTES = 64 * 1024;
const MAX_APP_SESSION_STRING_LENGTH = 2_000;
const MAX_SUPPORT_SUMMARY_LENGTH = 64 * 1024;
const MAX_CRASH_REPORTS = 5;
const CRASHPAD_REPORT_FILE_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.dmp$/i;
const REDACTED_WIDE_DEBUG_LINE = JSON.stringify({
  type: "support-redaction",
  reason: "malformed-or-unsupported-wide-debug-line",
});

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

export const SUPPORT_LOGS_DIRECTORY_NAME = "logs";

interface SaveSupportDiagnosticsOptions {
  diagnosticsSummary: string;
  appVersion?: string;
  ownerWindow: BrowserWindow | null;
  userDataPath: string;
  onLogReadFailed: (file: { name: string; path: string }) => void;
}

interface GeneratedSupportDiagnosticsFile {
  name: string;
  description: string;
  data: Buffer;
  modifiedAt: Date;
}

interface CrashReportMetadata {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
}

export function supportLogsDirectory(userDataPath: string): string {
  return path.join(userDataPath, SUPPORT_LOGS_DIRECTORY_NAME);
}

export function ensureSupportLogsDirectory(userDataPath: string): string {
  const logsPath = supportLogsDirectory(userDataPath);
  fs.mkdirSync(logsPath, { recursive: true });
  return logsPath;
}

export function getSupportDiagnosticsInfo(userDataPath: string, appVersion = "unknown"): SupportDiagnosticsInfo {
  return createSupportDiagnosticsInfo(userDataPath, appVersion, collectGeneratedSupportDiagnostics(userDataPath));
}

function createSupportDiagnosticsInfo(
  userDataPath: string,
  appVersion: string,
  generatedDiagnostics: GeneratedSupportDiagnosticsFile[],
): SupportDiagnosticsInfo {
  const logsPath = supportLogsDirectory(userDataPath);
  return {
    userDataPath,
    logsPath,
    appVersion,
    generatedFiles: [
      SUPPORT_DIAGNOSTIC_SUMMARY_FILE,
      ...generatedDiagnostics.map(({ name, description }) => ({ name, description })),
    ],
    logFiles: SUPPORT_DIAGNOSTIC_LOG_FILES
      .map((file) => getSupportLogFileInfo(logsPath, file))
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

  const generatedDiagnostics = collectGeneratedSupportDiagnostics(options.userDataPath);
  const info = createSupportDiagnosticsInfo(options.userDataPath, options.appVersion ?? "unknown", generatedDiagnostics);
  const entries: ZipArchiveEntry[] = [
    {
      name: SUPPORT_DIAGNOSTIC_SUMMARY_FILE.name,
      data: Buffer.from(createSupportDiagnosticsSummary(options.diagnosticsSummary, info), "utf8"),
      modifiedAt: new Date(),
    },
    ...generatedDiagnostics.map(({ name, data, modifiedAt }) => ({ name, data, modifiedAt })),
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
    : redactSensitiveDebugText(text);
  return Buffer.from(redactUserProfilePath(sanitizedText), "utf8");
}

export function sanitizeWideDebugLogForSupport(text: string): string {
  const sanitized = text
    .split(/\r?\n/)
    .map((line) => sanitizeWideDebugLogLine(line))
    .join("\n");
  return redactSensitiveDebugText(sanitized);
}

function sanitizeWideDebugLogLine(line: string): string {
  if (!line.trim()) return line;
  try {
    const entry = JSON.parse(line) as unknown;
    if (!isRecord(entry)) return REDACTED_WIDE_DEBUG_LINE;
    const sanitized = { ...entry };
    delete sanitized.payloadBase64;
    delete sanitized.textBase64;
    delete sanitized.textSnippet;
    return JSON.stringify(sanitized);
  } catch {
    return REDACTED_WIDE_DEBUG_LINE;
  }
}

function collectGeneratedSupportDiagnostics(userDataPath: string): GeneratedSupportDiagnosticsFile[] {
  const generated: GeneratedSupportDiagnosticsFile[] = [];
  const appSession = readSanitizedAppSession(userDataPath);
  if (appSession) generated.push(appSession);
  const crashMetadata = createCrashMetadataFile(userDataPath);
  if (crashMetadata) generated.push(crashMetadata);
  return generated;
}

function readSanitizedAppSession(userDataPath: string): GeneratedSupportDiagnosticsFile | null {
  const appSessionPath = path.join(userDataPath, SUPPORT_DIAGNOSTIC_APP_SESSION_FILE.name);
  try {
    const stat = fs.lstatSync(appSessionPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_APP_SESSION_BYTES) return null;

    const parsed = JSON.parse(fs.readFileSync(appSessionPath, "utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    const sanitized: Record<string, string | number> = {};

    if (typeof parsed.pid === "number" && Number.isSafeInteger(parsed.pid) && parsed.pid >= 0) {
      sanitized.pid = parsed.pid;
    }
    for (const field of APP_SESSION_STRING_FIELDS) {
      if (typeof parsed[field] !== "string") continue;
      sanitized[field] = sanitizeSupportString(parsed[field]);
    }
    if (Object.keys(sanitized).length === 0) return null;

    return {
      ...SUPPORT_DIAGNOSTIC_APP_SESSION_FILE,
      data: Buffer.from(`${JSON.stringify(sanitized, null, 2)}\n`, "utf8"),
      modifiedAt: stat.mtime,
    };
  } catch {
    return null;
  }
}

function createCrashMetadataFile(userDataPath: string): GeneratedSupportDiagnosticsFile | null {
  const reports = getNewestCrashReportMetadata(userDataPath);
  if (reports.length === 0) return null;
  return {
    ...SUPPORT_DIAGNOSTIC_CRASH_METADATA_FILE,
    data: Buffer.from(`${JSON.stringify({ reports }, null, 2)}\n`, "utf8"),
    modifiedAt: new Date(reports[0].modifiedAt),
  };
}

function getNewestCrashReportMetadata(userDataPath: string): CrashReportMetadata[] {
  const reportsPath = path.join(userDataPath, "Crashpad", "reports");
  let reportEntries: fs.Dirent[];
  try {
    reportEntries = fs.readdirSync(reportsPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const reports: Array<{ metadata: CrashReportMetadata; modifiedAtMs: number }> = [];
  for (const entry of reportEntries) {
    if (!entry.isFile() || !CRASHPAD_REPORT_FILE_PATTERN.test(entry.name)) continue;
    try {
      const stat = fs.lstatSync(path.join(reportsPath, entry.name));
      if (!stat.isFile()) continue;
      reports.push({
        metadata: {
          fileName: entry.name,
          sizeBytes: stat.size,
          createdAt: stat.birthtime.toISOString(),
          modifiedAt: stat.mtime.toISOString(),
        },
        modifiedAtMs: stat.mtimeMs,
      });
    } catch {
      // A report may disappear while Crashpad is rotating it; omit that entry.
    }
  }

  return reports
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs || left.metadata.fileName.localeCompare(right.metadata.fileName))
    .slice(0, MAX_CRASH_REPORTS)
    .map(({ metadata }) => metadata);
}

function sanitizeSupportString(value: string, maxLength = MAX_APP_SESSION_STRING_LENGTH): string {
  return redactUserProfilePath(redactSensitiveDebugText(value)).slice(0, maxLength);
}

function getSupportLogFileInfo(logsPath: string, file: { name: string; description: string }): SupportDiagnosticLogFileInfo {
  const filePath = path.join(logsPath, file.name);
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
  const normalizedSummary = sanitizeSupportString(
    diagnosticsSummary.trim() || "Hero Siege Companion capture diagnostics",
    MAX_SUPPORT_SUMMARY_LENGTH,
  );
  const generatedFileLines = info.generatedFiles.map((file) => `- ${file.name}: ${file.description}`);
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
    redactUserProfilePath(info.logsPath),
    "",
    "Files selected for this bundle:",
    ...generatedFileLines,
    ...logFileLines,
    "",
    "Crash dump contents are never included automatically.",
    "",
  ].join("\n");
}

function redactUserProfilePath(value: string): string {
  return value.replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/\r\n"]+/gi, "%USERPROFILE%");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
