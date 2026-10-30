import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)), emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:4747", changeOrigin: true, headers: { origin: "http://127.0.0.1:4747" } },
    },
  },
});
