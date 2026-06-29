import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: (path: string) => {
        const normalized = path.replace(/\\/g, "/");
        if (normalized.includes("/app/src/")) return false;
        if (normalized.includes("/packages/")) {
          if (normalized.includes("/src/")) return false;
        }
        return true;
      },
    },
  },

  build: {
    target: "es2022",
    minify: "esbuild" as const,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@xterm") || id.includes("xterm")) {
            return "xterm";
          }
        },
      },
    },
  },
}));
