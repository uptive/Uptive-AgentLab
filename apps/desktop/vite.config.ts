import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            // Node-only driver with optional native deps; load it from node_modules at runtime.
            rollupOptions: { external: ["mongodb"] },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            // Sandboxed preloads must be CommonJS; .cjs keeps Electron from treating it as ESM.
            rollupOptions: { output: { entryFileNames: "[name].cjs" } },
          },
        },
      },
    }),
  ],
});
