import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

interface PatchResult {
  source: string;
  changed: boolean;
}

interface NativePatchModule {
  patchCapBinding(source: string): PatchResult;
  patchNanHeader(source: string): PatchResult;
}

const require = createRequire(import.meta.url);
const { patchCapBinding, patchNanHeader } = require("../../scripts/patch-cap-native.js") as NativePatchModule;

function nanAsyncResourceSource(destructorLines: string[]) {
  return [
    "class AsyncResource {",
    " public:",
    "  AsyncResource(",
    "      v8::Local<v8::String> name",
    "    , v8::Local<v8::Object> resource = New<v8::Object>()) {",
    "#if NODE_MODULE_VERSION >= NODE_9_0_MODULE_VERSION",
    "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
    "",
    "    if (resource.IsEmpty()) {",
    "      resource = New<v8::Object>();",
    "    }",
    "",
    "    context = node::EmitAsyncInit(isolate, resource, name);",
    "#endif",
    "  }",
    "",
    "  AsyncResource(",
    "      const char* name",
    "    , v8::Local<v8::Object> resource = New<v8::Object>()) {",
    "#if NODE_MODULE_VERSION >= NODE_9_0_MODULE_VERSION",
    "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
    "",
    "    if (resource.IsEmpty()) {",
    "      resource = New<v8::Object>();",
    "    }",
    "",
    "    context = node::EmitAsyncInit(isolate, resource, name);",
    "#endif",
    "  }",
    "",
    "  ~AsyncResource() {",
    "#if NODE_MODULE_VERSION >= NODE_9_0_MODULE_VERSION",
    ...destructorLines,
    "#endif",
    "  }",
    "",
    " private:",
    "  NAN_DISALLOW_ASSIGN_COPY_MOVE(AsyncResource)",
    "#if NODE_MODULE_VERSION >= NODE_9_0_MODULE_VERSION",
    "  node::async_context context;",
    "#endif",
    "};",
  ].join("\n");
}

describe("cap native source patch", () => {
  test("keeps the Windows wrapper referenced until uv_close completes", () => {
    const source = [
      "        buffer_length = 0;",
      "        Unref();",
      "      }",
      "    static void cb_close(uv_handle_t* handle) {",
      "    }",
    ].join("\n");

    const first = patchCapBinding(source);
    expect(first.changed).toBe(true);
    expect(first.source).toContain("#ifndef _WIN32\n        Unref();\n#endif");
    expect(first.source).toContain("Pcap *obj = (Pcap*)handle->data;\n      obj->Unref();");
    expect(patchCapBinding(first.source)).toEqual({ source: first.source, changed: false });
  });

  test.each([
    [
      "the upstream destructor",
      [
        "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
        "    node::EmitAsyncDestroy(isolate, context);",
      ],
    ],
    [
      "the previous null-isolate guard",
      [
        "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
        "    if (isolate != nullptr) {",
        "      node::EmitAsyncDestroy(isolate, context);",
        "    }",
      ],
    ],
  ])("captures the Node environment in both constructors when replacing %s", (_label, destructorLines) => {
    const first = patchNanHeader(nanAsyncResourceSource(destructorLines));
    expect(first.changed).toBe(true);
    expect(first.source.match(/environment = node::GetCurrentEnvironment\(isolate->GetCurrentContext\(\)\);/g)).toHaveLength(2);
    expect(first.source).toContain("node::Environment* environment = nullptr;");
    expect(first.source).toContain("if (environment != nullptr)");
    expect(first.source).toContain("node::EmitAsyncDestroy(environment, context);");
    expect(first.source).not.toContain("node::EmitAsyncDestroy(isolate, context);");
  });

  test("is idempotent after applying the environment-based async destroy patch", () => {
    const source = nanAsyncResourceSource([
      "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
      "    node::EmitAsyncDestroy(isolate, context);",
    ]);

    const first = patchNanHeader(source);
    expect(first.changed).toBe(true);
    expect(patchNanHeader(first.source)).toEqual({ source: first.source, changed: false });
  });

  test("fails loudly when dependency source no longer matches", () => {
    expect(() => patchCapBinding("changed upstream source")).toThrow(/dependency source changed/i);
    expect(() => patchNanHeader("changed upstream source")).toThrow(/dependency source changed/i);
    expect(() =>
      patchNanHeader(
        nanAsyncResourceSource([
          "    v8::Isolate* isolate = v8::Isolate::GetCurrent();",
          "    node::EmitAsyncDestroy(isolate, context);",
        ]).replace("    if (resource.IsEmpty()) {", "    if (resource.IsEmpty() && resource->IsObject()) {"),
      ),
    ).toThrow(/dependency source changed/i);
  });
});
