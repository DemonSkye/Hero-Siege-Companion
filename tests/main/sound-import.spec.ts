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
} from "../../src/main/sound-import";
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

  test("does not export file sound references outside the app sounds directory", () => {
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

    const embeddedJson = embedConfigurationSoundData(JSON.stringify(payload), userData);
    const embeddedPayload = JSON.parse(embeddedJson) as typeof payload;
    expect(embeddedPayload.uiPreferences.customItemFilterSounds).toEqual([]);
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
