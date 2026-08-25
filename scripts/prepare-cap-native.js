const fs = require("node:fs");
const path = require("node:path");
const { getAbi } = require("node-abi");
const electronVersion = require("electron/package.json").version;

const capRoot = path.join(__dirname, "..", "node_modules", "cap");
const sourceDir = path.join(capRoot, "bin");
const targetDir = path.join(capRoot, "build", "Release");
const targetFile = path.join(targetDir, "cap.node");

const electronAbi = getAbi(electronVersion, "electron");
const nativeFile = path.join(sourceDir, `win32-x64-${electronAbi}`, "cap.node");

if (!fs.existsSync(nativeFile)) {
  throw new Error(`Could not find cap.node rebuilt for Electron ABI ${electronAbi} under ${sourceDir}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(nativeFile, targetFile);
console.log(`Prepared cap native binding: ${targetFile}`);
