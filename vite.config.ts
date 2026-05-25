import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig({
  root: "src/renderer",
  plugins: [vue()],
  base: "./",
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
