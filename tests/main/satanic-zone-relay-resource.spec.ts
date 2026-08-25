import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const RELAY_DIRECTORY = path.resolve("resources", "satanic-zone-relay");
const RUNTIME_FILES = [
  "addon.py",
  "counter_scope.py",
  "counter_translation.py",
  "global_shuffle.py",
  "relay_state.py",
  "sz_frame.py",
] as const;

describe("packaged Satanic Zone relay resource", () => {
  test("contains only the focused Python runtime files", async () => {
    await expect(Promise.all(
      RUNTIME_FILES.map(async (filename) => (await stat(path.join(RELAY_DIRECTORY, filename))).isFile()),
    )).resolves.toEqual(RUNTIME_FILES.map(() => true));

    const packagedFiles = (await readdir(RELAY_DIRECTORY, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect(packagedFiles.sort()).toEqual([...RUNTIME_FILES].sort());
  });

  test("is copied to the runtime path by electron-builder", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
      build?: { extraResources?: unknown[] };
    };

    expect(packageJson.build?.extraResources).toContainEqual({
      from: "resources/satanic-zone-relay",
      to: "satanic-zone-relay",
      filter: ["*.py"],
    });
  });
});
