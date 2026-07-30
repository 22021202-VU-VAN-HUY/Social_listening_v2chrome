import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/assets",
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/background/service-worker.ts"),
      formats: ["es"],
      fileName: () => "service-worker.js"
    }
  }
});
