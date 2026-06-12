import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const packageJson = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string };
const appVersion = packageJson.version ?? "0.0.0";

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.spec.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
});
