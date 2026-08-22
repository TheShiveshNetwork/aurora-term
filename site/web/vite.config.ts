import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    minify: "esbuild" as const,
    reportCompressedSize: false,
  },
});
