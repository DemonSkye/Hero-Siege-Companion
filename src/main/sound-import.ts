import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import { showSaveDialogWithParent } from "./electron-dialogs";
import { readSoundPackEntries } from "./sound-pack-archive";
import { createZipArchive, type ZipArchiveEntry } from "./zip-archive";
import type { ExportableSoundReference, SoundPackExportResult } from "../shared/ipc";

const MAX_CUSTOM_SOUND_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_SOUND_PACK_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_SOUND_IMPORT_COUNT = 24;
const CONFIGURATION_SOUND_DIRECTORY = "imported-settings";

const CUSTOM_SOUND_MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

const CUSTOM_SOUND_EXTENSIONS = new Set(Object.keys(CUSTOM_SOUND_MIME_TYPES));

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
    const stats = statImportableFile(filePath);
    if (!stats) continue;
    const extension = path.extname(filePath).toLowerCase();

    if (extension === ".zip") {
      if (stats.size <= 0 || stats.size > MAX_SOUND_PACK_IMPORT_BYTES) continue;
      const entries = readSoundPackEntries(filePath, {
        maxEntries: MAX_SOUND_IMPORT_COUNT,
        maxEntryBytes: MAX_CUSTOM_SOUND_IMPORT_BYTES,
        maxTotalBytes: MAX_SOUND_PACK_IMPORT_BYTES,
        supportedExtensions: CUSTOM_SOUND_EXTENSIONS,
      });
      if (entries.length === 0) continue;
      const packName = safeDirectoryName(path.basename(filePath, extension));
      for (const entry of entries) {
        if (imported.length >= MAX_SOUND_IMPORT_COUNT) break;
        const target = writeImportedSound({
          soundsDir,
          targetDir: path.join(soundsDir, packName),
          displayDirectory: packName,
          fileName: entry.fileName,
          contents: entry.contents,
        });
        if (target) imported.push(target);
      }
      continue;
    }

    if (stats.size <= 0 || stats.size > MAX_CUSTOM_SOUND_IMPORT_BYTES) continue;
    if (!CUSTOM_SOUND_MIME_TYPES[extension]) continue;
    const contents = readSoundFile(filePath);
    if (!contents) continue;
    const target = writeImportedSound({
      soundsDir,
      targetDir: soundsDir,
      displayDirectory: "",
      fileName: path.basename(filePath),
      contents,
    });
    if (target) imported.push(target);
  }

  return imported;
}

