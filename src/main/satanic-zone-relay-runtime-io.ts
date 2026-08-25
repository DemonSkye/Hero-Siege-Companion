import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch as watchFileSystem } from "node:fs";
import { link, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SATANIC_ZONE_RELAY_MAX_FILE_BYTES,
  type RelayJsonRecord,
} from "./satanic-zone-relay-protocol";

const RELAY_RESOURCE_DIRECTORY = "satanic-zone-relay";
const RELAY_SCRIPT_NAME = "addon.py";
const RELAY_EXECUTABLE_NAME = "mitmdump.exe";

export type RelayJsonRead =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "record"; value: RelayJsonRecord };

export interface ManagedRelayWatch {
  close(): void;
}

export interface ManagedRelayChild {
  readonly pid: number | undefined;
  isRunning(): boolean;
  onExit(listener: () => void): void;
  onError(listener: () => void): void;
  terminate(): void;
}

type RelayChildProcess = Pick<ReturnType<typeof nodeSpawn>, "pid" | "exitCode" | "killed" | "once" | "kill">;

export function wrapManagedRelayChild(child: RelayChildProcess): ManagedRelayChild {
  let spawnErrorOccurred = false;
  const spawnErrorListeners: Array<() => void> = [];
  child.once("error", () => {
    spawnErrorOccurred = true;
    for (const listener of spawnErrorListeners.splice(0)) listener();
  });
  return {
    get pid() {
      return child.pid;
    },
    isRunning: () => child.exitCode === null && !child.killed,
    onExit: (listener) => { child.once("exit", listener); },
    onError: (listener) => {
      if (spawnErrorOccurred) listener();
      else spawnErrorListeners.push(listener);
    },
    terminate: () => { child.kill(); },
  };
}

export interface ManagedSatanicZoneRelayRuntimeDependencies {
  isFile(targetPath: string): Promise<boolean>;
  makeDirectory(targetPath: string): Promise<void>;
  readJson(targetPath: string): Promise<RelayJsonRead>;
  commitJson(targetPath: string, value: unknown): Promise<"committed" | "occupied">;
  spawnRelay(
    executable: string,
    args: readonly string[],
    options: { cwd: string; environment: NodeJS.ProcessEnv },
  ): ManagedRelayChild;
  watchDirectory(
    targetPath: string,
    filename: string,
    onChange: () => void,
    onError: () => void,
  ): ManagedRelayWatch;
  scheduleTimeout(callback: () => void, timeoutMs: number): ReturnType<typeof setTimeout>;
  cancelTimeout(timeout: ReturnType<typeof setTimeout>): void;
  createId(): string;
  now(): number;
}

export interface ResolvedSatanicZoneRelayRuntime {
  executablePath: string;
  scriptPath: string;
}

export function satanicZoneRelayResourcesPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  return path.normalize(options.isPackaged
    ? options.resourcesPath
    : path.join(options.appPath, "resources"));
}

export async function resolveSatanicZoneRelayRuntime(
  options: {
    resourcesPath: string;
    relayScriptPath?: string;
    relayExecutablePath?: string;
    environment: NodeJS.ProcessEnv;
  },
  isFile: (targetPath: string) => Promise<boolean>,
): Promise<ResolvedSatanicZoneRelayRuntime | null> {
  if (!path.isAbsolute(options.resourcesPath)) return null;
  const scriptPath = path.normalize(
    options.relayScriptPath
    ?? path.join(options.resourcesPath, RELAY_RESOURCE_DIRECTORY, RELAY_SCRIPT_NAME),
  );
  if (!path.isAbsolute(scriptPath) || !(await isFile(scriptPath))) return null;

  for (const candidate of relayExecutableCandidates(options)) {
    if (await isFile(candidate)) return { executablePath: candidate, scriptPath };
  }
  return null;
}

function relayExecutableCandidates(options: {
  resourcesPath: string;
  relayExecutablePath?: string;
  environment: NodeJS.ProcessEnv;
}): string[] {
  const candidates: string[] = [];
  if (options.relayExecutablePath && path.isAbsolute(options.relayExecutablePath)) {
    candidates.push(path.normalize(options.relayExecutablePath));
  }
  candidates.push(path.join(options.resourcesPath, RELAY_RESOURCE_DIRECTORY, RELAY_EXECUTABLE_NAME));
  if (process.platform === "win32") {
    const programFiles = options.environment.ProgramFiles?.trim() || "C:\\Program Files";
    if (path.isAbsolute(programFiles)) {
      candidates.push(path.join(programFiles, "mitmproxy", "bin", RELAY_EXECUTABLE_NAME));
    }
  }
  const executableName = process.platform === "win32" ? RELAY_EXECUTABLE_NAME : "mitmdump";
  for (const entry of (options.environment.PATH ?? "").split(path.delimiter)) {
    const directory = entry.trim().replace(/^"|"$/gu, "");
    if (directory && path.isAbsolute(directory)) candidates.push(path.join(directory, executableName));
  }
  return [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
}

function isMissingPathError(error: unknown): boolean {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

export const defaultManagedSatanicZoneRelayRuntimeDependencies: ManagedSatanicZoneRelayRuntimeDependencies = {
  async isFile(targetPath) {
    try {
      return (await stat(targetPath)).isFile();
    } catch {
      return false;
    }
  },

  async makeDirectory(targetPath) {
    await mkdir(targetPath, { recursive: true });
  },

  async readJson(targetPath) {
    try {
      const metadata = await stat(targetPath);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > SATANIC_ZONE_RELAY_MAX_FILE_BYTES) {
        return { kind: "invalid" };
      }
      const value = JSON.parse(await readFile(targetPath, "utf8")) as unknown;
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? { kind: "record", value: value as RelayJsonRecord }
        : { kind: "invalid" };
    } catch (error) {
      return isMissingPathError(error) ? { kind: "missing" } : { kind: "invalid" };
    }
  },

  async commitJson(targetPath, value) {
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
    );
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporaryPath, targetPath);
      return "committed";
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        return "occupied";
      }
      throw error;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  },

  spawnRelay(executable, args, options) {
    const child = nodeSpawn(executable, [...args], {
      cwd: options.cwd,
      env: options.environment,
      windowsHide: true,
      shell: false,
      stdio: "ignore",
    });
    return wrapManagedRelayChild(child);
  },

  watchDirectory(targetPath, filename, onChange, onError) {
    const watcher = watchFileSystem(
      targetPath,
      { persistent: false, encoding: "utf8" },
      (_eventType, changedFilename) => {
        if (changedFilename === null || changedFilename.toLowerCase() === filename.toLowerCase()) onChange();
      },
    );
    watcher.on("error", onError);
    watcher.unref();
    return { close: () => watcher.close() };
  },

  scheduleTimeout(callback, timeoutMs) {
    const timeout = setTimeout(callback, timeoutMs);
    timeout.unref();
    return timeout;
  },

  cancelTimeout(timeout) {
    clearTimeout(timeout);
  },

  createId: () => randomUUID().replaceAll("-", ""),
  now: Date.now,
};
