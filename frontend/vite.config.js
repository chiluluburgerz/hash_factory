import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const HF_TARGET = "http://127.0.0.1:8090";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/hf": {
        target: HF_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/hf/, ""),
      },
    },
  },
});