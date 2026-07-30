import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/assets",
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/content-script.ts"),
      formats: ["iife"],
      name: "ListeningSocialFacebookContent",
      fileName: () => "content-script.js"
    }
  }
});
