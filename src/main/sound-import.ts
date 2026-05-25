import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

const MAX_CUSTOM_SOUND_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_SOUND_PACK_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_SOUND_IMPORT_COUNT = 24;

const CUSTOM_SOUND_MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

interface SoundPackEntry {
  fileName: string;
  contents: Buffer;
}

export interface ImportedLootSound {
  fileName: string;
  mimeType: string;
  src: string;
}

export function importLootSounds(filePaths: string[], userDataPath: string): ImportedLootSound[] {
  const soundsDir = path.join(userDataPath, "sounds");
  fs.mkdirSync(soundsDir, { recursive: true });

  const imported: ImportedLootSound[] = [];
  for (const filePath of filePaths) {
    if (imported.length >= MAX_SOUND_IMPORT_COUNT) break;
    const stats = fs.statSync(filePath);
    const extension = path.extname(filePath).toLowerCase();

    if (extension === ".zip") {
      if (stats.size <= 0 || stats.size > MAX_SOUND_PACK_IMPORT_BYTES) continue;
      for (const entry of readSoundPackEntries(filePath)) {
        if (imported.length >= MAX_SOUND_IMPORT_COUNT) break;
        const target = writeImportedSound(soundsDir, entry.fileName, entry.contents, imported.length);
        if (target) imported.push(target);
      }
      continue;
    }

    if (stats.size <= 0 || stats.size > MAX_CUSTOM_SOUND_IMPORT_BYTES) continue;
    if (!CUSTOM_SOUND_MIME_TYPES[extension]) continue;
    const target = writeImportedSound(soundsDir, path.basename(filePath), fs.readFileSync(filePath), imported.length);
    if (target) imported.push(target);
  }

  return imported;
}

export function removeImportedLootSound(src: string, userDataPath: string): boolean {
  if (!src.startsWith("file://")) return false;

  const soundsDir = path.resolve(userDataPath, "sounds");
  let targetPath = "";
  try {
    targetPath = path.resolve(fileURLToPath(src));
  } catch {
    return false;
  }

  const isInsideSoundsDir = targetPath === soundsDir || targetPath.startsWith(`${soundsDir}${path.sep}`);
  if (!isInsideSoundsDir) return false;
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  return true;
}

function readSoundPackEntries(filePath: string): SoundPackEntry[] {
  const archive = fs.readFileSync(filePath);
  const eocdOffset = findZipEndOfCentralDirectory(archive);
  if (eocdOffset < 0) return [];

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const entries: SoundPackEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount && offset + 46 <= archive.length && entries.length < MAX_SOUND_IMPORT_COUNT; index += 1) {
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
    if (uncompressedSize <= 0 || uncompressedSize > MAX_CUSTOM_SOUND_IMPORT_BYTES) continue;
    if (compressionMethod !== 0 && compressionMethod !== 8) continue;

    const fileName = rawName.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
    if (!CUSTOM_SOUND_MIME_TYPES[path.extname(fileName).toLowerCase()]) continue;
    if (localHeaderOffset + 30 > archive.length || archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > archive.length) continue;

    const compressed = archive.slice(dataStart, dataEnd);
    const contents = compressionMethod === 0 ? compressed : zlib.inflateRawSync(compressed);
    if (contents.length <= 0 || contents.length > MAX_CUSTOM_SOUND_IMPORT_BYTES) continue;
    entries.push({ fileName, contents });
  }

  return entries;
}

function findZipEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function writeImportedSound(soundsDir: string, fileName: string, contents: Buffer, index: number): ImportedLootSound | null {
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = CUSTOM_SOUND_MIME_TYPES[extension];
  if (!mimeType || contents.length <= 0 || contents.length > MAX_CUSTOM_SOUND_IMPORT_BYTES) return null;

  const parsedName = path.parse(fileName);
  const safeBaseName = parsedName.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "sound";
  const targetPath = path.join(soundsDir, `${Date.now()}-${index}-${safeBaseName}${extension}`);
  fs.writeFileSync(targetPath, contents);
  return {
    fileName: path.basename(fileName),
    mimeType,
    src: pathToFileURL(targetPath).toString(),
  };
}
