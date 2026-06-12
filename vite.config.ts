import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string };
const appVersion = packageJson.version ?? "0.0.0";

export default defineConfig({
  root: "src/renderer",
  plugins: [vue()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join("/");
          if (normalizedId.includes("/node_modules/vue/")) return "vendor-vue";
          if (normalizedId.includes("/src/shared/item-icons")) return "item-icons";
          if (normalizedId.includes("/src/shared/item-lookup") || normalizedId.includes("/src/shared/stack-item-lookup")) {
            return "item-lookup";
          }
          if (normalizedId.includes("/src/shared/item-rarity") || normalizedId.includes("/src/shared/set-item-names")) {
            return "item-taxonomy";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
