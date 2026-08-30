import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  embedConfigurationSoundData,
  exportLootSoundPackToFile,
  importLootSounds,
  installEmbeddedConfigurationSounds,
  MAX_CUSTOM_SOUND_IMPORT_BYTES,
  MAX_EMBEDDED_CONFIGURATION_BYTES,
  MAX_SOUND_IMPORT_COUNT,
} from "../../src/main/sound-import";
import { createZipArchive } from "../../src/main/zip-archive";
import type { ExportableSoundReference } from "../../src/shared/ipc";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function tempPath(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("sound import and export", () => {
  test("accepts the largest supported full-backup sound payload with JSON overhead", () => {
    const maximumBase64Bytes = Math.ceil(MAX_CUSTOM_SOUND_IMPORT_BYTES * MAX_SOUND_IMPORT_COUNT * 4 / 3);
    expect(MAX_EMBEDDED_CONFIGURATION_BYTES).toBeGreaterThan(maximumBase64Bytes);
    expect(MAX_EMBEDDED_CONFIGURATION_BYTES - maximumBase64Bytes).toBeGreaterThanOrEqual(16 * 1024 * 1024);
  });

  test("imports zip soundpacks into a directory named after the pack", () => {
    const sourceDir = tempPath("hsc-sound-source-");
    const firstUserData = tempPath("hsc-sound-user-data-");
    const secondUserData = tempPath("hsc-sound-user-data-");
    const sourceSound = path.join(sourceDir, "alert.wav");
    const soundpackPath = path.join(sourceDir, "soundpack1.zip");
    fs.writeFileSync(sourceSound, Buffer.from("riff-ish"));

    const directImport = importLootSounds([sourceSound], firstUserData);
    expect(directImport).toMatchObject([{ fileName: "alert.wav", mimeType: "audio/wav" }]);

    const exportedFiles = exportLootSoundPackToFile(asExportableSounds(directImport), firstUserData, soundpackPath);
    expect(exportedFiles).toEqual(["alert.wav"]);

    const packImport = importLootSounds([soundpackPath], secondUserData);
    expect(packImport).toMatchObject([{ fileName: "soundpack1/alert.wav", mimeType: "audio/wav" }]);
    expect(fileURLToPath(packImport[0].src)).toContain(path.join("sounds", "soundpack1", "alert.wav"));
  });

  test("skips missing selected sound files and imports the remaining valid files", () => {
    const sourceDir = tempPath("hsc-missing-sound-source-");
    const userData = tempPath("hsc-missing-sound-user-data-");
    const missingSound = path.join(sourceDir, "missing.wav");
    const validSound = path.join(sourceDir, "alert.wav");
    fs.writeFileSync(validSound, Buffer.from("alert"));

    const imported = importLootSounds([missingSound, validSound], userData);

    expect(imported).toMatchObject([{ fileName: "alert.wav", mimeType: "audio/wav" }]);
    expect(fs.existsSync(fileURLToPath(imported[0].src))).toBe(true);
  });

  test("keeps zip soundpack imports bounded and flattens nested sound entries safely", () => {
    const sourceDir = tempPath("hsc-edge-sound-source-");
    const userData = tempPath("hsc-edge-sound-user-data-");
    const soundpackPath = path.join(sourceDir, "edge-pack.zip");
    fs.writeFileSync(
      soundpackPath,
      createZipArchive([
        { name: "nested/Boss Alert.wav", data: Buffer.from("boss-alert"), modifiedAt: new Date(0) },
        { name: "nested/Boss Alert.wav", data: Buffer.from("duplicate-alert"), modifiedAt: new Date(0) },
        { name: "notes.txt", data: Buffer.from("not audio"), modifiedAt: new Date(0) },
        { name: "empty.wav", data: Buffer.alloc(0), modifiedAt: new Date(0) },
        { name: "huge.wav", data: Buffer.alloc(4 * 1024 * 1024 + 1), modifiedAt: new Date(0) },
      ]),
    );

    const imported = importLootSounds([soundpackPath], userData);

    expect(imported).toMatchObject([
      { fileName: "edge-pack/Boss-Alert.wav", mimeType: "audio/wav" },
      { fileName: "edge-pack/Boss-Alert-2.wav", mimeType: "audio/wav" },
    ]);
    expect(fs.readFileSync(fileURLToPath(imported[0].src))).toEqual(Buffer.from("boss-alert"));
    expect(fs.readFileSync(fileURLToPath(imported[1].src))).toEqual(Buffer.from("duplicate-alert"));
  });

  test("bounds inflation even when a zip entry understates its expanded size", () => {
    const sourceDir = tempPath("hsc-zip-bomb-source-");
    const userData = tempPath("hsc-zip-bomb-user-data-");
    const soundpackPath = path.join(sourceDir, "misreported.zip");
    const archive = createZipArchive([
      { name: "oversized.wav", data: Buffer.alloc(4 * 1024 * 1024 + 1), modifiedAt: new Date(0) },
    ]);
    const centralDirectoryOffset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralDirectoryOffset).toBeGreaterThanOrEqual(0);
    archive.writeUInt32LE(1, centralDirectoryOffset + 24);
    fs.writeFileSync(soundpackPath, archive);

    expect(importLootSounds([soundpackPath], userData)).toEqual([]);
  });

  test("embeds local configuration sounds and installs embedded sounds back into userData", () => {
    const sourceDir = tempPath("hsc-config-sound-source-");
    const exportUserData = tempPath("hsc-config-sound-export-");
    const importUserData = tempPath("hsc-config-sound-import-");
    const sourceSound = path.join(sourceDir, "boss.wav");
    fs.writeFileSync(sourceSound, Buffer.from("boss-alert"));
    const [importedSound] = importLootSounds([sourceSound], exportUserData);

    const payload = {
      app: "hero-siege-companion",
      kind: "configuration",
      version: 1,
      uiPreferences: {
        customItemFilterSounds: [
          {
            id: "custom-sound:boss",
            name: "Boss Alert",
            fileName: importedSound.fileName,
            src: importedSound.src,
          },
        ],
      },
    };

    const embeddedJson = embedConfigurationSoundData(JSON.stringify(payload), exportUserData);
    const embeddedPayload = JSON.parse(embeddedJson) as typeof payload;
    expect(embeddedPayload.uiPreferences.customItemFilterSounds[0].src).toMatch(/^data:audio\/wav;base64,/);

    const installedJson = installEmbeddedConfigurationSounds(embeddedJson, importUserData);
    const installedPayload = JSON.parse(installedJson) as typeof payload;
    const installedSound = installedPayload.uiPreferences.customItemFilterSounds[0];
    expect(installedSound.src).toMatch(/^file:\/\//);
    expect(installedSound.fileName).toBe("imported-settings/boss.wav");
    expect(fs.existsSync(fileURLToPath(installedSound.src))).toBe(true);
  });

  test("installs embedded configuration data-url sounds when the display name lacks an extension", () => {
    const importUserData = tempPath("hsc-config-data-url-import-");
    const audioData = Buffer.from("embedded-boss-alert");
    const payload = {
      uiPreferences: {
        customItemFilterSounds: [
          {
            id: "custom-sound:boss-alert",
            name: "Boss Alert",
            fileName: "Boss Alert",
            src: `data:audio/wav;base64,${audioData.toString("base64")}`,
          },
        ],
      },
    };

    const installedJson = installEmbeddedConfigurationSounds(JSON.stringify(payload), importUserData);
    const installedPayload = JSON.parse(installedJson) as typeof payload;
    const installedSound = installedPayload.uiPreferences.customItemFilterSounds[0];

    expect(installedSound.fileName).toBe("imported-settings/Boss-Alert.wav");
    expect(fileURLToPath(installedSound.src)).toContain(path.join("sounds", "imported-settings", "Boss-Alert.wav"));
    expect(fs.readFileSync(fileURLToPath(installedSound.src))).toEqual(audioData);
  });

  test("rejects invalid configuration JSON before installing sounds", () => {
    const importUserData = tempPath("hsc-config-invalid-import-");

    expect(() => installEmbeddedConfigurationSounds("{not-json", importUserData)).toThrow("Invalid configuration JSON");
    expect(fs.existsSync(path.join(importUserData, "sounds"))).toBe(false);
  });

  test("rejects configuration sound catalogs above the supported limit before writing files", () => {
    const importUserData = tempPath("hsc-config-too-many-import-");
    const audioData = Buffer.from("bounded-alert").toString("base64");
    const payload = {
      uiPreferences: {
        customItemFilterSounds: Array.from({ length: MAX_SOUND_IMPORT_COUNT + 1 }, (_, index) => ({
          id: `custom-sound:${index}`,
          name: `Alert ${index}`,
          fileName: `alert-${index}.wav`,
          src: `data:audio/wav;base64,${audioData}`,
        })),
      },
    };

    expect(() => installEmbeddedConfigurationSounds(JSON.stringify(payload), importUserData)).toThrow(
      `more than ${MAX_SOUND_IMPORT_COUNT} custom sounds`,
    );
    expect(fs.existsSync(path.join(importUserData, "sounds"))).toBe(false);
  });

  test("validates every embedded sound before installing any file", () => {
    const importUserData = tempPath("hsc-config-invalid-sound-import-");
    const payload = {
      uiPreferences: {
        customItemFilterSounds: [
          {
            id: "custom-sound:valid",
            name: "Valid",
            fileName: "valid.wav",
            src: `data:audio/wav;base64,${Buffer.from("valid").toString("base64")}`,
          },
          {
            id: "custom-sound:invalid",
            name: "Invalid",
            fileName: "invalid.wav",
            src: "data:audio/wav;base64,%%%%",
          },
        ],
      },
    };

    expect(() => installEmbeddedConfigurationSounds(JSON.stringify(payload), importUserData)).toThrow("invalid embedded sound");
    expect(fs.existsSync(path.join(importUserData, "sounds"))).toBe(false);
  });

  test("fails a complete backup when a sound reference is outside the app sounds directory", () => {
    const sourceDir = tempPath("hsc-outside-sound-");
    const userData = tempPath("hsc-outside-user-data-");
    const outsideSound = path.join(sourceDir, "outside.wav");
    fs.writeFileSync(outsideSound, Buffer.from("outside"));

    const payload = {
      uiPreferences: {
        customItemFilterSounds: [
          {
            id: "custom-sound:outside",
            name: "Outside",
            fileName: "outside.wav",
            src: pathToFileURL(outsideSound).toString(),
          },
        ],
      },
    };

    expect(() => embedConfigurationSoundData(JSON.stringify(payload), userData)).toThrow("could not be included in the backup");
  });

  test("exports data-url sounds with a mime-derived extension when the display name has none", () => {
    const userData = tempPath("hsc-data-url-user-data-");
    const importUserData = tempPath("hsc-data-url-import-");
    const soundpackPath = path.join(userData, "data-url-pack.zip");
    const audioData = Buffer.from("embedded-alert");

    const exportedFiles = exportLootSoundPackToFile(
      [
        {
          fileName: "Boss Alert",
          name: "Boss Alert",
          src: `data:audio/wav;base64,${audioData.toString("base64")}`,
        },
      ],
      userData,
      soundpackPath,
    );
    const importedSounds = importLootSounds([soundpackPath], importUserData);

    expect(exportedFiles).toEqual(["Boss-Alert.wav"]);
    expect(importedSounds).toMatchObject([{ fileName: "data-url-pack/Boss-Alert.wav", mimeType: "audio/wav" }]);
  });
});

function asExportableSounds(sounds: Array<{ fileName: string; src: string }>): ExportableSoundReference[] {
  return sounds.map((sound) => ({ fileName: sound.fileName, name: sound.fileName, src: sound.src }));
}
