const fs = require("node:fs");
const path = require("node:path");

function replaceRequired(source, originalLines, patchedLines, label) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const original = originalLines.join(newline);
  const patched = patchedLines.join(newline);
  if (source.includes(patched)) return { source, changed: false };
  if (!source.includes(original)) throw new Error(`Could not apply ${label}; dependency source changed.`);
  return { source: source.replace(original, patched), changed: true };
}

function replaceRequiredOccurrences(source, originalLines, patchedLines, expectedCount, label) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const original = originalLines.join(newline);
  const patched = patchedLines.join(newline);
  const originalCount = source.split(original).length - 1;
  const patchedCount = source.split(patched).length - 1;

  if (originalCount === 0 && patchedCount === expectedCount) return { source, changed: false };
  if (originalCount !== expectedCount || patchedCount !== 0) {
    throw new Error(`Could not apply ${label}; dependency source changed.`);
  }

  return { source: source.split(original).join(patched), changed: true };
}

function replaceRequiredAlternative(source, originalVariants, patchedLines, label) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const originals = originalVariants.map((lines) => lines.join(newline));
  const patched = patchedLines.join(newline);
  if (source.includes(patched)) return { source, changed: false };

  const matches = originals.filter((original) => source.includes(original));
  if (matches.length !== 1) throw new Error(`Could not apply ${label}; dependency source changed.`);
  return { source: source.replace(matches[0], patched), changed: true };
}

function patchCapBinding(source) {
  const cleanupPatch = replaceRequired(
    source,
    ["        buffer_length = 0;", "        Unref();", "      }"],
    ["        buffer_length = 0;", "#ifndef _WIN32", "        Unref();", "#endif", "      }"],
    "cap Windows close retention patch",
  );
  const closeCallbackPatch = replaceRequired(
    cleanupPatch.source,
    ["    static void cb_close(uv_handle_t* handle) {", "    }"],
    ["    static void cb_close(uv_handle_t* handle) {", "      Pcap *obj = (Pcap*)handle->data;", "      obj->Unref();", "    }"],
    "cap Windows close callback patch",
  );
  return { source: closeCallbackPatch.source, changed: cleanupPatch.changed || closeCallbackPatch.changed };
}

function patchNanHeader(source) {
  const constructorPatch = replaceRequiredOccurrences(
    source,
    [
      "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
      "",
      "    if (resource.IsEmpty()) {",
    ],
    [
      "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
      "    environment = node::GetCurrentEnvironment(isolate->GetCurrentContext());",
      "",
      "    if (resource.IsEmpty()) {",
    ],
    2,
    "NAN async-resource environment capture",
  );
  const destructorPatch = replaceRequiredAlternative(
    constructorPatch.source,
    [
      [
        "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
        "    node::EmitAsyncDestroy(isolate, context);",
      ],
      [
        "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
        "    if (isolate != nullptr) {",
        "      node::EmitAsyncDestroy(isolate, context);",
        "    }",
      ],
    ],
    [
      "    if (environment != nullptr) {",
      "      node::EmitAsyncDestroy(environment, context);",
      "    }",
    ],
    "NAN async-resource environment destroy",
  );
  const memberPatch = replaceRequired(
    destructorPatch.source,
    ["  node::async_context context;"],
    ["  node::Environment* environment = nullptr;", "  node::async_context context;"],
    "NAN async-resource environment member",
  );
  return {
    source: memberPatch.source,
    changed: constructorPatch.changed || destructorPatch.changed || memberPatch.changed,
  };
}

function patchFile(filePath, patcher) {
  const original = fs.readFileSync(filePath, "utf8");
  const result = patcher(original);
  if (result.changed) fs.writeFileSync(filePath, result.source, "utf8");
  return result.changed;
}

function patchInstalledSources(rootDir = path.join(__dirname, "..")) {
  const capSourcePath = path.join(rootDir, "node_modules", "cap", "src", "binding.cc");
  const nanHeaderPath = path.join(rootDir, "node_modules", "nan", "nan.h");
  const changed = [patchFile(capSourcePath, patchCapBinding), patchFile(nanHeaderPath, patchNanHeader)];
  console.log(changed.some(Boolean) ? "Patched cap native close lifecycle." : "Cap native close lifecycle already patched.");
}

if (require.main === module) patchInstalledSources();

module.exports = { patchCapBinding, patchNanHeader, patchInstalledSources };
