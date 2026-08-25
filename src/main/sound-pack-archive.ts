import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export interface SoundPackEntry {
  fileName: string;
  contents: Buffer;
}

export interface SoundPackReadOptions {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  supportedExtensions: ReadonlySet<string>;
}

export function readSoundPackEntries(filePath: string, options: SoundPackReadOptions): SoundPackEntry[] {
  const archive = readArchiveFile(filePath);
  if (!archive) return [];
  const eocdOffset = findZipEndOfCentralDirectory(archive);
  if (eocdOffset < 0) return [];

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const entries: SoundPackEntry[] = [];
  let totalBytes = 0;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount && offset + 46 <= archive.length && entries.length < options.maxEntries; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) break;

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const rawName = archive.slice(fileNameStart, fileNameEnd).toString(flags & 0x800 ? "utf8" : "latin1");
    offset = fileNameEnd + extraLength + commentLength;

    if (!rawName || rawName.endsWith("/") || rawName.endsWith("\\")) continue;
    const remainingBytes = options.maxTotalBytes - totalBytes;
    const entryByteLimit = Math.min(options.maxEntryBytes, remainingBytes);
    if (entryByteLimit <= 0) break;
    if (uncompressedSize <= 0 || uncompressedSize > entryByteLimit) continue;
    if (compressionMethod !== 0 && compressionMethod !== 8) continue;

    const fileName = rawName.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
    if (!options.supportedExtensions.has(path.extname(fileName).toLowerCase())) continue;
    if (localHeaderOffset + 30 > archive.length || archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > archive.length) continue;

    const compressed = archive.slice(dataStart, dataEnd);
    let contents: Buffer;
    try {
      contents = compressionMethod === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: entryByteLimit });
    } catch {
      continue;
    }
    if (contents.length <= 0 || contents.length > entryByteLimit || contents.length !== uncompressedSize) continue;
    entries.push({ fileName, contents });
    totalBytes += contents.length;
  }

  return entries;
}

function readArchiveFile(filePath: string): Buffer | null {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function findZipEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}
