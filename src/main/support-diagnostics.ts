import type { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { showSaveDialogWithParent } from "./electron-dialogs";
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
  ownerWindow: BrowserWindow | null;
  userDataPath: string;
  onLogReadFailed: (file: { name: string; path: string }) => void;
}

interface ZipEntryInput {
  name: string;
  data: Buffer;
  modifiedAt: Date;
}

interface ZipCentralDirectoryInput {
  nameBuffer: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  dosTime: number;
  dosDate: number;
  localHeaderOffset: number;
}

export function getSupportDiagnosticsInfo(userDataPath: string): SupportDiagnosticsInfo {
  return {
    userDataPath,
    generatedFiles: SUPPORT_DIAGNOSTIC_GENERATED_FILES,
    logFiles: SUPPORT_DIAGNOSTIC_LOG_FILES.map((file) => getSupportLogFileInfo(userDataPath, file)),
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

  const info = getSupportDiagnosticsInfo(options.userDataPath);
  const entries: ZipEntryInput[] = [
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
        data: fs.readFileSync(file.path),
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
    info.userDataPath,
    "",
    "Files selected for this bundle:",
    "- diagnostics-summary.txt: generated from the current Support tab preview",
    ...logFileLines,
    "",
  ].join("\n");
}

function createZipArchive(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralInputs: ZipCentralDirectoryInput[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const { dosTime, dosDate } = dateToDos(entry.modifiedAt);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, compressed);
    centralInputs.push({
      nameBuffer,
      crc,
      compressedSize: compressed.length,
      uncompressedSize: entry.data.length,
      compressionMethod: 8,
      dosTime,
      dosDate,
      localHeaderOffset: offset,
    });
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectoryOffset = offset;
  const centralParts = centralInputs.map((input) => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(input.compressionMethod, 10);
    header.writeUInt16LE(input.dosTime, 12);
    header.writeUInt16LE(input.dosDate, 14);
    header.writeUInt32LE(input.crc, 16);
    header.writeUInt32LE(input.compressedSize, 20);
    header.writeUInt32LE(input.uncompressedSize, 24);
    header.writeUInt16LE(input.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(input.localHeaderOffset, 42);
    offset += header.length + input.nameBuffer.length;
    return Buffer.concat([header, input.nameBuffer]);
  });

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(centralInputs.length, 8);
  endOfCentralDirectory.writeUInt16LE(centralInputs.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]);
}

function dateToDos(date: Date): { dosTime: number; dosDate: number } {
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.max(1980, Math.min(2107, safeDate.getFullYear()));
  const dosTime = (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate();
  return { dosTime, dosDate };
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
