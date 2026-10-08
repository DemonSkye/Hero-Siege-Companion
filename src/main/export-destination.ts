import fs from "node:fs";
import path from "node:path";

interface ProtectedExportTargets {
  roots: readonly string[];
  files: readonly string[];
}

const EXPORT_LOCATION_ERROR = "Choose a regular export file outside Companion storage, application files and the selected game executable.";

// Native Save consent authorizes an export, never modification of app authority.
// Resolve the nearest existing ancestor so new files and junction/short-name
// aliases receive the same containment check as existing files.
export function safeExportDestination(target: string, protectedTargets: ProtectedExportTargets): string {
  if (!path.isAbsolute(target) || /[\x00-\x1f]/.test(target)) throw new Error(EXPORT_LOCATION_ERROR);
  if (process.platform === "win32" && (/^\\\\[?.]\\/.test(target)
    || target.replace(/^[a-z]:/i, "").includes(":")
    || path.normalize(target).split(path.sep).some(part => /[ .]$/.test(part)))) throw new Error(EXPORT_LOCATION_ERROR);
  const resolved = canonicalDestination(target);
  for (const root of protectedTargets.roots) {
    if (containsPath(path.resolve(root), path.resolve(target)) || containsPath(canonicalDestination(root), resolved)) {
      throw new Error(EXPORT_LOCATION_ERROR);
    }
  }
  for (const file of protectedTargets.files) {
    if (samePath(path.resolve(file), path.resolve(target)) || samePath(canonicalDestination(file), resolved)) {
      throw new Error(EXPORT_LOCATION_ERROR);
    }
  }
  try {
    const stat = fs.statSync(resolved);
    // Hard links have no privileged canonical pathname. Reject overwrite of any
    // multiply linked file rather than trying to discover all its other names.
    if (!stat.isFile() || stat.nlink > 1) throw new Error(EXPORT_LOCATION_ERROR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolved;
}

function canonicalDestination(target: string): string {
  let ancestor = path.resolve(target);
  const suffix: string[] = [];
  for (;;) {
    try {
      const canonical = fs.realpathSync.native(ancestor);
      if (suffix.length && !fs.statSync(canonical).isDirectory()) throw new Error(EXPORT_LOCATION_ERROR);
      return path.join(canonical, ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A dangling junction/symlink cannot be treated as an ordinary missing
      // ancestor that might point somewhere else when later opened.
      try {
        if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error(EXPORT_LOCATION_ERROR);
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error(EXPORT_LOCATION_ERROR);
      suffix.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function containsPath(root: string, target: string): boolean {
  const relative = path.relative(process.platform === "win32" ? root.toLowerCase() : root,
    process.platform === "win32" ? target.toLowerCase() : target);
  return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
