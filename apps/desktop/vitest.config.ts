import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests do not start the Electron plugin.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
