import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the Electron plugins don't start when running tests.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
