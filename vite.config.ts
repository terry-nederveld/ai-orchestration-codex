import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "desktop",
  plugins: [react()],
  resolve: {
    alias: {
      "@fable": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist-ui",
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
