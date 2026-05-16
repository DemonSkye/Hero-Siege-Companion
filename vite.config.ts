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
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