export async function exportLootSoundPackWithDialog(
  ownerWindow: BrowserWindow | null,
  sounds: ExportableSoundReference[],
  userDataPath: string,
): Promise<SoundPackExportResult> {
  const entries = collectSoundPackExportEntries(sounds, userDataPath);
  if (entries.length === 0) return { exported: false, canceled: false, filePath: null, includedFiles: [] };

  const result = await showSaveDialogWithParent(ownerWindow, {
    title: "Export loot alert soundpack",
    defaultPath: "hero-siege-soundpack.zip",
    filters: [
      { name: "ZIP archive", extensions: ["zip"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return { exported: false, canceled: true, filePath: null, includedFiles: [] };
  }

  writeSoundPackEntriesToFile(entries, result.filePath);
  return {
    exported: true,
    canceled: false,
    filePath: result.filePath,
    includedFiles: entries.map((entry) => entry.name),
  };
}

export function exportLootSoundPackToFile(sounds: ExportableSoundReference[], userDataPath: string, targetPath: string): string[] {
  const entries = collectSoundPackExportEntries(sounds, userDataPath);
  writeSoundPackEntriesToFile(entries, targetPath);
  return entries.map((entry) => entry.name);
}

export function embedConfigurationSoundData(json: string, userDataPath: string): string {
  return rewriteConfigurationSounds(json, (sound) => {
    const source = stringField(sound, "src");
    const fileName = stringField(sound, "fileName");
    if (source.startsWith("data:audio/")) return sound;

    const audio = readSoundSource({ src: source, fileName, name: stringField(sound, "name") }, userDataPath);
    if (!audio) return null;
    return { ...sound, fileName: audio.fileName, src: `data:${audio.mimeType};base64,${audio.data.toString("base64")}` };
  });
}

export function installEmbeddedConfigurationSounds(json: string, userDataPath: string): string {
  const soundsDir = path.join(userDataPath, "sounds");
  return rewriteConfigurationSounds(json, (sound) => {
    const source = stringField(sound, "src");
    if (!source.startsWith("data:audio/")) return sound;

    const decoded = decodeAudioDataUrl(source, stringField(sound, "fileName"));
    if (!decoded) return null;
    const displayPath = normalizedDecodedSoundDisplayPath(stringField(sound, "fileName"), decoded.fileName);
    const displayParts = displayPath.split("/").filter(Boolean);
    const displayDirectory = displayParts.length > 1 ? safeDirectoryName(displayParts[0]) : CONFIGURATION_SOUND_DIRECTORY;
    const fileName = displayParts.at(-1) ?? decoded.fileName;
    const target = writeImportedSound({
      soundsDir,
      targetDir: path.join(soundsDir, displayDirectory),
      displayDirectory,
      fileName,
      contents: decoded.data,
    });
    return target ? { ...sound, fileName: target.fileName, src: target.src } : null;
  });
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

function statImportableFile(filePath: string): fs.Stats | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function readSoundFile(filePath: string): Buffer | null {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function writeImportedSound(options: {
  soundsDir: string;
  targetDir: string;
  displayDirectory: string;
  fileName: string;
  contents: Buffer;
}): ImportedLootSound | null {
  const { soundsDir, targetDir, displayDirectory, fileName, contents } = options;
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = CUSTOM_SOUND_MIME_TYPES[extension];
  if (!mimeType || contents.length <= 0 || contents.length > MAX_CUSTOM_SOUND_IMPORT_BYTES) return null;

  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = uniqueSoundPath(targetDir, safeFileName(fileName));
  const resolvedSoundsDir = path.resolve(soundsDir);
  const resolvedTargetPath = path.resolve(targetPath);
  if (!(resolvedTargetPath === resolvedSoundsDir || resolvedTargetPath.startsWith(`${resolvedSoundsDir}${path.sep}`))) return null;

  fs.writeFileSync(targetPath, contents);
  const writtenFileName = path.basename(targetPath);
  const displayFileName = displayDirectory ? `${displayDirectory}/${writtenFileName}` : writtenFileName;
  return {
    fileName: displayFileName,
    mimeType,
    src: pathToFileURL(targetPath).toString(),
  };
}

function collectSoundPackExportEntries(sounds: ExportableSoundReference[], userDataPath: string): ZipArchiveEntry[] {
  const entries: ZipArchiveEntry[] = [];
  const usedNames = new Set<string>();
  for (const sound of sounds.slice(0, MAX_SOUND_IMPORT_COUNT)) {
    const audio = readSoundSource(sound, userDataPath);
    if (!audio) continue;
    const name = uniqueZipEntryName(normalizedSoundDisplayPath(audio.fileName), usedNames);
    entries.push({ name, data: audio.data, modifiedAt: audio.modifiedAt });
  }
  return entries;
}

function writeSoundPackEntriesToFile(entries: ZipArchiveEntry[], targetPath: string): void {
  fs.writeFileSync(targetPath, createZipArchive(entries));
}

function readSoundSource(sound: ExportableSoundReference, userDataPath: string): { fileName: string; data: Buffer; mimeType: string; modifiedAt: Date } | null {
  const fileName = normalizedSoundDisplayPath(sound.fileName || sound.name || "sound.wav");
  if (sound.src.startsWith("data:audio/")) {
    const decoded = decodeAudioDataUrl(sound.src, fileName);
    return decoded ? { fileName: decoded.fileName, data: decoded.data, mimeType: decoded.mimeType, modifiedAt: new Date() } : null;
  }

  const extension = path.extname(fileName).toLowerCase();
  const mimeType = CUSTOM_SOUND_MIME_TYPES[extension];
  if (!mimeType) return null;

  if (!sound.src.startsWith("file://")) return null;
  let sourcePath = "";
  try {
    sourcePath = path.resolve(fileURLToPath(sound.src));
  } catch {
    return null;
  }

  const soundsDir = path.resolve(userDataPath, "sounds");
  if (!(sourcePath === soundsDir || sourcePath.startsWith(`${soundsDir}${path.sep}`))) return null;

  try {
    const stats = fs.statSync(sourcePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_CUSTOM_SOUND_IMPORT_BYTES) return null;
    return { fileName, data: fs.readFileSync(sourcePath), mimeType, modifiedAt: stats.mtime };
  } catch {
    return null;
  }
}

function rewriteConfigurationSounds(json: string, rewriteSound: (sound: Record<string, unknown>) => Record<string, unknown> | null): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  if (!isRecord(parsed) || !isRecord(parsed.uiPreferences) || !Array.isArray(parsed.uiPreferences.customItemFilterSounds)) return json;

  const nextSounds: Record<string, unknown>[] = [];
  for (const sound of parsed.uiPreferences.customItemFilterSounds) {
    if (!isRecord(sound)) continue;
    const nextSound = rewriteSound(sound);
    if (nextSound) nextSounds.push(nextSound);
  }
  parsed.uiPreferences.customItemFilterSounds = nextSounds;
  return JSON.stringify(parsed, null, 2);
}

function decodeAudioDataUrl(src: string, fallbackFileName: string): { fileName: string; data: Buffer; mimeType: string } | null {
  const match = /^data:(audio\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(src);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const extension = extensionForMimeType(mimeType) ?? path.extname(fallbackFileName).toLowerCase();
  if (!extension || !CUSTOM_SOUND_MIME_TYPES[extension]) return null;
  const data = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (data.length <= 0 || data.length > MAX_CUSTOM_SOUND_IMPORT_BYTES) return null;
  const fallbackPath = normalizedSoundDisplayPath(fallbackFileName);
  const fallbackExtension = path.extname(fallbackPath).toLowerCase();
  const parsed = path.parse(fallbackPath);
  const fileName = fallbackExtension && CUSTOM_SOUND_MIME_TYPES[fallbackExtension]
    ? fallbackPath
    : `${parsed.dir ? `${parsed.dir}/` : ""}${parsed.name || "sound"}${extension}`;
  return { fileName, data, mimeType };
}

function extensionForMimeType(mimeType: string): string | null {
  return Object.entries(CUSTOM_SOUND_MIME_TYPES).find(([, value]) => value === mimeType)?.[0] ?? null;
}

function normalizedSoundDisplayPath(fileName: string): string {
  const parts = fileName.replace(/\\/g, "/").split("/").map(safeFileName).filter(Boolean);
  return parts.length ? parts.join("/") : "sound.wav";
}

function normalizedDecodedSoundDisplayPath(rawFileName: string, decodedFileName: string): string {
  const rawDisplayPath = normalizedSoundDisplayPath(rawFileName || decodedFileName);
  const rawExtension = path.extname(rawDisplayPath).toLowerCase();
  return CUSTOM_SOUND_MIME_TYPES[rawExtension] ? rawDisplayPath : normalizedSoundDisplayPath(decodedFileName);
}

function safeDirectoryName(value: string): string {
  return value.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "soundpack";
}

function safeFileName(value: string): string {
  const parsed = path.parse(value.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "");
  const extension = parsed.ext.toLowerCase();
  const safeBaseName = parsed.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "sound";
  return `${safeBaseName}${extension}`;
}

function uniqueSoundPath(targetDir: string, fileName: string): string {
  const parsed = path.parse(fileName);
  let candidate = path.join(targetDir, fileName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function uniqueZipEntryName(fileName: string, usedNames: Set<string>): string {
  const parts = fileName.split("/").filter(Boolean);
  const lastPart = parts.pop() ?? "sound.wav";
  const parsed = path.parse(lastPart);
  const directory = parts.length ? `${parts.join("/")}/` : "";
  let candidate = `${directory}${lastPart}`;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${directory}${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  return typeof record[field] === "string" ? record[field].trim() : "";
}
