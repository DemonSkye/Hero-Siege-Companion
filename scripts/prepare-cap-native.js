const fs = require("node:fs");
const path = require("node:path");

const capRoot = path.join(__dirname, "..", "node_modules", "cap");
const sourceDir = path.join(capRoot, "bin");
const targetDir = path.join(capRoot, "build", "Release");
const targetFile = path.join(targetDir, "cap.node");

const nativeFile = fs
  .readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("win32-x64-"))
  .map((entry) => path.join(sourceDir, entry.name, "cap.node"))
  .find((file) => fs.existsSync(file));

if (!nativeFile) {
  throw new Error(`Could not find rebuilt cap.node under ${sourceDir}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(nativeFile, targetFile);
console.log(`Prepared cap native binding: ${targetFile}`);
