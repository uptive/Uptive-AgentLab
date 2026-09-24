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
            // Node-only packages loaded from node_modules at runtime: the MongoDB driver has optional
            // native deps, and the Agent SDK drives a native Claude Code binary.
            rollupOptions: { external: ["mongodb", "@anthropic-ai/claude-agent-sdk"] },
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
