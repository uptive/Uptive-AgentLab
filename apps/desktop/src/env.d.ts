import type { AgentLabApi } from "../electron/api.js";

declare global {
  interface Window {
    /** Present when running inside Electron (see electron/preload.ts). */
    agentlab?: AgentLabApi;
  }
}

export {};
