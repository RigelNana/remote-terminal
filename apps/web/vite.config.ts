import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const relay = process.env.RT_RELAY_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": { target: relay, changeOrigin: true, ws: true },
      "/health": { target: relay, changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "terminal-core",
              test: /node_modules[\\/]@xterm[\\/]xterm[\\/]/,
              priority: 6,
            },
            {
              name: "terminal-addons",
              test: /node_modules[\\/]@xterm[\\/]addon-/,
              priority: 5,
            },
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 4,
            },
            {
              name: "data",
              test: /node_modules[\\/](@tanstack|zustand|@bufbuild)[\\/]/,
              priority: 3,
            },
            {
              name: "ui",
              test: /node_modules[\\/](radix-ui|lucide-react|cmdk|react-resizable-panels|sonner)[\\/]/,
              priority: 2,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
});
