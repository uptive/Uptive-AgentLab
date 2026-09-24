import type { ModelClient } from "@agentlab/optimization";

/**
 * Model access for LLM-backed evaluators, proxied to the Electron main process through the
 * `window.agentlab.optimization` bridge. Unused until evaluators move to LLM analysis.
 */
export const modelClient: ModelClient = {
  async generateJson(request) {
    if (typeof window.agentlab === "undefined") throw new Error("Claude API is only available in the desktop app (no Electron bridge)");
    try {
      return await window.agentlab.optimization.generateJson(request);
    } catch (error) {
      // Electron prefixes IPC errors with "Error invoking remote method '…': Error: "; keep the useful part.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  },
};
