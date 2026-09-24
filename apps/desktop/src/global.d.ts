import type { AgentLabApi } from "../electron/preload.js";

declare global {
  interface Window {
    agentlab: AgentLabApi;
  }
}
