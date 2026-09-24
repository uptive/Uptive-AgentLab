import type { AgentLabApi } from "../electron/api.js";

declare global {
  interface Window {
    agentlab: AgentLabApi;
  }
}
