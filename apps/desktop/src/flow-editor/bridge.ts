import type { AgentLabApi } from "../../electron/api.js";

/** Access to the Electron preload bridge; project storage needs the desktop app. */
export function bridge(): AgentLabApi {
  if (!window.agentlab) throw new Error("Project storage is only available in the AgentLab desktop app.");
  return window.agentlab;
}

/** Strips Electron's "Error invoking remote method ...: Error:" prefix. */
export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}
