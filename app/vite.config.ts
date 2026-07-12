import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const host = process.env.TAURI_DEV_HOST;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => ({
  root: "..",
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src") + "/",
    },
  },
  plugins: [react(), tailwindcss()],

  optimizeDeps: {
    include: ["@babel/runtime/helpers/extends"],
  },

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
        return (
          normalized.includes("/crates/") ||
          normalized.includes("/tauri/") ||
          normalized.includes("/target/") ||
          normalized.includes("/dist/") ||
          normalized.endsWith(".rs") ||
          normalized.endsWith(".toml") ||
          normalized.endsWith(".sql") ||
          normalized.endsWith(".db") ||
          normalized.endsWith(".log") ||
          normalized.endsWith(".bak") ||
          normalized.endsWith("state.json") ||
          normalized.endsWith("aurora.json") ||
          (!normalized.includes("/app/") && !normalized.includes("/packages/") && !normalized.endsWith("index.html"))
        );
      }
    },
  },

  build: {
    outDir: "app/dist",
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